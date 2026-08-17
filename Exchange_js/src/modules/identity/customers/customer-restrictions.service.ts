import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import type { CustomerRestriction as CustomerRestrictionRecord } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionCausePolicy,
  RestrictionReleasePolicy,
  RestrictionScope,
  RestrictionVisibility,
} from './constants/restriction-cause.constant';

export interface OpenRestrictionInput {
  customerId: string;
  cause: RestrictionCause;
  /** 仅 cause.scopeSelectable 为 true（PENDING_DOCUMENT）时生效，其余一律用注册表默认值 */
  scopes?: RestrictionScope[];
  reason: string;
  caseRef?: string | null;
  openedBy: string;
}

/** 一张便签的聚合视图：同 restrictionNo 的多行折成一行，scope 收进 scopes */
export interface RestrictionRow {
  restrictionNo: string;
  customerId: string;
  scopes: RestrictionScope[];
  cause: RestrictionCause;
  visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy;
  status: 'OPEN' | 'RELEASED';
  reason: string;
  caseRef: string | null;
  releaseOrderRef: string | null;
  openedAt: Date;
  openedBy: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseApprovalNo: string | null;
  releaseMode: 'AUTO' | 'MANUAL' | null;
  traceId: string;
}

/**
 * 限制账（customer_restrictions）的实体守卫 —— 设计稿 2026-08-15 §3.2/§3.3。
 *
 * 一行 = 一次摁住的一个能力；一张便签 = 同一个 restrictionNo 下的多行，**同贴同撕、同一事务**。
 * 本 service 只守单实体不变量（查表落 visibility/releasePolicy、幂等、同号原子撕）与审计；
 * 审批编排在 CustomerRestrictionWorkflowService，读侧收口在 CustomerAccessService。
 */
