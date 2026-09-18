// src/modules/trading/shared/fee-level-workflow.base.ts
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditOutcome, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { assertFeeLevelTransition, FeeLevelAction } from './fee-level-transitions.constant';

/**
 * C2 · fee-level 三对 workflow（creation/change/retire × withdrawal/swap）共同骨架。
 * 三对逐对归一化 diff 分别是 0（change）/ 4（retire）/ 29（creation）行——残差全部是
 * "资产是单列 assetId 还是双列 fromAssetId+toAssetId" 这一处 schema 形状差异，渗进
 * 部分方法的审计快照(objectSnapshot/afterData)与 createLevel 入参，不是业务分支逻辑。
 * 按裁决"若渗进 workflow，留域"：形状差异本身不进基类实现，只留一个 abstract 钩子
 * (assetFields)，具体返回哪些字段仍由两个子类各自决定；基类只知道"调用它、把结果
 * 展开进对象"，不知道字段叫什么、有几个。
 *
 * 审批接线（ApprovalsService.createAndSubmit 正门）与审计动作码在这里逐字保留：
 * entityType/approvalActionType 两个 getter 返回的就是原文件里的 AuditEntityTypes /
 * ApprovalActionTypes 常量本身（不是重新拼出来的字符串），动作码字符串用
 * `${entityType}_XXX` 模板拼接——已逐个核对与原文件字面量字节相同。
 */

// ─────────────────────────────────────────────────────────
// Retire workflow base
// ─────────────────────────────────────────────────────────

