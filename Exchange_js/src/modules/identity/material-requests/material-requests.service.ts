import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  MATERIAL_REQUEST_LIVE_STATUSES,
  nextMaterialRequestStatus,
  type MaterialRequestOrderDomain,
  type MaterialRequestOrigin,
  type MaterialRequestStatus,
} from './constants/material-request.constant';

export interface MaterialActor {
  actorType: 'ADMIN' | 'CUSTOMER' | 'SYSTEM';
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

export interface IssueMaterialRequestInput {
  customerId: string;
  sumsubApplicantId: string;
  materialType: string;
  levelName: string;
  applicantActionId: string;
  externalActionId: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  origin: MaterialRequestOrigin;
  reason: string;
  issuedBy: string;
}

export interface MaterialRequestRow {
  requestNo: string;
  customerId: string;
  materialType: string;
  levelName: string;
  /** Sumsub 侧 id —— 服务端专用，禁止进任何客户面响应（spec I2 / G5） */
  applicantActionId: string;
  externalActionId: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: MaterialRequestOrigin;
  status: MaterialRequestStatus;
  reason: string;
  issuedBy: string;
  issuedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  traceId: string;
}

const REQUEST_NO_MAX_ATTEMPTS = 5;

/**
 * 材料请求账的实体守卫 —— 设计稿 2026-08-17 §2。
 *
 * 一行 = 一次下发。本 service **只**守单表不变量（状态机、同空同非空、幂等、编号防撞）
 * 与审计；开便签 / 调 Sumsub / 发域事件全在编排层（issuer / review service），
 * 不在这里。
 */
@Injectable()
export class MaterialRequestsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    input: IssueMaterialRequestInput,
    tx?: Record<string, any>,
  ): Promise<MaterialRequestRow> {
    // spec I3：半绑状态无法判定展示位置，直接拒
    const bound = input.orderDomain !== null;
    if (bound !== (input.orderRef !== null)) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_HALF_BOUND',
        message: 'orderDomain and orderRef must both be set or both be null',
      });
    }

    const client = (tx ?? this.prisma) as Record<string, any>;
    const traceId = `MATERIAL_REQUEST:${randomUUID()}`;

    // G9：generateReferenceNo 只有 4 位随机，BACKLOG:160 记载实测撞过号。
    // requestNo 有 @unique，撞了是 P2002 —— 重生成重试，别把它抛给调用方。
    let created: any = null;
    for (let attempt = 0; attempt < REQUEST_NO_MAX_ATTEMPTS; attempt += 1) {
      try {
        created = await client.materialRequest.create({
          data: {
            requestNo: generateReferenceNo('MRQ'),
            customerId: input.customerId,
            sumsubApplicantId: input.sumsubApplicantId,
            materialType: input.materialType,
            levelName: input.levelName,
            applicantActionId: input.applicantActionId,
            externalActionId: input.externalActionId,
            orderDomain: input.orderDomain,
            orderRef: input.orderRef,
            origin: input.origin,
            status: 'PENDING_SUBMISSION',
            reason: input.reason,
            issuedBy: input.issuedBy,
            traceId,
          },
        });
        break;
      } catch (e: any) {
        // externalActionId 也是 @unique —— 那个撞号不该重试（重试会造出第二行
        // 指向同一个 Sumsub action），只有 requestNo 撞才重试。
        const target = String(e?.meta?.target ?? '');
        if (e?.code === 'P2002' && !target.includes('externalActionId')) continue;
        throw e;
      }
    }
    if (!created) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_NO_COLLISION',
        message: `Failed to allocate a unique requestNo after ${REQUEST_NO_MAX_ATTEMPTS} attempts`,
      });
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.MATERIAL_REQUEST_ISSUED,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: created.id,
      entityNo: created.requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: input.customerId,
      result: AuditResult.SUCCESS,
      reason: input.reason,
      metadata: {
        materialType: input.materialType,
        levelName: input.levelName,
        origin: input.origin,
        orderDomain: input.orderDomain,
        orderRef: input.orderRef,
        applicantActionId: input.applicantActionId,
      },
      sourcePlatform: 'SYSTEM',
    }, client);

    return this.project(created);
  }

  async attachRestriction(
    requestNo: string,
    restrictionNo: string,
    tx?: Record<string, any>,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as Record<string, any>;
    await client.materialRequest.update({
      where: { requestNo },
      data: { restrictionNo },
    });
  }

  async findByNo(requestNo: string): Promise<MaterialRequestRow | null> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    return row ? this.project(row) : null;
  }

  async findByExternalActionId(externalActionId: string): Promise<MaterialRequestRow | null> {
    const row = await this.prisma.materialRequest.findFirst({ where: { externalActionId } });
    return row ? this.project(row) : null;
  }

  async listLiveByCustomer(customerId: string): Promise<MaterialRequestRow[]> {
    const rows = await this.prisma.materialRequest.findMany({
      where: { customerId, status: { in: [...MATERIAL_REQUEST_LIVE_STATUSES] } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r: any) => this.project(r));
  }

  /** 后台客户详情用：全集，含终态（G6 —— 后台那一列全是「露」，没有例外） */
  async listAllByCustomer(customerId: string): Promise<MaterialRequestRow[]> {
    const rows = await this.prisma.materialRequest.findMany({
      where: { customerId },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r: any) => this.project(r));
  }

  async listLiveByOrder(
    orderDomain: MaterialRequestOrderDomain,
    orderRef: string,
  ): Promise<MaterialRequestRow[]> {
    const rows = await this.prisma.materialRequest.findMany({
      where: { orderDomain, orderRef, status: { in: [...MATERIAL_REQUEST_LIVE_STATUSES] } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r: any) => this.project(r));
  }

  /**
   * 客户提交回执。幂等恒成功：write-once 条件更新，只在 PENDING_SUBMISSION 时落章。
   * 重复提交 / 状态不对一律静默返回 false —— 与充值/提现 submit 端点同款
   * 「恒 2xx、不吐状态机信息」姿态，别让客户从错误码里读出自己的处境。
   */
  async markSubmitted(requestNo: string, actor: MaterialActor): Promise<boolean> {
    const res = await this.prisma.materialRequest.updateMany({
      where: { requestNo, status: 'PENDING_SUBMISSION' },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    if (res.count === 0) return false;

    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.MATERIAL_REQUEST_SUBMITTED,
        entityType: AuditEntityTypes.MATERIAL_REQUEST,
        entityId: row?.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
        traceId: row?.traceId,
        result: AuditResult.SUCCESS,
        reason: 'Customer submitted requested materials',
      },
      {
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole ?? 'CUSTOMER',
      },
    );
    return true;
  }

  /**
   * 落裁决。RED 必须带 rejectType —— 不许默默当成 FINAL 把单关掉，
   * 也不许默默当成 RETRY 让运营永远关不了单（树上两条旧路各犯了其中一个）。
   *
   * @param tx 传了外部事务（如 material-request-review 的落章事务）就在其内跑，
   * 不再另开一层 —— 落章与自动撕便签必须同生共死。不传则照旧走事务外 base client，
   * 行为与此前逐字一致。
   */
  async markReviewed(
    requestNo: string,
    answer: 'GREEN' | 'RED',
    rejectType: 'RETRY' | 'FINAL' | null,
    actor: MaterialActor,
    tx?: Record<string, any>,
  ): Promise<MaterialRequestRow> {
    const client = (tx ?? this.prisma) as Record<string, any>;
    const row = await client.materialRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Material request not found: ${requestNo}`);

    if (answer === 'RED' && rejectType !== 'RETRY' && rejectType !== 'FINAL') {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_REJECT_TYPE_REQUIRED',
        message: "RED review must carry reviewRejectType 'RETRY' or 'FINAL'",
      });
    }

    const action =
      answer === 'GREEN'
        ? 'REVIEW_GREEN'
        : rejectType === 'RETRY'
          ? 'REVIEW_RED_RETRY'
          : 'REVIEW_RED_FINAL';
    // 非法边（含对终态行裁决）在这里抛 BadRequestException
    const nextStatus = nextMaterialRequestStatus(row.status as MaterialRequestStatus, action);

    // 先查后写会撞并发：同一 requestNo 被重复/并发裁决时两次调用都可能读到
    // row.status 各自写入。改成带 status 条件的原子卡位（同 markSubmitted 范式）——
    // 只有 status 仍等于读出时的值才落章，否则说明这一行已被别人改过。
    const res = await client.materialRequest.updateMany({
      where: { requestNo, status: row.status },
      data: {
        status: nextStatus,
        reviewAnswer: answer,
        reviewRejectType: rejectType,
        reviewedAt: new Date(),
        // RETRY 是「用同一个 action 重交」：清提交章让客户能再进认证页，
        // applicantActionId / externalActionId 一个都不动（spec §2.2）
        ...(action === 'REVIEW_RED_RETRY' ? { submittedAt: null } : {}),
      },
    });
    if (res.count === 0) {
      // 那次裁决没有生效 —— 不写审计，别留成功痕迹。
      throw new ConflictException({
        code: 'MATERIAL_REQUEST_CONCURRENT_REVIEW',
        message: `Material request ${requestNo} was modified concurrently; review not applied`,
      });
    }
    const updated = await client.materialRequest.findUnique({ where: { requestNo } });

    const auditAction =
      action === 'REVIEW_GREEN'
        ? AuditActions.MATERIAL_REQUEST_APPROVED
        : action === 'REVIEW_RED_RETRY'
          ? AuditActions.MATERIAL_REQUEST_RETRY_REQUESTED
          : AuditActions.MATERIAL_REQUEST_REJECTED;

    await this.auditLogsService.recordSystem({
      action: auditAction,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: row.id,
      entityNo: requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId: row.traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason: `Sumsub action review ${answer}${rejectType ? ` (${rejectType})` : ''}`,
      metadata: { reviewAnswer: answer, reviewRejectType: rejectType, decidedBy: actor.actorNo ?? actor.actorId },
      sourcePlatform: 'SYSTEM',
    }, client);

    return this.project(updated);
  }

  async cancel(requestNo: string, cancelReason: string, actor: MaterialActor): Promise<void> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Material request not found: ${requestNo}`);
    nextMaterialRequestStatus(row.status as MaterialRequestStatus, 'CANCEL');

    await this.prisma.materialRequest.update({
      where: { requestNo },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.MATERIAL_REQUEST_CANCELLED,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: row.id,
      entityNo: requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId: row.traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason: cancelReason,
      metadata: { cancelledBy: actor.actorNo ?? actor.actorId },
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * 解绑订单。挂了限制的行在订单进终态时走这条 —— 从订单页撤下，
   * 但「这个人还欠这份材料」这件事留在客户级横幅上（spec §5.1 第二条）。
   */
  async unbindOrder(requestNo: string, actor: MaterialActor): Promise<void> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Material request not found: ${requestNo}`);

    await this.prisma.materialRequest.update({
      where: { requestNo },
      // spec I3：两列同空同非空，解绑必须一起置空
      data: { orderDomain: null, orderRef: null },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.MATERIAL_REQUEST_ORDER_UNBOUND,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: row.id,
      entityNo: requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId: row.traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason: `Order ${row.orderDomain}/${row.orderRef} reached a terminal state; restriction-bearing request kept at customer level`,
      metadata: { unboundBy: actor.actorNo ?? actor.actorId },
      sourcePlatform: 'SYSTEM',
    });
  }

  private project(row: any): MaterialRequestRow {
    return {
      requestNo: row.requestNo,
      customerId: row.customerId,
      materialType: row.materialType,
      levelName: row.levelName,
      applicantActionId: row.applicantActionId,
      externalActionId: row.externalActionId,
      orderDomain: row.orderDomain ?? null,
      orderRef: row.orderRef ?? null,
      restrictionNo: row.restrictionNo ?? null,
      origin: row.origin,
      status: row.status,
      reason: row.reason,
      issuedBy: row.issuedBy,
      issuedAt: row.issuedAt,
      submittedAt: row.submittedAt ?? null,
      reviewedAt: row.reviewedAt ?? null,
      reviewAnswer: row.reviewAnswer ?? null,
      reviewRejectType: row.reviewRejectType ?? null,
      cancelledAt: row.cancelledAt ?? null,
      cancelReason: row.cancelReason ?? null,
      traceId: row.traceId,
    };
  }
}
