import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { OnboardingService } from '../identity/onboarding/onboarding.service';
import { AuditLogsService } from './audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from './audit-logs/constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditTriggerType,
} from './audit-logs/dto/audit-log.dto';
import {
  getCanonicalReviewRuleForStage,
  getWorkflowFromSourceType,
  getCanonicalOnboardingRuleForStage,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_WORKFLOW,
  TRANSACTION_REVIEW_STAGES,
  TRANSACTION_WORKFLOW,
  ComplianceReviewStage,
} from './constants/onboarding-compliance-workflow.constant';
import { normalizeRiskRecommendedActionType } from './constants/risk-recommended-actions.constant';
import { SimulateRiskDecisionRecordDto } from './dto/risk-decision-record.dto';
import { TransactionRiskBridgeService } from './transaction-compliance/transaction-risk-bridge.service';

type DecisionRecordListQuery = {
  status?: string;
  contextType?: string;
  outputDecision?: string;
  ownerId?: string;
  subjectId?: string;
  policyVersion?: string;
  skip?: number;
  take?: number;
};

@Injectable()
export class RiskDecisionRecordsService {
  private readonly auditLogsService: AuditLogsService;
  private onboardingService?: OnboardingService | null;
  private transactionRiskBridgeService?: TransactionRiskBridgeService | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef?: ModuleRef,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private getOnboardingService(): OnboardingService {
    if (this.onboardingService) {
      return this.onboardingService;
    }
    const resolved = this.moduleRef?.get(OnboardingService, { strict: false }) || null;
    if (!resolved) {
      throw new NotFoundException('OnboardingService is unavailable');
    }
    this.onboardingService = resolved;
    return resolved;
  }

  private getTransactionRiskBridgeService(): TransactionRiskBridgeService {
    if (this.transactionRiskBridgeService) {
      return this.transactionRiskBridgeService;
    }
    const resolved =
      this.moduleRef?.get(TransactionRiskBridgeService, { strict: false }) || null;
    if (!resolved) {
      throw new NotFoundException('TransactionRiskBridgeService is unavailable');
    }
    this.transactionRiskBridgeService = resolved;
    return resolved;
  }

  private pickRandomReasonCode(options: string[]): string {
    if (!Array.isArray(options) || options.length === 0) {
      throw new BadRequestException('Risk reason pool is empty');
    }
    const index = Math.floor(Math.random() * options.length);
    return options[index] || options[0];
  }

  private getManualReasonCode(input: {
    contextType?: string | null;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  }): string {
    const contextType = String(input.contextType || '').trim().toUpperCase();

    if (input.riskLevel === 'LOW') {
      if (contextType === 'ONBOARDING_CDD') return 'CDD_LOW_RISK_CLEAR';
      if (contextType === 'TX_DEPOSIT_FINAL') return 'TX_DEPOSIT_LOW_RISK_AUTO_CLEAR';
      if (contextType === 'TX_WITHDRAW_FINAL') {
        return 'TX_WITHDRAW_FINAL_LOW_RISK_CLEAR';
      }
      if (contextType === 'TX_SWAP_FINAL') return 'TX_SWAP_LOW_RISK_AUTO_CLEAR';
      throw new BadRequestException(`Unsupported decision record contextType: ${contextType}`);
    }

    const reasonPools: Record<string, Record<'MEDIUM' | 'HIGH', string[]>> = {
      ONBOARDING_CDD: {
        MEDIUM: [
          'CDD_PROFILE_INCONSISTENT',
          'CDD_ADVERSE_MEDIA_REVIEW',
          'CDD_SOURCE_OF_FUNDS_REVIEW',
        ],
        HIGH: [
          'CDD_PEP_MATCH',
          'CDD_SANCTIONS_HIT',
          'CDD_HIGH_RISK_JURISDICTION',
        ],
      },
      TX_DEPOSIT_FINAL: {
        MEDIUM: [
          'KYT_ISSUE',
          'TRAVEL_RULE_ISSUE',
          'LARGE_DEPOSIT_PROFILE_MISMATCH',
        ],
        HIGH: [
          'SANCTIONS_HIT',
          'KYT_SEVERE_EXPOSURE',
          'TRAVEL_RULE_COUNTERPARTY_BLOCKED',
        ],
      },
      TX_WITHDRAW_FINAL: {
        MEDIUM: [
          'TRAVEL_RULE_ISSUE',
          'PROFILE_MISMATCH',
          'BEHAVIOR_REVIEW_REQUIRED',
        ],
        HIGH: [
          'TX_WITHDRAW_MAIN_KYT_FAIL',
          'TX_WITHDRAW_TRAVEL_RULE_REJECTED',
          'HIGH_RISK_EXPOSURE',
        ],
      },
      TX_SWAP_FINAL: {
        MEDIUM: [
          'PROFILE_MISMATCH',
          'VELOCITY_SPIKE',
          'BEHAVIOR_REVIEW_REQUIRED',
        ],
        HIGH: [
          'SANCTIONS_HIT',
          'LAYERING_PATTERN',
          'HIGH_RISK_EXPOSURE',
        ],
      },
    };

    const contextPools = reasonPools[contextType];
    if (!contextPools) {
      throw new BadRequestException(`Unsupported decision record contextType: ${contextType}`);
    }

    return this.pickRandomReasonCode(contextPools[input.riskLevel]);
  }

