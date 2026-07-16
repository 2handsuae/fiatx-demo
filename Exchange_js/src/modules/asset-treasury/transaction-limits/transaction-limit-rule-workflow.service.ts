import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import {
  RuleShapeInput,
  TransactionLimitRulesService,
} from './transaction-limit-rules.service';
import {
  ALL_AMOUNT_FIELDS,
  GATE_SHAPES,
  GateType,
} from './constants/transaction-limit.constants';

// 二级"已裁决"事件名由 approval 引擎按 workflowType 推导(approval-handler.base.ts:
// `workflow.${workflowType.toLowerCase().replace(/_/g,'-')}.decided`),此处逐字对齐。
// 发射方仍是旧 governance 模块里的 TransactionLimit{Creation,Change}ApprovalService(共用同一 actionType),
// Task 8 退役旧模块时须把两个发射器搬进本模块 providers,否则本工作流将收不到裁决事件。
const CREATION_DECIDED_EVENT = 'workflow.transaction-limit-creation.decided';
const CHANGE_DECIDED_EVENT = 'workflow.transaction-limit-change.decided';

interface CreateRuleInput {
  gateType: string;
  operationType: string;
  assetId?: string | null;
  tradingTier?: string | null;
  period?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  defaultLimit?: number | null;
  cap?: number | null;
  threshold?: number | null;
  reason: string;
}

interface ChangeRuleInput {
  minAmount?: number | null;
  maxAmount?: number | null;
  defaultLimit?: number | null;
  cap?: number | null;
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
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  // ─────────────────────────── 创建流 ───────────────────────────