@Injectable()
export class CustomerRestrictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * @param tx 传了外部事务（如 material-request-issuer 的落行事务）就在其内跑，不再
   * 另开一层 —— SQLite 单写者模型下嵌套 $transaction 会等锁甚至报错，而且贴便签必须
   * 与调用方的其它写入同生共死（不许出现「行落了、便签没贴上」的半成品）。不传则照旧
   * 自己开一个事务，行为与此前逐字一致。
   */
  async open(
    input: OpenRestrictionInput,
    tx?: Record<string, any>,
  ): Promise<{ restrictionNo: string; created: boolean }> {
    const policy = RESTRICTION_CAUSE_POLICY[input.cause];
    if (!policy) throw new BadRequestException(`Unknown restriction cause: ${input.cause}`);

    const caseRef = input.caseRef ?? null;
    // R2：scope 只有 scopeSelectable 的 cause 才听运营的
    const scopes =
      policy.scopeSelectable && input.scopes && input.scopes.length > 0
        ? [...input.scopes]
        : [...policy.defaultScopes];

    // 幂等查 + 插入必须同处一个事务：分开做的话两个并发写入方（到期 cron 与 admin 手工）
    // 会各自查到空、各贴一张，(customerId, cause, caseRef) 就不再是「最多一条 OPEN」。
    const outcome = tx
      ? await this.openWithin(tx, input, policy, scopes, caseRef)
      : await this.prisma.$transaction((innerTx: Record<string, any>) =>
          this.openWithin(innerTx, input, policy, scopes, caseRef),
        );

    const auditShell = {
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: input.customerId,
      entityNo: outcome.customerNo || undefined,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: input.customerId,
      entityOwnerNo: outcome.customerNo || undefined,
      traceId: outcome.traceId,
      reason: input.reason,
      metadata: {
        restrictionNo: outcome.restrictionNo,
        cause: input.cause,
        scopes: outcome.scopes,
        visibility: policy.visibility,
        releaseMode: null,
        caseRef,
        openedBy: input.openedBy,
      },
    };

    await this.auditLogsService.recordSystem({
      ...auditShell,
      action: AuditActions.CUSTOMER_RESTRICTION_ADDED,
      result: outcome.created ? AuditResult.SUCCESS : AuditResult.SKIPPED,
    });

    // CUSTOMER_FROZEN 此前零写入方，本轮由制裁便签激活
    if (outcome.created && input.cause === 'SANCTION') {
      await this.auditLogsService.recordSystem({
        ...auditShell,
        action: AuditActions.CUSTOMER_FROZEN,
        result: AuditResult.SUCCESS,
      });
    }

    // 只有「卡住全部能力」的便签才广播——三个交易域订阅它去冻在途单。
    // scope < ALL 的便签刻意不发（设计稿 §3.5：材料过期不该把已在路上的提现拽回来）。
    // 幂等 no-op（created=false）也不发：没有新的摁住发生。
    if (outcome.created && policy.defaultScopes.includes('ALL')) {
      this.eventEmitter.emit(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, {
        customerId: input.customerId,
        restrictionNo: outcome.restrictionNo,
        cause: input.cause,
        blocksAllCapabilities: true as const,
        traceId: outcome.traceId,
      });
    }

    return { restrictionNo: outcome.restrictionNo, created: outcome.created };
  }

  /** open() 的事务体：幂等查 + 插入。抽出来是为了不管事务是外部传入的还是自己开的，跑同一份逻辑。 */
  private async openWithin(
    tx: Record<string, any>,
    input: OpenRestrictionInput,
    policy: RestrictionCausePolicy,
    scopes: RestrictionScope[],
    caseRef: string | null,
  ): Promise<{
    customerNo: string;
    restrictionNo: string;
    traceId: string;
    scopes: RestrictionScope[];
    created: boolean;
  }> {
    const customer = await tx.customerMain.findUnique({
      where: { id: input.customerId },
      select: { id: true, customerNo: true },
    });
    if (!customer) throw new NotFoundException(`Customer not found: ${input.customerId}`);

    // caseRef 为 null 的手工便签不去重 —— 运营可对同一客户开多张 PENDING_DOCUMENT，各要一份材料
    if (caseRef !== null) {
      const existing = await tx.customerRestriction.findFirst({
        where: { customerId: input.customerId, cause: input.cause, caseRef, status: 'OPEN' },
      });
      if (existing) {
        const siblings = await tx.customerRestriction.findMany({
          where: { restrictionNo: existing.restrictionNo },
          orderBy: { scope: 'asc' },
        });
        return {
          customerNo: customer.customerNo,
          restrictionNo: existing.restrictionNo,
          traceId: existing.traceId,
          scopes: siblings.map((row: CustomerRestrictionRecord) => row.scope as RestrictionScope),
          created: false,
        };
      }
    }

    const restrictionNo = generateReferenceNo('RST');
    const traceId = `CUSTOMER_RESTRICTION:${randomUUID()}`;
    await tx.customerRestriction.createMany({
      data: scopes.map((scope) => ({
        restrictionNo,
        customerId: input.customerId,
        scope,
        cause: input.cause,
        // R1：visibility / releasePolicy 查表落库，入参永远碰不到这两列
        visibility: policy.visibility,
        releasePolicy: policy.releasePolicy,
        status: 'OPEN',
        reason: input.reason,
        caseRef,
        openedBy: input.openedBy,
        traceId,
      })),
    });

    return { customerNo: customer.customerNo, restrictionNo, traceId, scopes, created: true };
  }

  /**
   * 撕便签：以 restrictionNo 为单位，同号全部 OPEN 行一个事务里一起置 RELEASED。
   * 已经 RELEASED 视为幂等成功（重投的审批事件、自动撕与人工撕撞车都会走到这里）。
   */
  async release(
    restrictionNo: string,
    opts: {
      releasedBy: string;
      releaseMode: 'AUTO' | 'MANUAL';
      releaseApprovalNo?: string;
      releaseOrderRef?: string;
    },
  ): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.customerRestriction.findMany({
        where: { restrictionNo },
        orderBy: { scope: 'asc' },
      });
      if (rows.length === 0) throw new NotFoundException(`Restriction not found: ${restrictionNo}`);

      const openRows = rows.filter((row) => row.status === 'OPEN');
      if (openRows.length === 0) {
        return { released: false, rows: openRows, customerNo: null as string | null };
      }

      const customer = await tx.customerMain.findUnique({
        where: { id: rows[0].customerId },
        select: { customerNo: true },
      });
      await tx.customerRestriction.updateMany({
        where: { restrictionNo, status: 'OPEN' },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releasedBy: opts.releasedBy,
          releaseMode: opts.releaseMode,
          releaseApprovalNo: opts.releaseApprovalNo ?? null,
          releaseOrderRef: opts.releaseOrderRef ?? null,
        },
      });

      return { released: true, rows: openRows, customerNo: customer?.customerNo ?? null };
    });

    if (!outcome.released) return;

    const first = outcome.rows[0];
    const auditShell = {
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: first.customerId,
      entityNo: outcome.customerNo || undefined,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: first.customerId,
      entityOwnerNo: outcome.customerNo || undefined,
      // traceId 撕时继承便签行上的值（贴时生成）
      traceId: first.traceId,
      result: AuditResult.SUCCESS,
      reason: `${first.cause} released by ${opts.releaseMode.toLowerCase()}`,
      metadata: {
        restrictionNo,
        cause: first.cause,
        scopes: outcome.rows.map((row) => row.scope),
        visibility: first.visibility,
        releaseMode: opts.releaseMode,
        approvalNo: opts.releaseApprovalNo ?? null,
        releaseOrderRef: opts.releaseOrderRef ?? null,
      },
    };

    await this.auditLogsService.recordSystem({
      ...auditShell,
      action: AuditActions.CUSTOMER_RESTRICTION_CLEARED,
    });

    if (first.cause === 'SANCTION') {
      await this.auditLogsService.recordSystem({
        ...auditShell,
        action: AuditActions.CUSTOMER_UNFROZEN,
      });
    }
  }

  /** @param tx 传了就用它读（例如 openRestriction 在 open() 的同一事务里读回刚贴的便签），不传照旧读事务外的 base client。 */
  async findByNo(restrictionNo: string, tx?: Record<string, any>): Promise<RestrictionRow | null> {
    const client = (tx ?? this.prisma) as Record<string, any>;
    const rows = await client.customerRestriction.findMany({
      where: { restrictionNo },
      orderBy: { scope: 'asc' },
    });
    if (rows.length === 0) return null;
    return this.toRows(rows)[0];
  }

  async listOpen(customerId: string): Promise<RestrictionRow[]> {
    const rows = await this.prisma.customerRestriction.findMany({
      where: { customerId, status: 'OPEN' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    return this.toRows(rows);
  }

  async listAll(customerId: string): Promise<RestrictionRow[]> {
    const rows = await this.prisma.customerRestriction.findMany({
      where: { customerId },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    return this.toRows(rows);
  }

  /**
   * 幂等键的读侧。caseRef 传具体值 = 精确匹配那张便签；传 null = 不限 caseRef、
   * 取该 cause 下最早一张 OPEN —— 自动撕的触发方（如 Sumsub GREEN 回调）往往只知道
   * cause，不知道当初贴的时候挂的是哪个业务号。
   */
  async findOpenByCause(
    customerId: string,
    cause: RestrictionCause,
    caseRef: string | null,
  ): Promise<RestrictionRow | null> {
    const hit = await this.prisma.customerRestriction.findFirst({
      where: {
        customerId,
        cause,
        status: 'OPEN',
        ...(caseRef === null ? {} : { caseRef }),
      },
      orderBy: { openedAt: 'asc' },
    });
    if (!hit) return null;
    return this.findByNo(hit.restrictionNo);
  }

  /** 同 restrictionNo 的多行折成一行，scope 收进 scopes（对外一律以便签为单位） */
  private toRows(records: CustomerRestrictionRecord[]): RestrictionRow[] {
    const byNo = new Map<string, RestrictionRow>();
    for (const record of records) {
      const existing = byNo.get(record.restrictionNo);
      if (existing) {
        existing.scopes.push(record.scope as RestrictionScope);
        continue;
      }
      byNo.set(record.restrictionNo, {
        restrictionNo: record.restrictionNo,
        customerId: record.customerId,
        scopes: [record.scope as RestrictionScope],
        cause: record.cause as RestrictionCause,
        visibility: record.visibility as RestrictionVisibility,
        releasePolicy: record.releasePolicy as RestrictionReleasePolicy,
        status: record.status as 'OPEN' | 'RELEASED',
        reason: record.reason,
        caseRef: record.caseRef,
        releaseOrderRef: record.releaseOrderRef,
        openedAt: record.openedAt,
        openedBy: record.openedBy,
        releasedAt: record.releasedAt,
        releasedBy: record.releasedBy,
        releaseApprovalNo: record.releaseApprovalNo,
        releaseMode: record.releaseMode as 'AUTO' | 'MANUAL' | null,
        traceId: record.traceId,
      });
    }
    return [...byNo.values()];
  }
}