  private normalizeTake(take?: number): number {
    if (!take || Number.isNaN(take)) return 20;
    return Math.min(Math.max(Number(take), 1), 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || Number.isNaN(skip)) return 0;
    return Math.max(Number(skip), 0);
  }

  private parseJsonSafely(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseJsonArraySafely<T = unknown>(value?: string | null): T[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private getSubjectType(inputPayload?: string | null): string {
    const parsed = this.parseJsonSafely(inputPayload);
    const subjectType = String(parsed.subjectType || '').trim();
    return subjectType || 'UNKNOWN';
  }

  private normalizeRecommendedActions(actions: unknown[]): Record<string, unknown>[] {
    return actions
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const action = { ...(item as Record<string, unknown>) };
        const normalizedType = normalizeRiskRecommendedActionType(action.type);
        if (normalizedType) {
          action.type = normalizedType;
        }
        return action;
      });
  }

  private async resolveSwapWorkflowAuditContext(swapId: string) {
    const swap = await (this.prisma as any).swapTransaction?.findUnique?.({
      where: { id: swapId },
      select: {
        id: true,
        swapNo: true,
      },
    });

    return {
      traceId: swap?.id ? `${AuditWorkflowTypes.SWAP}:${swap.id}` : undefined,
      workflowType: AuditWorkflowTypes.SWAP,
      workflowId: swap?.id || swapId,
      workflowNo: swap?.swapNo || undefined,
    };
  }

  private getStageFromContextType(contextType?: string | null): ComplianceReviewStage | null {
    const normalized = String(contextType || '').trim().toUpperCase();
    if (normalized === 'ONBOARDING_CDD') return ONBOARDING_REVIEW_STAGES.REVIEW_CDD;
    if (normalized === 'ONBOARDING_EDD') return ONBOARDING_REVIEW_STAGES.REVIEW_EDD;
    if (normalized === 'PERIODIC_REVIEW_CDD') return ONBOARDING_REVIEW_STAGES.REVIEW_CDD;
    if (normalized === 'PERIODIC_REVIEW_EDD') return ONBOARDING_REVIEW_STAGES.REVIEW_EDD;
    if (normalized === 'TX_DEPOSIT_KYT_MAIN') return TRANSACTION_REVIEW_STAGES.REVIEW_KYT;
    if (normalized === 'TX_DEPOSIT_TRAVEL_RULE') {
      return TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE;
    }
    if (normalized === 'TX_DEPOSIT_FINAL') {
      return TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL;
    }
    if (normalized === 'TX_WITHDRAW_PRECHECK') {
      return TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_PRECHECK;
    }
    if (normalized === 'TX_WITHDRAW_FINAL') {
      return TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL;
    }
    if (normalized === 'TX_SWAP_FINAL') {
      return TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL;
    }
    return null;
  }

  private getWorkflowFromContextType(contextType?: string | null) {
    const normalized = String(contextType || '').trim().toUpperCase();
    if (normalized === 'PERIODIC_REVIEW_CDD' || normalized === 'PERIODIC_REVIEW_EDD') {
      return PERIODIC_REVIEW_WORKFLOW;
    }
    if (normalized === 'ONBOARDING_CDD' || normalized === 'ONBOARDING_EDD') {
      return ONBOARDING_WORKFLOW;
    }
    if (
      normalized === 'TX_DEPOSIT_KYT_MAIN' ||
      normalized === 'TX_DEPOSIT_TRAVEL_RULE' ||
      normalized === 'TX_DEPOSIT_FINAL' ||
      normalized === 'TX_WITHDRAW_PRECHECK' ||
      normalized === 'TX_WITHDRAW_FINAL' ||
      normalized === 'TX_SWAP_FINAL'
    ) {
      return TRANSACTION_WORKFLOW;
    }
    return null;
  }