  async initiateCreate(dto: CreateRuleInput, actor: ApprovalActorContext) {
    const input: RuleShapeInput = {
      gateType: dto.gateType as GateType,
      operationType: dto.operationType,
      assetId: dto.assetId ?? null,
      tradingTier: dto.tradingTier ?? null,
      period: dto.period ?? null,
      minAmount: dto.minAmount ?? null,
      maxAmount: dto.maxAmount ?? null,
      defaultLimit: dto.defaultLimit ?? null,
      cap: dto.cap ?? null,
      threshold: dto.threshold ?? null,
    };

    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');
    this.rulesService.validateShape(input);
    await this.rulesService.assertUnique(input);

    const ruleNo = `TLR-${Date.now()}`;
    const rule = await this.rulesService.createPending({ ...input, ruleNo });

    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CREATION,
          entityRef: rule.id,
          traceId,
          objectSnapshot: {
            ruleNo,
            gateType: input.gateType,
            operationType: input.operationType,
            assetId: input.assetId,
            tradingTier: input.tradingTier,
            period: input.period,
            ...this.amountSnapshot(input.gateType as GateType, input),
            reason: dto.reason,
          },
        },
        { reason: dto.reason, traceId },
        actor,
      );
    } catch (err) {
      // 补偿:审批建单失败则回删占坑行
      await this.rulesService.deletePending(ruleNo);
      throw err;
    }

    await this.rulesService.attachApprovalCase(ruleNo, approvalCase.id);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: rule.id,
        entityNo: ruleNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          gateType: input.gateType,
          operationType: input.operationType,
          assetId: input.assetId,
          tradingTier: input.tradingTier,
          period: input.period,
          ...this.amountSnapshot(input.gateType as GateType, input),
          reason: dto.reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CREATION_REQUESTED_${ruleNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      ruleNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(CREATION_DECIDED_EVENT, { async: true })
  async onCreationDecided(event: ApprovalDecidedEvent) {
    const decision = event?.decision;
    const entityRef = event?.entityRef;
    const approvalId = event?.approvalId;
    if (!entityRef || !approvalId) {
      this.logger.warn('Transaction limit rule creation decided event missing entityRef/approvalId');
      return;
    }

    // entityRef 可能属于旧 governance policy 流(非本表 id)→ findUnique 返回 null,安全退出
    const rule = await this.prisma.transactionLimitRule.findUnique({ where: { id: entityRef } });
    if (!rule) return;

    if (decision === 'APPROVED') {
      if (rule.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Rule ${rule.ruleNo} not PENDING_APPROVAL (${rule.status}); skip activation`);
        return;
      }
      try {
        await this.rulesService.activate(rule.ruleNo);
        await this.auditLogsService.recordSystem({
          action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_APPLIED,
          entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          entityId: rule.id,
          entityNo: rule.ruleNo,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
          traceId: event?.traceId,
          result: AuditResult.SUCCESS,
          metadata: { gateType: rule.gateType, operationType: rule.operationType },
          requestId: `TRANSACTION_LIMIT_CREATION_APPLIED_${rule.ruleNo}`,
          sourcePlatform: 'SYSTEM',
        });
        this.logger.log(`Rule ${rule.ruleNo} activated`);
      } catch (err: any) {
        this.logger.error(`Failed to activate rule ${rule.ruleNo}: ${err.message}`);
        await this.auditLogsService.recordSystem({
          action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_APPLY_FAILED,
          entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          entityId: rule.id,
          entityNo: rule.ruleNo,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
          traceId: event?.traceId,
          result: AuditResult.FAILED,
          reason: err.message,
          metadata: { error: err.message },
          requestId: `TRANSACTION_LIMIT_CREATION_APPLY_FAILED_${rule.ruleNo}`,
          sourcePlatform: 'SYSTEM',
        });
      }
      return;
    }

    // 否决/取消/超时 → 物理删除占坑行
    if (rule.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`Rule ${rule.ruleNo} not PENDING_APPROVAL (${rule.status}); skip deletion`);
      return;
    }
    try {
      await this.rulesService.deletePending(rule.ruleNo);
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_CANCELLED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: rule.id,
        entityNo: rule.ruleNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: { decision },
        requestId: `TRANSACTION_LIMIT_CREATION_CANCELLED_${rule.ruleNo}`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.log(`Rule ${rule.ruleNo} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel rule creation ${rule.ruleNo}: ${err.message}`);
    }
  }

  // ─────────────────────────── 变更流 ───────────────────────────

  async initiateChange(ruleNo: string, dto: ChangeRuleInput, actor: ApprovalActorContext) {
    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');

    const rule = await this.rulesService.findByNo(ruleNo);
    if (rule.status !== 'ACTIVE') {
      throw new ConflictException(
        `Rule ${ruleNo} is not ACTIVE (current status: ${rule.status}); cannot submit a change.`,
      );
    }

    // 早拒(FIX-1b):同一规则已有 OPEN 的变更审批 → 不许再提第二单(否则两单先后落地,后者绝对值快照会覆盖前者)
    const openChanges = await this.approvalsService.list({
      actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
      entityRef: rule.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openChanges.total > 0) {
      throw new ConflictException(
        `Rule ${ruleNo} already has a pending change approval; resolve it before submitting another.`,
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

    const traceId = crypto.randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
        entityRef: rule.id,
        traceId,
        objectSnapshot: {
          ruleNo: rule.ruleNo,
          gateType: rule.gateType,
          operationType: rule.operationType,
          before,
          after,
          reason: dto.reason,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: rule.id,
        entityNo: rule.ruleNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          gateType: rule.gateType,
          operationType: rule.operationType,
          before,
          after,
          reason: dto.reason,
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

    // entityRef 可能属于旧 governance change-request 流(非本表 id)→ null,安全退出
    const rule = await this.prisma.transactionLimitRule.findUnique({ where: { id: entityRef } });
    if (!rule) return;

    if (decision === 'APPROVED') {
      try {
        const approval: any = await this.approvalsService.getById(approvalId);
        const before = approval?.objectSnapshot?.before;
        const after = approval?.objectSnapshot?.after;
        if (!after || typeof after !== 'object' || !before || typeof before !== 'object') {
          throw new Error('approval snapshot missing before/after amounts');
        }

        // 落地前冲突闸(FIX-1a):审批期间若另一变更已落地,快照 before 与当前值漂移 →
        // 拒绝用旧绝对值快照覆盖(否则静默回退他人已批变更),转为可见的 FAILURE 审计。
        if (!this.beforeMatchesCurrent(before as Record<string, unknown>, rule)) {
          await this.auditLogsService.recordSystem({
            action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
            entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
            entityId: rule.id,
            entityNo: rule.ruleNo,
            workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
            traceId: event?.traceId,
            result: AuditResult.FAILED,
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
          return;
        }

        await this.rulesService.applyAmountChange(rule.ruleNo, after);
        await this.auditLogsService.recordSystem({
          action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLIED,
          entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          entityId: rule.id,
          entityNo: rule.ruleNo,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
          traceId: event?.traceId,
          result: AuditResult.SUCCESS,
          metadata: { after, approvalNo: event?.approvalNo },
          requestId: `TRANSACTION_LIMIT_CHANGE_APPLIED_${rule.ruleNo}`,
          sourcePlatform: 'SYSTEM',
        });
        this.logger.log(`Rule ${rule.ruleNo} change applied`);
      } catch (err: any) {
        this.logger.error(`Failed to apply change to rule ${rule.ruleNo}: ${err.message}`);
        await this.auditLogsService.recordSystem({
          action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
          entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          entityId: rule.id,
          entityNo: rule.ruleNo,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
          traceId: event?.traceId,
          result: AuditResult.FAILED,
          reason: err.message,
          metadata: { error: err.message, approvalNo: event?.approvalNo },
          requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${rule.ruleNo}`,
          sourcePlatform: 'SYSTEM',
        });
      }
      return;
    }

    // 否决/取消/超时 → 无副作用(规则保持原值),仅留痕
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_CANCELLED,
      entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
      entityId: rule.id,
      entityNo: rule.ruleNo,
      workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
      traceId: event?.traceId,
      result: AuditResult.SUCCESS,
      metadata: { decision, approvalNo: event?.approvalNo },
      requestId: `TRANSACTION_LIMIT_CHANGE_CANCELLED_${rule.ruleNo}`,
      sourcePlatform: 'SYSTEM',
    });
    this.logger.log(`Rule ${rule.ruleNo} change cancelled (${decision})`);
  }

  /** 取本形状金额字段的快照(字符串化,便于审计/审批只读展示) */
  private amountSnapshot(gateType: GateType, input: RuleShapeInput): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of GATE_SHAPES[gateType].amountFields) {
      const v = (input as any)[f];
      if (v != null) out[f] = String(v);
    }
    return out;
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
