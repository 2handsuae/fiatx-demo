import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import {
  ALL_AMOUNT_FIELDS,
  GATE_SHAPES,
  GateType,
} from './constants/transaction-limit.constants';

// 二级"已裁决"事件名由 approval 引擎按 workflowType 推导(approval-handler.base.ts:
// `workflow.${workflowType.toLowerCase().replace(/_/g,'-')}.decided`),此处逐字对齐。
// 发射方是本模块 providers 里的 TransactionLimitChangeApprovalService——创建流(连同它的
// TransactionLimitCreationApprovalService 发射器)已随「限额只改不建不删」整条退役(波一 T10)。
const CHANGE_DECIDED_EVENT = 'workflow.transaction-limit-change.decided';

interface ChangeRuleInput {
  minAmount?: number | null;
  maxAmount?: number | null;
  defaultLimit?: number | null;
  threshold?: number | null;
  reason: string;
}

@Injectable()
export class TransactionLimitRuleWorkflowService {
  private readonly logger = new Logger(TransactionLimitRuleWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesService: TransactionLimitRulesService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  // ─────────────────────────── 变更流 ───────────────────────────

  async initiateChange(ruleNo: string, dto: ChangeRuleInput, actor: ApprovalActorContext) {
    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');

    const rule = await this.rulesService.findByNo(ruleNo);

    // 早拒(FIX-1b):approvalCaseNo 非空即"变更中" → 不许再提第二单(否则两单先后落地,后者绝对值快照会覆盖前者)
    if (rule.approvalCaseNo) {
      throw new ConflictException(
        `Rule ${ruleNo} already has a pending change approval (${rule.approvalCaseNo}); resolve it before submitting another.`,
      );
    }

    const shape = GATE_SHAPES[rule.gateType as GateType];

    // 只许改本形状的金额字段:任何别形状字段被填 → 拒绝
    for (const f of ALL_AMOUNT_FIELDS) {
      const v = (dto as any)[f];
      if (v != null && !shape.amountFields.includes(f)) {
        throw new BadRequestException(`${rule.gateType} rule must not set ${f}`);
      }
    }

    // 合并行:本形状金额字段用 dto 覆盖,未提供则沿用当前值(两侧一律字符串化,精度自洽)
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const f of shape.amountFields) {
      const current = (rule as any)[f] as Prisma.Decimal | null;
      const provided = (dto as any)[f] as number | null | undefined;
      before[f] = current != null ? current.toString() : null;
      after[f] = provided != null ? String(provided) : current != null ? current.toString() : null;
    }

    // 用合并后的完整行跑形状校验(金额>0、min<max 等)
    this.rulesService.validateShape({
      gateType: rule.gateType as GateType,
      operationType: rule.operationType,
      assetId: rule.assetId,
      tradingTier: rule.tradingTier,
      period: rule.period,
      ...after,
    });

    const changed = shape.amountFields.some((f) => {
      const cur = (rule as any)[f] as Prisma.Decimal | null;
      const nxt = after[f];
      if (cur == null && nxt == null) return false;
      if (cur == null || nxt == null) return true;
      return !new Prisma.Decimal(nxt).equals(cur);
    });
    if (!changed) {
      throw new BadRequestException('No amount field changed');
    }

    // START：本次变更旅程的 correlationId，同一个值同事务写进 ApprovalCase.traceId
    // （经 createAndSubmit 的 traceId 入参），供下游 onChangeDecided 经
    // ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
        entityRef: rule.ruleNo,
        traceId: correlationId,
        objectSnapshot: {
          ruleNo: rule.ruleNo,
          gateType: rule.gateType,
          operationType: rule.operationType,
          before,
          after,
          reason: dto.reason,
        },
      },
      { reason: dto.reason, traceId: correlationId },
      actor,
    );

    await this.rulesService.attachApprovalCase(rule.ruleNo, approvalCase.approvalNo);

    await this.auditLogsService.recordByActor(
      {
        action: 'TRANSACTION_LIMIT_CHANGE_REQUESTED',
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        primarySubjectNo: rule.ruleNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: dto.reason,
        beforeData: before,
        afterData: after,
        metadata: {
          gateType: rule.gateType,
          operationType: rule.operationType,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_REQUESTED_${rule.ruleNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      ruleNo: rule.ruleNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(CHANGE_DECIDED_EVENT, { async: true })
  async onChangeDecided(event: ApprovalDecidedEvent) {
    const decision = event?.decision;
    const entityRef = event?.entityRef;
    const approvalId = event?.approvalId;
    if (!entityRef || !approvalId) {
      this.logger.warn('Transaction limit rule change decided event missing entityRef/approvalId');
      return;
    }

    // entityRef 可能属于旧 governance change-request 流(非本表 ruleNo)→ null,安全退出
    const rule = await this.prisma.transactionLimitRule.findUnique({ where: { ruleNo: entityRef } });
    if (!rule) return;

    if (decision === 'APPROVED') {
      try {
        const approval: any = await this.approvalsService.getById(event?.approvalNo);
        const before = approval?.objectSnapshot?.before;
        const after = approval?.objectSnapshot?.after;
        if (!after || typeof after !== 'object' || !before || typeof before !== 'object') {
          throw new Error('approval snapshot missing before/after amounts');
        }

        // 落地前冲突闸(FIX-1a):审批期间若另一变更已落地,快照 before 与当前值漂移 →
        // 拒绝用旧绝对值快照覆盖(否则静默回退他人已批变更),转为可见的 FAILURE 审计。
        if (!this.beforeMatchesCurrent(before as Record<string, unknown>, rule)) {
          await this.auditLogsService.recordSystem({
            action: 'TRANSACTION_LIMIT_CHANGE_APPLY_FAILED',
            actionDomain: 'CONFIG',
            primarySubjectType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
            primarySubjectNo: rule.ruleNo,
            correlationId: event?.traceId,
            causationId: approvalId,
            outcome: AuditOutcome.FAILED,
            reasonCode: 'CONFLICT',
            reason: 'Concurrent change detected: rule amounts drifted from approval snapshot; apply skipped',
            metadata: {
              before,
              current: this.currentAmounts(rule),
              after,
              approvalNo: event?.approvalNo,
            },
            requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${rule.ruleNo}`,
            sourcePlatform: 'SYSTEM',
          });
          this.logger.warn(
            `Rule ${rule.ruleNo} change skipped: snapshot 'before' drifted from current amounts (concurrent change)`,
          );
          // 单子已裁决(即便应用被冲突守卫挡下)→ 清挂号,不留死锁在"变更中"。
          await this.rulesService.clearApprovalCase(rule.ruleNo);
          return;
        }

        await this.rulesService.applyAmountChange(rule.ruleNo, after);
        await this.auditLogsService.recordSystem({
          action: 'TRANSACTION_LIMIT_CHANGE_APPLIED',
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          primarySubjectNo: rule.ruleNo,
          correlationId: event?.traceId,
          causationId: approvalId,
          outcome: AuditOutcome.SUCCESS,
          beforeData: before,
          afterData: after,
          approvalNo: event?.approvalNo,
          requestId: `TRANSACTION_LIMIT_CHANGE_APPLIED_${rule.ruleNo}`,
          sourcePlatform: 'SYSTEM',
        });
        this.logger.log(`Rule ${rule.ruleNo} change applied`);
      } catch (err: any) {
        this.logger.error(`Failed to apply change to rule ${rule.ruleNo}: ${err.message}`);
        await this.auditLogsService.recordSystem({
          action: 'TRANSACTION_LIMIT_CHANGE_APPLY_FAILED',
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          primarySubjectNo: rule.ruleNo,
          correlationId: event?.traceId,
          causationId: approvalId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'EXECUTION_FAILED',
          reason: err.message,
          metadata: { approvalNo: event?.approvalNo },
          requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${rule.ruleNo}`,
          sourcePlatform: 'SYSTEM',
        });
      }
      // 单子已裁决(无论应用成功还是执行失败)→ 清挂号。
      await this.rulesService.clearApprovalCase(rule.ruleNo);
      return;
    }

    // 否决/取消/超时 → 无副作用(规则保持原值),仅留痕
    await this.auditLogsService.recordSystem({
      action: 'TRANSACTION_LIMIT_CHANGE_CANCELLED',
      actionDomain: 'CONFIG',
      primarySubjectType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
      primarySubjectNo: rule.ruleNo,
      correlationId: event?.traceId,
      causationId: approvalId,
      outcome: AuditOutcome.SUCCESS,
      reason: event?.decisionReason || `Transaction limit rule change request ${String(decision).toLowerCase()}`,
      metadata: { decision, approvalNo: event?.approvalNo },
      requestId: `TRANSACTION_LIMIT_CHANGE_CANCELLED_${rule.ruleNo}`,
      sourcePlatform: 'SYSTEM',
    });
    await this.rulesService.clearApprovalCase(rule.ruleNo);
    this.logger.log(`Rule ${rule.ruleNo} change cancelled (${decision})`);
  }

  /** 规则当前金额(本形状字段,字符串化)——落地冲突失败审计用 */
  private currentAmounts(rule: any): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const f of GATE_SHAPES[rule.gateType as GateType].amountFields) {
      const v = rule[f] as Prisma.Decimal | null;
      out[f] = v != null ? v.toString() : null;
    }
    return out;
  }

  /** 审批快照 before 是否仍等于规则当前金额(逐本形状字段按 Decimal 精确比对) */
  private beforeMatchesCurrent(before: Record<string, unknown>, rule: any): boolean {
    return GATE_SHAPES[rule.gateType as GateType].amountFields.every((f) => {
      const snap = before?.[f];
      const cur = rule[f] as Prisma.Decimal | null;
      const snapNull = snap == null;
      const curNull = cur == null;
      if (snapNull && curNull) return true;
      if (snapNull || curNull) return false;
      return new Prisma.Decimal(snap as string | number).equals(cur);
    });
  }
}
