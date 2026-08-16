import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditActorContext, AuditResult } from '../../audit-logging/dto/audit-log.dto';
import {
  ApprovalDecidedEvent,
} from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import {
  RestrictionCause,
  RestrictionReleasePolicy,
} from './constants/restriction-cause.constant';
import {
  CustomerRestrictionsService,
  OpenRestrictionInput,
  RestrictionRow,
} from './customer-restrictions.service';

/** releasePolicy → 审批 actionType。两条线共用一个 workflowType，故只有一个 decided 事件。 */
const RELEASE_ACTION_TYPE: Record<RestrictionReleasePolicy, string> = {
  MLRO_APPROVAL: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO,
  OPS_APPROVAL: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS,
};

/**
 * 限制便签的编排层：贴（立即生效，不开审批）/ 发起人工撕（开审批案，不写便签表）/
 * 审批落地撕 / 机制自动撕。审计全部在本层写；便签表的写入一律经
 * CustomerRestrictionsService（Rule 5：workflow 不直写 domain 表）。
 *
 * 不对称范式（设计稿 §3.3 R4）：摁住是低风险可回退动作，放行才是高风险动作 ——
 * 与 DEPOSIT_UNFREEZE / WITHDRAW_UNFREEZE 一致。
 */
@Injectable()
export class CustomerRestrictionWorkflowService {
  private readonly logger = new Logger(CustomerRestrictionWorkflowService.name);

  constructor(
    private readonly restrictions: CustomerRestrictionsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * 贴便签：立即生效，不开审批。幂等命中（created=false）时不重复落库，但仍写一条
   * CUSTOMER_RESTRICTION_ADDED 说明"重复请求已忽略"，保证运营动作在审计上可追。
   */
  /** 与 deposit/withdraw workflow 逐字同款的 actor 投影，保持审计字段口径一致。 */
  private toAuditActor(actor: ApprovalActorContext): AuditActorContext {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
    } as AuditActorContext;
  }

  async openRestriction(
    input: OpenRestrictionInput,
    actor: ApprovalActorContext,
  ): Promise<{ restrictionNo: string; created: boolean }> {
    const { restrictionNo, created } = await this.restrictions.open(input);

    const row = await this.restrictions.findByNo(restrictionNo);
    if (!row) {
      throw new NotFoundException(`Restriction not found right after open: ${restrictionNo}`);
    }

    const auditActor = this.toAuditActor(actor);
    await this.audit(
      AuditActions.CUSTOMER_RESTRICTION_ADDED,
      row,
      auditActor,
      created
        ? `${row.cause} restriction opened: ${row.reason}`
        : `${row.cause} restriction already open — duplicate request ignored: ${row.reason}`,
      { releaseMode: null, approvalNo: null, releaseOrderRef: null },
    );

    // 制裁便签额外写 CUSTOMER_FROZEN：客户级冻结在审计上单独可检索。
    if (created && row.cause === 'SANCTION') {
      await this.audit(
        AuditActions.CUSTOMER_FROZEN,
        row,
        auditActor,
        `Customer frozen by sanction restriction ${row.restrictionNo}`,
        { releaseMode: null, approvalNo: null, releaseOrderRef: null },
      );
    }

    return { restrictionNo, created };
  }

  /**
   * 发起人工撕：只读校验 + 防重复开案 + 开审批案，不碰便签表（便签保持 OPEN，
   * 直到 onReleaseDecided 收到 APPROVED）。审批提交本身由 ApprovalsService
   * 写 APPROVAL_SUBMITTED 审计，故此处不再另写一条。
   */
  async initiateRelease(
    restrictionNo: string,
    dto: { reason: string; releaseOrderRef?: string },
    actor: ApprovalActorContext,
  ): Promise<{ approvalNo: string }> {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Release reason is required');
    }

    const row = await this.restrictions.findByNo(restrictionNo);
    if (!row) {
      throw new NotFoundException(`Restriction not found: ${restrictionNo}`);
    }
    if (row.status !== 'OPEN') {
      throw new BadRequestException(
        `Restriction ${restrictionNo} is already RELEASED, cannot open a release approval`,
      );
    }
    // MLRO 类（SANCTION / KYT_REJECTED_HARD）必须有政府解除令文书号才允许发起。
    if (row.releasePolicy === 'MLRO_APPROVAL' && !dto.releaseOrderRef?.trim()) {
      throw new BadRequestException(
        `Restriction ${restrictionNo} requires a government release order reference (releaseOrderRef)`,
      );
    }

    const actionType = RELEASE_ACTION_TYPE[row.releasePolicy];