export abstract class FeeLevelRetireWorkflowBase {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly feeLevelService: any,
    protected readonly approvalsService: ApprovalsService,
    protected readonly auditLogsService: AuditLogsService,
  ) {}

  protected abstract get entityType(): string;
  protected abstract get approvalActionType(): string;
  /** 'Withdrawal' | 'Swap'——仅用于拼日志文案，逐字对齐原文件 */
  protected abstract get domainLabel(): string;
  /** { assetId } | { fromAssetId, toAssetId }——留域的资产形状差异 */
  protected abstract assetFields(source: any): Record<string, unknown>;

  protected toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',
      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async requestRetire(levelCode: string, reason: string, actor: ApprovalActorContext) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    assertFeeLevelTransition(level.status, FeeLevelAction.RETIRE);
    if (level.approvalCaseNo || level.pendingChangeRequest) {
      throw new ConflictException(`Level ${levelCode} already has a pending approval (${level.approvalCaseNo ?? level.pendingChangeRequest?.approvalCaseNo})`);
    }
    await this.feeLevelService.assertNotLastActiveDefault(level);

    // START：本次退役旅程的 correlationId，同一个值写进 ApprovalCase.traceId，下游经 ApprovalDecidedEvent.traceId INHERIT 读回
    const correlationId = crypto.randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: this.approvalActionType,
        entityRef: levelCode,
        traceId: correlationId,
        objectSnapshot: { levelCode, name: level.name, isDefault: level.isDefault, ...this.assetFields(level), reason },
      },
      { reason, traceId: correlationId },
      actor,
    );
    await this.feeLevelService.linkApprovalCase(levelCode, approvalCase.id, approvalCase.approvalNo);

    await this.auditLogsService.recordByActor(
      {
        action: `${this.entityType}_RETIRE_REQUESTED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        beforeData: { status: level.status },
        metadata: { approvalNo: approvalCase.approvalNo },
        requestId: `${this.entityType}_RETIRE_REQUESTED_${levelCode}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { levelCode, approvalNo: approvalCase.approvalNo, status: 'PENDING_APPROVAL' };
  }

  protected async onDecidedCore(event: ApprovalDecidedEvent) {
    if (!event?.entityRef || !event?.approvalId) {
      this.logger.warn(`${this.domainLabel} fee level retire decided event missing entityRef/approvalId`);
      return;
    }
    if (event.decision === 'APPROVED') await this.executeRetire(event);
    else await this.cancelRetire(event);
  }

  private async executeRetire(event: ApprovalDecidedEvent) {
    const levelCode = event.entityRef;
    try {
      // 落地时复检(FIX-11):请求时通过不代表落地时仍成立——两个并行退役请求都能在各自
      // 请求时看到"对方仍 ACTIVE"而通过；此处紧挨 retireLevel 前重跑同一守卫，撞回则
      // 落进下面的 catch，同码 outcome=FAILED + reasonCode=LAST_ACTIVE_DEFAULT。
      const level = await this.feeLevelService.findByLevelCode(levelCode);
      await this.feeLevelService.assertNotLastActiveDefault(level);
      await this.feeLevelService.retireLevel(levelCode);
      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_RETIRED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        approvalNo: event.approvalNo,
        fromStatus: 'ACTIVE',
        toStatus: 'RETIRED',
        metadata: { retiredByUserNo: event.decisionByUserNo },
        requestId: `${this.entityType}_RETIRED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.log(`${this.domainLabel} fee level ${levelCode} retired`);
    } catch (err: any) {
      // 双结局：失败不单独起名——同码 outcome=FAILED + reasonCode；守卫拒绝时 reasonCode 取
      // 守卫自己的 code(如 LAST_ACTIVE_DEFAULT),不是笼统的 EXECUTION_FAILED
      const reasonCode = err?.response?.code ?? 'EXECUTION_FAILED';
      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_RETIRED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode,
        reason: err?.message ?? 'retire execution failed',
        approvalNo: event.approvalNo,
        requestId: `${this.entityType}_RETIRED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.error(`Failed to retire ${this.domainLabel.toLowerCase()} fee level ${levelCode}: ${err?.message}`);
    }
  }

  private async cancelRetire(event: ApprovalDecidedEvent) {
    const levelCode = event.entityRef;
    try {
      await this.feeLevelService.clearApprovalCase(levelCode);
      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_RETIRE_CANCELLED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: levelCode,
        correlationId: event.traceId,
        causationId: event.approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event.decisionReason || `${this.domainLabel} fee level retire request ${String(event.decision).toLowerCase()}`,
        metadata: { decision: event.decision, approvalNo: event.approvalNo },
        requestId: `${this.entityType}_RETIRE_CANCELLED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
    } catch (err: any) {
      this.logger.error(`Failed to cancel retire for ${levelCode}: ${err?.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────
// Creation workflow base
// ─────────────────────────────────────────────────────────

export type FeeLevelCreationDtoBase = {
  levelCode: string;
  name: string;
  isDefault: boolean;
  tiersJson: string;
  reason: string;
  requiredTags?: string[];
  validFrom?: string;
  validTo?: string;
};

export abstract class FeeLevelCreationWorkflowBase<TDto extends FeeLevelCreationDtoBase = FeeLevelCreationDtoBase> {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly feeLevelService: any,
    protected readonly approvalsService: ApprovalsService,
    protected readonly auditLogsService: AuditLogsService,
  ) {}

  protected abstract get entityType(): string;
  protected abstract get approvalActionType(): string;
  protected abstract get domainLabel(): string;
  /** prisma.withdrawalFeeLevel | prisma.swapFeeLevel（本类不支持事务客户端切换，原文件也没有） */
  protected abstract get levelModel(): any;
  /** { assetId } | { fromAssetId, toAssetId }——留域的资产形状差异 */
  protected abstract assetFields(source: any): Record<string, unknown>;

  async initiateCreate(dto: TDto, actor: ApprovalActorContext) {
    const { levelCode, name, isDefault, tiersJson, reason, requiredTags, validFrom, validTo } = dto;

    if (!reason?.trim()) {
      throw new BadRequestException('reason is required');
    }

    // INSERT with PENDING_APPROVAL (uniqueness + tiersJson validation in L1)
    const level = await this.feeLevelService.createLevel({
      levelCode,
      name,
      ...this.assetFields(dto),
      isDefault,
      tiersJson,
      createdByUserId: actor.userId,
      requiredTags,
      validFrom,
      validTo,
    });

    // Create approval case
    // START：本次创建旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeActivation/executeCancellation
    // 经 ApprovalDecidedEvent.traceId INHERIT 读回——与角色定义创建工作流同款模式。
    const correlationId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: this.approvalActionType,
          entityRef: level.levelCode,
          traceId: correlationId,
          objectSnapshot: {
            levelId: level.id,
            levelCode,
            name,
            ...this.assetFields(dto),
            isDefault,
            tiersJson,
            reason,
            requiredTags: requiredTags ?? [],
            validFrom: validFrom ?? null,
            validTo: validTo ?? null,
          },
        },
        { reason, traceId: correlationId },
        actor,
      );
    } catch (err) {
      // Rollback: delete the inserted row
      await this.feeLevelService.deleteById(level.id);
      throw err;
    }

    // Link approval case to level
    await this.feeLevelService.linkApprovalCase(levelCode, approvalCase.id, approvalCase.approvalNo);

    // afterData：CREATE 没有「前」态，只存提案身份本身——不存 status/id/createdAt 等机械字段。
    const afterData = {
      levelCode,
      name,
      ...this.assetFields(dto),
      isDefault,
      tiersJson,
      requiredTags: requiredTags ?? [],
      validFrom: validFrom ?? null,
      validTo: validTo ?? null,
    };

    // Audit
    await this.auditLogsService.recordByActor(
      {
        action: `${this.entityType}_CREATION_REQUESTED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: level.levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason,
        afterData,
        metadata: {
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `${this.entityType}_CREATION_REQUESTED_${level.levelCode}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.userNo || 'UNKNOWN',
        actorDisplayName: actor.userNo || 'UNKNOWN',
        actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
      },
    );

    return {
      levelCode: level.levelCode,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  protected async onDecidedCore(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn(`${this.domainLabel} fee level creation decided event missing approvalId or entityRef`);
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeActivation(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  private async executeActivation(approvalId: string, levelCode: string, event: any) {
    let level: any;
    try {
      level = await this.levelModel.findUnique({
        where: { levelCode },
      });
      if (!level || level.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Level ${levelCode} not found or not in PENDING_APPROVAL status`);
        return;
      }

      await this.feeLevelService.activateLevel(level.levelCode);

      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_CREATION_APPLIED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: level.levelCode,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 initiateCreate 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event?.traceId,
        // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'ACTIVE',
        afterData: {
          levelCode: level.levelCode,
          name: level.name,
          ...this.assetFields(level),
          isDefault: level.isDefault,
          tiersJson: level.tiersJson,
        },
        approvalNo: event?.approvalNo,
        requestId: `${this.entityType}_CREATION_APPLIED_${level.levelCode}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Level ${level.levelCode} activated`);
    } catch (err: any) {
      this.logger.error(`Failed to activate level ${levelCode}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_CREATION_APPLY_FAILED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: level?.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err.message,
        requestId: `${this.entityType}_CREATION_APPLY_FAILED_${levelCode}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(
    approvalId: string,
    levelCode: string,
    decision: string,
    event: any,
  ) {
    try {
      const level = await this.levelModel.findUnique({
        where: { levelCode },
      });
      if (!level) {
        this.logger.warn(`Level ${levelCode} not found for cancellation`);
        return;
      }

      if (decision === 'DECLINED') await this.feeLevelService.declineLevel(level.levelCode);
      else await this.feeLevelService.cancelLevel(level.levelCode);

      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_CREATION_CANCELLED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: level.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event?.decisionReason || `${this.domainLabel} fee level creation request ${String(decision).toLowerCase()}`,
        metadata: { decision },
        requestId: `${this.entityType}_CREATION_CANCELLED_${level.levelCode}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Level ${level.levelCode} creation cancelled (${decision}), row marked ${decision === 'DECLINED' ? 'REJECTED' : 'CANCELLED'}`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel level creation ${levelCode}: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────
// Change workflow base
// ─────────────────────────────────────────────────────────

export abstract class FeeLevelChangeWorkflowBase {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly feeLevelService: any,
    protected readonly approvalsService: ApprovalsService,
    protected readonly auditLogsService: AuditLogsService,
  ) {}

  protected abstract get entityType(): string;
  protected abstract get approvalActionType(): string;
  protected abstract get domainLabel(): string;
  /** prisma.withdrawalFeeLevelChangeRequest | prisma.swapFeeLevelChangeRequest */
  protected abstract get changeRequestModel(): any;

  protected toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',
      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async requestChange(
    levelCode: string,
    proposedTiersJson: string,
    changeReason: string,
    actor: ApprovalActorContext,
  ) {
    // 1. Find level, verify it exists and is ACTIVE
    const level = await this.feeLevelService.findByLevelCode(levelCode);

    if (level.status !== 'ACTIVE') {
      throw new ConflictException(
        `Level ${levelCode} is not ACTIVE (current status: ${level.status}). Cannot submit a change request.`,
      );
    }
    if (level.approvalCaseNo) {
      throw new ConflictException(`Level ${levelCode} has a pending approval (${level.approvalCaseNo})`);
    }

    // 2. Validate input
    if (!changeReason?.trim()) {
      throw new BadRequestException('changeReason is required');
    }

    // 3. Create change request via L1 (validates tiersJson, checks pending duplicates)
    const request = await this.feeLevelService.createChangeRequest({
      levelId: level.id,
      levelCode: level.levelCode,
      proposedTiersJson,
      changeReason: changeReason.trim(),
      requestedByUserId: actor.userId,
    });
    const requestNo = request.requestNo;

    // 4. Create approval case (entityRef = request.requestNo，铁律⑥ 对外用业务键)
    // START：本次变更旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 executeChange/cancelChange 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: this.approvalActionType,
          entityRef: request.requestNo,
          traceId: correlationId,
          objectSnapshot: {
            requestId: request.id,
            requestNo,
            levelId: level.id,
            levelCode: level.levelCode,
            currentTiersJson: level.tiersJson,
            proposedTiersJson,
            changeReason: changeReason.trim(),
          },
        },
        {
          reason: changeReason.trim(),
          traceId: correlationId,
        },
        actor,
      );
    } catch (err) {
      // Rollback: cancel the request row
      await this.feeLevelService.cancelChangeRequest(request.requestNo);
      throw err;
    }

    // 5. Link approval case to request
    await this.feeLevelService.linkApprovalCaseToRequest(request.requestNo, approvalCase.id, approvalCase.approvalNo);

    // 6. Audit CHANGE_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: `${this.entityType}_CHANGE_REQUESTED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: level.levelCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: changeReason.trim(),
        beforeData: { tiersJson: level.tiersJson },
        afterData: { tiersJson: proposedTiersJson },
        metadata: {
          levelId: level.id,
          levelCode: level.levelCode,
          approvalNo: approvalCase.approvalNo,
        },
        subjects: [
          { subjectType: this.entityType, subjectNo: level.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `${this.entityType}_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      requestNo,
      levelCode: level.levelCode,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  protected async onDecidedCore(event: any) {
    const decision = event?.decision;
    const approvalId = event?.approvalId;
    const entityRef = event?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn(`${this.domainLabel} fee level change decided event missing approvalId or entityRef`);
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeChange(approvalId, entityRef, event);
    } else {
      await this.cancelChange(approvalId, entityRef, decision, event);
    }
  }

  private async executeChange(approvalId: string, requestNo: string, event: any) {
    let request: any = null;
    try {
      // 1. Load request, verify PENDING_APPROVAL
      request = await this.changeRequestModel.findUnique({
        where: { requestNo },
      });
      if (!request || request.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Change request ${requestNo} not found or not PENDING_APPROVAL`);
        return;
      }

      // 2. Apply change via L1 (hash conflict check runs inside transaction)
      try {
        await this.feeLevelService.executeChange(request.requestNo);
      } catch (err) {
        if (err instanceof ConflictException || err instanceof NotFoundException) {
          const reason = err.message;
          await this.auditLogsService.recordSystem({
            action: `${this.entityType}_CHANGE_APPLY_FAILED`,
            actionDomain: 'CONFIG',
            primarySubjectType: this.entityType,
            primarySubjectNo: request.levelCode,
            correlationId: event?.traceId,
            causationId: approvalId,
            outcome: AuditOutcome.FAILED,
            reasonCode: 'CONFLICT',
            reason,
            metadata: { levelId: request.levelId, levelCode: request.levelCode },
            subjects: [
              { subjectType: this.entityType, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
              { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
            ],
            requestId: `${this.entityType}_CHANGE_APPLY_FAILED_${request.requestNo}`,
            sourcePlatform: 'SYSTEM',
          });
          this.logger.warn(`Change request ${request.requestNo} failed: ${reason}`);
          return;
        }
        throw err;
      }

      // 5. Audit CHANGE_APPLIED
      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_CHANGE_APPLIED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: request.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        beforeData: { tiersJson: request.currentTiersJson },
        afterData: { tiersJson: request.proposedTiersJson },
        approvalNo: event?.approvalNo,
        metadata: { levelId: request.levelId, levelCode: request.levelCode },
        subjects: [
          { subjectType: this.entityType, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `${this.entityType}_CHANGE_APPLIED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} executed: ${request.levelCode} tiers updated`);
    } catch (err: any) {
      this.logger.error(`Failed to execute change request ${requestNo}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_CHANGE_APPLY_FAILED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: request?.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err.message,
        subjects: [
          ...(request?.levelCode ? [{ subjectType: this.entityType, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY }] : []),
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `${this.entityType}_CHANGE_APPLY_FAILED_${requestNo}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async cancelChange(
    approvalId: string,
    requestNo: string,
    decision: string,
    event: any,
  ) {
    try {
      const request = await this.changeRequestModel.findUnique({
        where: { requestNo },
      });
      if (!request) {
        this.logger.warn(`Change request ${requestNo} not found for cancellation`);
        return;
      }

      // Update request status
      if (decision === 'DECLINED') {
        await this.feeLevelService.rejectChangeRequest(request.requestNo);
      } else if (decision === 'EXPIRED') {
        await this.feeLevelService.expireChangeRequest(request.requestNo);
      } else {
        await this.feeLevelService.cancelChangeRequest(request.requestNo);
      }

      // Audit
      await this.auditLogsService.recordSystem({
        action: `${this.entityType}_CHANGE_CANCELLED`,
        actionDomain: 'CONFIG',
        primarySubjectType: this.entityType,
        primarySubjectNo: request.levelCode,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event?.decisionReason || `${this.domainLabel} fee level change request ${String(decision).toLowerCase()}`,
        metadata: {
          decision,
          levelId: request.levelId,
          levelCode: request.levelCode,
          approvalNo: event?.approvalNo,
        },
        subjects: [
          { subjectType: this.entityType, subjectNo: request.levelCode, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'FEE_LEVEL_CHANGE_REQUEST', subjectNo: request.requestNo, subjectRole: AuditSubjectRole.INSTRUMENT },
        ],
        requestId: `${this.entityType}_CHANGE_CANCELLED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} cancelled (${decision})`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel change request ${requestNo}: ${err.message}`);
    }
  }
}