  private getWorkflowSnapshot(input: {
    contextType?: string | null;
    outputs?: Record<string, unknown>;
  }) {
    const orchestration =
      input.outputs &&
      input.outputs.orchestration &&
      typeof input.outputs.orchestration === 'object' &&
      !Array.isArray(input.outputs.orchestration)
        ? (input.outputs.orchestration as Record<string, unknown>)
        : {};

    const stage =
      String(orchestration.stage || '').trim() ||
      this.getStageFromContextType(input.contextType) ||
      null;
    const normalizedStage = stage ? String(stage).trim().toUpperCase() : null;
    const workflow =
      String(orchestration.workflow || '').trim() ||
      this.getWorkflowFromContextType(input.contextType) ||
      getWorkflowFromSourceType(orchestration.sourceType) ||
      (normalizedStage ? ONBOARDING_WORKFLOW : '');
    const rule =
      String(orchestration.rule || '').trim() ||
      getCanonicalReviewRuleForStage(normalizedStage || null, workflow || null) ||
      getCanonicalOnboardingRuleForStage(normalizedStage || null) ||
      null;
    const workflowTransition =
      input.outputs &&
      input.outputs.workflowTransition &&
      typeof input.outputs.workflowTransition === 'object' &&
      !Array.isArray(input.outputs.workflowTransition)
        ? (input.outputs.workflowTransition as Record<string, unknown>)
        : {};

    return {
      workflow: workflow || null,
      stage: normalizedStage || null,
      rule: rule || null,
      orchestration,
      workflowTransition,
    };
  }

  private mapListItem(row: any) {
    const outputs = this.parseJsonSafely(row.outputs);
    const workflowSnapshot = this.getWorkflowSnapshot({
      contextType: row.contextType,
      outputs,
    });
    return {
      id: row.id,
      customerId: row.customerId,
      contextType: row.contextType,
      subjectType: this.getSubjectType(row.inputPayload),
      subjectId: row.subjectId,
      ownerType: 'CUSTOMER',
      ownerId: row.customerId,
      policyVersion: row.policyVersion,
      status: row.status,
      inputHash: row.inputHash,
      outputDecision: row.outputDecision,
      recommendedActions: this.normalizeRecommendedActions(
        this.parseJsonArraySafely(row.recommendedActions),
      ),
      reasonCodes: this.parseJsonArraySafely<string>(row.reasonCodes),
      outputs,
      workflow: workflowSnapshot.workflow,
      stage: workflowSnapshot.stage,
      rule: workflowSnapshot.rule,
      orchestration: workflowSnapshot.orchestration,
      workflowTransition: workflowSnapshot.workflowTransition,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
      customer: row.customer,
    };
  }

  async listDecisionRecords(query: DecisionRecordListQuery) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const where: Prisma.WorkflowDecisionRecordWhereInput = {};
    const status = String(query.status || '').trim();
    const contextType = String(query.contextType || '').trim();
    const outputDecision = String(query.outputDecision || '').trim();
    const ownerId = String(query.ownerId || '').trim();
    const subjectId = String(query.subjectId || '').trim();
    const policyVersion = String(query.policyVersion || '').trim();

    if (status) where.status = status;
    if (contextType) where.contextType = contextType;
    if (outputDecision) where.outputDecision = outputDecision;
    if (ownerId) where.customerId = ownerId;
    if (subjectId) where.subjectId = subjectId;
    if (policyVersion) {
      where.policyVersion = { contains: policyVersion };
    }