    // 防重复开案：一张便签不得同时挂两个待决解除案。
    const openCases = await this.approvalsService.list({
      actionType,
      entityRef: restrictionNo,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openCases.total > 0) {
      throw new ConflictException(
        `Restriction ${restrictionNo} already has a pending release approval; resolve it before submitting another.`,
      );
    }

    const traceId = row.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType,
        entityRef: restrictionNo,
        traceId,
        objectSnapshot: {
          restrictionNo,
          cause: row.cause,
          reason: dto.reason,
          releaseOrderRef: dto.releaseOrderRef?.trim() || null,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    return { approvalNo: approvalCase.approvalNo };
  }

  /**
   * 解除案决议落地。非 APPROVED 一律只记日志、便签原样保持 OPEN。
   * APPROVED 时先把 releaseOrderRef 从 objectSnapshot 反查回来（守卫先于变更），
   * 再撕便签、写审计。
   */
  @OnEvent('workflow.customer-restriction-release.decided', { async: true })
  async onReleaseDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Restriction ${event.entityRef} release ${event.decision} (case ${event.approvalNo}) — restriction stays OPEN, nothing released.`,
      );
      return;
    }

    const row = await this.restrictions.findByNo(event.entityRef);
    if (!row) {
      throw new Error(
        `Restriction ${event.entityRef}: approved release case has no matching restriction`,
      );
    }
    if (row.status !== 'OPEN') {
      this.logger.warn(
        `Restriction ${event.entityRef} already RELEASED (case ${event.approvalNo}) — skipping duplicate release.`,
      );
      return;
    }

    const releaseOrderRef = await this.fetchApprovedReleaseOrderRef(event.actionType, event.entityRef);
    if (row.releasePolicy === 'MLRO_APPROVAL' && !releaseOrderRef) {
      throw new Error(
        `Restriction ${event.entityRef}: MLRO release approved with no releaseOrderRef in objectSnapshot`,
      );
    }

    const releasedBy = event.decisionByUserId || 'SYSTEM';
    await this.restrictions.release(event.entityRef, {
      releasedBy,
      releaseMode: 'MANUAL',
      releaseApprovalNo: event.approvalNo,
      ...(releaseOrderRef ? { releaseOrderRef } : {}),
    });

    await this.auditRelease(
      row,
      {
        actorType: 'ADMIN',
        actorId: releasedBy,
        actorNo: event.decisionByUserNo || undefined,
        actorRole: event.decisionByRole || 'MLRO',
      },
      'MANUAL',
      event.approvalNo,
      releaseOrderRef,
    );
  }

  /**
   * 自动撕：由 cause 自身机制触发（材料到齐、Sumsub 转 GREEN、升级审批通过等），
   * 不走审批、releaseMode=AUTO。没有对应 OPEN 便签时静默 no-op —— 机制可能被
   * 重复触发，不该因此报错。
   */
  async autoRelease(
    customerId: string,
    cause: RestrictionCause,
    caseRef: string | null,
    actorId: string,
  ): Promise<void> {
    const row = await this.restrictions.findOpenByCause(customerId, cause, caseRef);
    if (!row) {
      this.logger.log(
        `Auto-release skip: customer ${customerId} has no OPEN ${cause} restriction for caseRef ${caseRef ?? '—'}`,
      );
      return;
    }

    await this.restrictions.release(row.restrictionNo, {
      releasedBy: actorId,
      releaseMode: 'AUTO',
    });

    await this.auditRelease(
      row,
      { actorType: 'SYSTEM', actorId, actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
      'AUTO',
      null,
      null,
    );
  }

  /**
   * ApprovalDecidedEvent.metadata 恒为 {}（见 approval-handler.base.ts 的
   * emitDecidedEvent），releaseOrderRef 只能按 actionType + entityRef + APPROVED
   * 反查 objectSnapshot 取回 —— 复刻 WithdrawWorkflowService.fetchApprovedOrderRef。
   * 快照本身取不到即数据损坏，直接抛；此调用在任何变更之前，抛出时便签仍是 OPEN。
   * OPS 类允许 releaseOrderRef 缺省（返回 null），MLRO 类的必填由调用方复核。
   */
  private async fetchApprovedReleaseOrderRef(
    actionType: string,
    restrictionNo: string,
  ): Promise<string | null> {
    const { items } = await this.approvalsService.list({
      actionType,
      entityRef: restrictionNo,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    });
    const snapshot = items[0]?.objectSnapshot as { releaseOrderRef?: string | null } | null | undefined;
    if (!snapshot) {
      throw new Error(
        `Restriction ${restrictionNo}: no APPROVED ${actionType} case with an objectSnapshot found`,
      );
    }
    return snapshot.releaseOrderRef?.trim() || null;
  }

  private async auditRelease(
    row: RestrictionRow,
    actor: AuditActorContext,
    releaseMode: 'AUTO' | 'MANUAL',
    approvalNo: string | null,
    releaseOrderRef: string | null,
  ): Promise<void> {
    await this.audit(
      AuditActions.CUSTOMER_RESTRICTION_CLEARED,
      row,
      actor,
      `${row.cause} restriction ${row.restrictionNo} released (${releaseMode})`,
      { releaseMode, approvalNo, releaseOrderRef },
    );

    if (row.cause === 'SANCTION') {
      await this.audit(
        AuditActions.CUSTOMER_UNFROZEN,
        row,
        actor,
        `Customer unfrozen — sanction restriction ${row.restrictionNo} released (${releaseMode})`,
        { releaseMode, approvalNo, releaseOrderRef },
      );
    }
  }

  private async audit(
    action: string,
    row: RestrictionRow,
    actor: AuditActorContext,
    reason: string,
    extra: {
      releaseMode: 'AUTO' | 'MANUAL' | null;
      approvalNo: string | null;
      releaseOrderRef: string | null;
    },
  ): Promise<void> {
    // entityNo / entityOwnerNo（customerNo）由 AuditLogsService 自行解析，
    // 见 resolveEntityNo 的 CUSTOMER 映射 —— 本服务因此无需注入 Prisma。
    await this.auditLogsService.recordByActor(
      {
        action,
        entityType: AuditEntityTypes.CUSTOMER,
        entityId: row.customerId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: row.customerId,
        traceId: row.traceId,
        workflowType: AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE,
        result: AuditResult.SUCCESS,
        reason,
        metadata: {
          restrictionNo: row.restrictionNo,
          cause: row.cause,
          scopes: row.scopes,
          visibility: row.visibility,
          releaseMode: extra.releaseMode,
          approvalNo: extra.approvalNo,
          releaseOrderRef: extra.releaseOrderRef,
        },
        sourcePlatform: actor.actorType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      },
      actor,
    );
  }
}