    const decisionRecordRepo = (this.prisma as any).workflowDecisionRecord;
    const [total, rows] = await Promise.all([
      decisionRecordRepo.count({ where }),
      decisionRecordRepo.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          customerId: true,
          contextType: true,
          subjectId: true,
          policyVersion: true,
          status: true,
          inputHash: true,
          inputPayload: true,
          outputDecision: true,
          recommendedActions: true,
          outputs: true,
          reasonCodes: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              customerNo: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row: any) => this.mapListItem(row)),
    };
  }

  async getDecisionRecordDetail(id: string) {
    const decisionRecordRepo = (this.prisma as any).workflowDecisionRecord;
    const row = await decisionRecordRepo.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            customerType: true,
            companyName: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`Decision record not found: ${id}`);
    }

    const inputPayload = this.parseJsonSafely(row.inputPayload);
    const outputs = this.parseJsonSafely(row.outputs);
    const workflowSnapshot = this.getWorkflowSnapshot({
      contextType: row.contextType,
      outputs,
    });
    return {
      ...this.mapListItem({
        ...row,
        inputPayload: row.inputPayload,
      }),
      inputPayload,
      outputs,
      recommendedActions: this.normalizeRecommendedActions(
        this.parseJsonArraySafely(row.recommendedActions),
      ),
      reasonCodes: this.parseJsonArraySafely<string>(row.reasonCodes),
      workflow: workflowSnapshot.workflow,
      stage: workflowSnapshot.stage,
      rule: workflowSnapshot.rule,
      orchestration: workflowSnapshot.orchestration,
      workflowTransition: workflowSnapshot.workflowTransition,
      customer: row.customer,
    };
  }

  async simulateDecisionRecord(
    id: string,
    body: SimulateRiskDecisionRecordDto,
    actor: AuditActorContext & { sourcePlatform?: string },
  ) {
    const decisionRecordRepo = (this.prisma as any).workflowDecisionRecord;
    const record = await decisionRecordRepo.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        contextType: true,
        customerId: true,
        subjectId: true,
      },
    });

    if (!record) {
      throw new NotFoundException(`Decision record not found: ${id}`);
    }

    const contextType = String(record.contextType || '').trim().toUpperCase();
    const status = String(record.status || '').trim().toUpperCase();
    if (status !== 'CREATED') {
      throw new BadRequestException(`Decision record ${id} is not pending simulation`);
    }
    if (contextType === 'TX_WITHDRAW_PRECHECK') {
      throw new BadRequestException(
        `Decision record ${id} is historical read-only and no longer supports manual simulation`,
      );
    }

    const generatedReasonCode = this.getManualReasonCode({
      contextType,
      riskLevel: body.riskLevel,
    });

    if (contextType === 'ONBOARDING_CDD') {
      await this.getOnboardingService().completeManualCddDecision({
        decisionRecordId: id,
        riskLevel: body.riskLevel,
        reasonCode: generatedReasonCode,
      });
    } else if (contextType === 'TX_DEPOSIT_FINAL') {
      await this.getTransactionRiskBridgeService().simulateDepositFinalReview({
        decisionRecordId: id,
        riskLevel: body.riskLevel,
        riskReason: generatedReasonCode,
      });
    } else if (contextType === 'TX_WITHDRAW_FINAL') {
      await this.getTransactionRiskBridgeService().simulateWithdrawFinalReview({
        decisionRecordId: id,
        riskLevel: body.riskLevel,
        riskReason: generatedReasonCode,
      });
    } else if (contextType === 'TX_SWAP_FINAL') {
      await this.getTransactionRiskBridgeService().simulateSwapFinalReview({
        decisionRecordId: id,
        riskLevel: body.riskLevel,
        riskReason: generatedReasonCode,
      });
    } else {
      throw new BadRequestException(
        `Decision record ${id} does not support manual simulation`,
      );
    }

    const auditWorkflowContext =
      contextType === 'TX_SWAP_FINAL' && record.subjectId
        ? await this.resolveSwapWorkflowAuditContext(record.subjectId)
        : {
            traceId:
              record.subjectId &&
              contextType === 'TX_WITHDRAW_FINAL'
                ? `${AuditWorkflowTypes.WITHDRAW}:${record.subjectId}`
                : undefined,
            workflowType:
              contextType === 'ONBOARDING_CDD'
                ? AuditWorkflowTypes.ONBOARDING
                : contextType === 'TX_WITHDRAW_FINAL'
                  ? AuditWorkflowTypes.WITHDRAW
                : AuditWorkflowTypes.TRANSACTION,
            workflowId: record.subjectId || undefined,
            workflowNo: undefined,
          };

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.MANUAL_OVERRIDE,
        action: AuditActions.RISK_DECISION_MANUAL_SIMULATED,
        module: AuditModules.RISK_DECISION_RECORDS,
        entityType: AuditEntityTypes.RISK_DECISION_RECORD,
        entityId: id,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: record.customerId || undefined,
        traceId: auditWorkflowContext.traceId,
        workflowType: auditWorkflowContext.workflowType,
        workflowId: auditWorkflowContext.workflowId,
        workflowNo: auditWorkflowContext.workflowNo,
        reason: `Manual ${body.riskLevel} simulation applied to ${contextType}`,
        metadata: {
          decisionRecordId: id,
          contextType,
          subjectId: record.subjectId,
          selectedRiskLevel: body.riskLevel,
          generatedReasonCode,
          simulationMode: 'MANUAL',
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      },
      actor,
    );

    return this.getDecisionRecordDetail(id);
  }
}
