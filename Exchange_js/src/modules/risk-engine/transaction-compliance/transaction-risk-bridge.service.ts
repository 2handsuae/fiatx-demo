import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';
import {
  TRANSACTION_REVIEW_RULES,
  TRANSACTION_REVIEW_STAGES,
  TRANSACTION_WORKFLOW,
} from '../constants/onboarding-compliance-workflow.constant';
import {
  normalizeRiskRecommendedActionType,
  RISK_RECOMMENDED_ACTIONS,
} from '../constants/risk-recommended-actions.constant';
import {
  EvaluateRiskInput,
  RiskDecision,
  RiskEngineService,
  RiskRecommendedAction,
} from '../risk-engine.service';
import {
  normalizeKytResponseLifecycleStatus,
  normalizeTravelRuleResponseLifecycleStatus,
  TxResponseLifecycleStatusOrEmpty,
  TxSourceType,
} from './types/tx-compliance.types';
import { TransactionDepositWorkflowService } from '../../trading/deposit-transactions/transaction-deposit-workflow.service';
import { SwapTransactionWorkflowService } from '../../trading/swap-transactions/swap-transaction-workflow.service';
import { WithdrawTransactionWorkflowService } from '../../trading/withdraw-transactions/withdraw-transaction-workflow.service';
import {
  TRANSACTION_SWAP_SOURCE_TYPE,
  TRANSACTION_WITHDRAW_SOURCE_TYPE,
} from '../constants/onboarding-compliance-workflow.constant';

type DbClient = Prisma.TransactionClient | PrismaService;

interface TxAggregateSnapshot {
  derivedComplianceStatus: string;
  preKytCase?: {
    id?: string;
    caseNo?: string;
    status?: string | null;
    provider?: string | null;
    providerCaseId?: string | null;
    riskScore?: number | null;
  } | null;
  mainKytCase?: {
    id?: string;
    caseNo?: string;
    status?: string | null;
    provider?: string | null;
    providerCaseId?: string | null;
    riskScore?: number | null;
  } | null;
  travelRuleCase?: {
    id?: string;
    caseNo?: string;
    status?: string | null;
    required?: boolean | null;
    provider?: string | null;
    providerTransferId?: string | null;
    counterpartyVasp?: string | null;
  } | null;
}

interface DepositRiskBaseInput {
  depositId: string;
  sourceType: TxSourceType;
  sourceId: string;
  aggregate: TxAggregateSnapshot;
  reportDeduped?: boolean;
}

interface DepositKytRiskInput extends DepositRiskBaseInput {
  status: string;
  screeningStage: string;
  provider?: string | null;
  providerCaseId?: string | null;
  riskScore?: number | null;
}

interface DepositTravelRuleRiskInput extends DepositRiskBaseInput {
  status: string;
  required: boolean;
  provider?: string | null;
  providerTransferId?: string | null;
  counterpartyVasp?: string | null;
}

interface DepositFinalReviewInput extends DepositRiskBaseInput {
  triggerSource: 'KYT' | 'TRAVEL_RULE';
  triggerStatus: string;
}

interface DirectDepositFinalReviewInput {
  depositId: string;
  sourceType: TxSourceType;
  sourceId: string;
  reportDeduped?: boolean;
  triggerStatus: string;
  kytStatus: string;
  travelRuleRequired: boolean;
  travelRuleStatus: string;
}

interface DepositSimulationRiskProfile {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskReason: string | null;
  signalId: string | null;
}

interface WithdrawRiskBaseInput {
  withdrawId: string;
  sourceType: TxSourceType;
  sourceId: string;
  aggregate: TxAggregateSnapshot;
  reportDeduped?: boolean;
}

interface WithdrawPrecheckReviewInput extends WithdrawRiskBaseInput {
  status: string;
  screeningStage: string;
  provider?: string | null;
  providerCaseId?: string | null;
  riskScore?: number | null;
}

interface WithdrawFinalReviewInput extends WithdrawRiskBaseInput {
  triggerSource: 'KYT' | 'TRAVEL_RULE' | 'PAYOUT_DISPATCH';
  triggerStatus: string;
}

interface WithdrawSimulationRiskProfile {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskReason: string | null;
  signalId: string | null;
}

interface SwapFinalReviewInput {
  swapId: string;
  sourceType: TxSourceType;
  sourceId: string;
  reportDeduped?: boolean;
}

interface SwapSimulationRiskProfile {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskReason: string | null;
}

interface ManualRiskSimulationInput {
  decisionRecordId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskReason: string | null;
}

interface ResolvedDecisionResult {
  decisionRecordId: string;
  decision: RiskDecision;
  recommendedActions: RiskRecommendedAction[];
  reasonCodes: string[];
  reused: boolean;
}

export interface BridgeExecutionResult {
  skipped: boolean;
  skipReason?: string;
  decisionRecordId?: string | null;
  decision?: RiskDecision | null;
  alertId?: string | null;
  alertNo?: string | null;
  caseId?: string | null;
  caseNo?: string | null;
}

@Injectable()
export class TransactionRiskBridgeService {
  private readonly logger = new Logger(TransactionRiskBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
    private readonly auditLogsService: AuditLogsService,
    private readonly moduleRef?: ModuleRef,
  ) {}

  private getDb(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
  }

  private parseJsonSafely<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  private toRecordObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private normalizeTransactionWorkflowTransitionSnapshot(input: {
    sourceType: 'DEPOSIT' | 'SWAP' | 'WITHDRAW';
    sourceId: string;
    sourceNo?: string | null;
    stage: string;
    workflowTransition?: unknown;
  }): Record<string, unknown> | null {
    const workflowTransition = this.toRecordObject(input.workflowTransition);
    if (!workflowTransition) {
      return null;
    }

    const updatedSubjectCandidate = this.toRecordObject(
      workflowTransition.updatedSubject,
    );
    const updatedCustomerCandidate = this.toRecordObject(
      workflowTransition.updatedCustomer,
    );
    const legacyBeforeStatus =
      input.sourceType === 'DEPOSIT'
        ? workflowTransition.depositStatusBefore
        : input.sourceType === 'SWAP'
          ? workflowTransition.swapStatusBefore
          : workflowTransition.withdrawStatusBefore;
    const legacyAfterStatus =
      input.sourceType === 'DEPOSIT'
        ? workflowTransition.depositStatusAfter
        : input.sourceType === 'SWAP'
          ? workflowTransition.swapStatusAfter
          : workflowTransition.withdrawStatusAfter;
    const topLevelBlocked = workflowTransition.blocked;
    const topLevelBlockedReason = workflowTransition.blockedReason;

    const subjectId =
      String(
        updatedSubjectCandidate?.id ||
          updatedCustomerCandidate?.id ||
          input.sourceId ||
          '',
      ).trim() || input.sourceId;
    const subjectNo =
      String(
        updatedSubjectCandidate?.subjectNo ||
          updatedCustomerCandidate?.subjectNo ||
          updatedCustomerCandidate?.depositNo ||
          input.sourceNo ||
          '',
      ).trim() || null;
    const blockedValue =
      updatedSubjectCandidate?.blocked ??
      updatedCustomerCandidate?.blocked ??
      topLevelBlocked;
    const blockedReasonValue =
      updatedSubjectCandidate?.blockedReason ??
      updatedCustomerCandidate?.blockedReason ??
      topLevelBlockedReason;

    return {
      workflow: String(workflowTransition.workflow || TRANSACTION_WORKFLOW).trim() || null,
      stage: String(workflowTransition.stage || input.stage || '').trim() || null,
      dispositionCode:
        String(
          workflowTransition.dispositionCode || workflowTransition.workflowAction || '',
        ).trim() || null,
      transitionCode:
        String(workflowTransition.transitionCode || '').trim() || null,
      fromStatus:
        String(workflowTransition.fromStatus || legacyBeforeStatus || '').trim() || null,
      toStatus:
        String(workflowTransition.toStatus || legacyAfterStatus || '').trim() || null,
      executed:
        typeof workflowTransition.executed === 'boolean'
          ? workflowTransition.executed
          : Boolean(workflowTransition.applied),
      updatedSubject: {
        id: subjectId,
        sourceType: input.sourceType,
        subjectNo,
        blocked: Boolean(blockedValue),
        blockedReason:
          blockedReasonValue === null || blockedReasonValue === undefined
            ? null
            : String(blockedReasonValue),
      },
    };
  }

  private async writeDecisionRecordOutcomeSnapshot(
    input: {
      decisionRecordId: string;
      sourceType: 'DEPOSIT' | 'SWAP' | 'WITHDRAW';
      sourceId: string;
      sourceNo?: string | null;
      stage: string;
      rule: string;
      decision: RiskDecision;
      recommendedActions: string[];
      reasonCodes: string[];
      alertId?: string | null;
      alertNo?: string | null;
      caseId?: string | null;
      caseNo?: string | null;
      workflowTransition?: unknown;
      reusedDecisionRecord: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx) as any;
    const current = await db.workflowDecisionRecord.findUnique({
      where: { id: input.decisionRecordId },
      select: { outputs: true },
    });

    if (!current) {
      this.logger.warn(
        `Decision record missing during transaction snapshot write: ${input.decisionRecordId}`,
      );
      return;
    }

    const outputs = this.parseJsonSafely<Record<string, unknown>>(
      current.outputs,
      {},
    );
    const workflowTransition = this.normalizeTransactionWorkflowTransitionSnapshot(
      {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceNo: input.sourceNo,
        stage: input.stage,
        workflowTransition: input.workflowTransition,
      },
    );
    const nextOutputs = {
      ...outputs,
      orchestration: {
        workflow: TRANSACTION_WORKFLOW,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceNo: input.sourceNo || null,
        stage: input.stage,
        rule: input.rule,
        decision: input.decision,
        reasonCodes: input.reasonCodes,
        executedActions: input.recommendedActions.map((type) => ({ type })),
        alertId: input.alertId || null,
        alertNo: input.alertNo || null,
        alertUpserted: !!input.alertId,
        caseId: input.caseId || null,
        caseNo: input.caseNo || null,
        caseEscalated: !!input.caseId,
        reusedDecisionRecord: input.reusedDecisionRecord,
      },
      workflowTransition: workflowTransition,
    };

    await db.workflowDecisionRecord.update({
      where: { id: input.decisionRecordId },
      data: {
        outputs: JSON.stringify(nextOutputs),
      },
    });
  }

  private getTransactionWorkflowTransitionService() {
    return (
      this.moduleRef?.get(TransactionDepositWorkflowService, {
        strict: false,
      }) || null
    );
  }

  private getSwapWorkflowTransitionService() {
    return (
      this.moduleRef?.get(SwapTransactionWorkflowService, {
        strict: false,
      }) || null
    );
  }

  private getWithdrawWorkflowTransitionService() {
    return (
      this.moduleRef?.get(WithdrawTransactionWorkflowService, {
        strict: false,
      }) || null
    );
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeActionNames(actions: RiskRecommendedAction[]): string[] {
    return Array.from(
      new Set(
        actions
          .map((item) => normalizeRiskRecommendedActionType(item.type) || item.type)
          .filter(Boolean),
      ),
    );
  }

  private normalizeKytLifecycleStatus(
    value: unknown,
    options?: { allowEmpty?: boolean },
  ): TxResponseLifecycleStatusOrEmpty {
    return normalizeKytResponseLifecycleStatus(value, options);
  }

  private normalizeTravelRuleLifecycleStatus(
    value: unknown,
    required?: boolean | null,
    options?: { allowEmpty?: boolean },
  ): TxResponseLifecycleStatusOrEmpty {
    return normalizeTravelRuleResponseLifecycleStatus(value, required, options);
  }

  private deriveWithdrawComplianceStatusFromTransactionStatus(
    status?: string | null,
  ): string {
    const current = String(status || '').trim().toUpperCase();
    if (current === 'UNDER_REVIEW') return 'HOLD';
    if (current === 'REJECTED') return 'REJECT';
    if (['PAYOUT_PENDING', 'SUCCESS', 'FAILED', 'RETURNED'].includes(current)) {
      return 'CLEAR';
    }
    return 'PENDING';
  }

  private isDepositFinalReviewReady(aggregate: TxAggregateSnapshot): boolean {
    if (!aggregate.mainKytCase || !aggregate.travelRuleCase) {
      return false;
    }

    const kytLifecycle = this.normalizeKytLifecycleStatus(
      aggregate.mainKytCase?.status,
    );
    const required = aggregate.travelRuleCase?.required ?? false;
    const travelRuleLifecycle = this.normalizeTravelRuleLifecycleStatus(
      aggregate.travelRuleCase?.status,
      required,
    );

    return kytLifecycle === 'FINAL' && travelRuleLifecycle === 'FINAL';
  }

  private isWithdrawFinalReviewReady(aggregate: TxAggregateSnapshot): boolean {
    if (!aggregate.mainKytCase || !aggregate.travelRuleCase) {
      return false;
    }

    const kytLifecycle = this.normalizeKytLifecycleStatus(
      aggregate.mainKytCase?.status,
    );
    const required = aggregate.travelRuleCase?.required ?? false;
    const travelRuleLifecycle = this.normalizeTravelRuleLifecycleStatus(
      aggregate.travelRuleCase?.status,
      required,
    );

    return kytLifecycle === 'FINAL' && travelRuleLifecycle === 'FINAL';
  }

  private async resolveDepositContext(
    depositId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const deposit = await this.getDb(tx).depositTransaction.findUnique({
      where: { id: depositId },
      select: {
        id: true,
        depositNo: true,
        status: true,
        ownerType: true,
        ownerId: true,
        assetId: true,
        kytStatus: true,
        travelRuleStatus: true,
        travelRuleRequired: true,
        payin: {
          select: {
            providerTxnId: true,
          },
        },
      },
    });

    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} not found`);
    }

    return deposit;
  }

  private async resolveSwapContext(
    swapId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const swap = await (this.getDb(tx) as any).swapTransaction.findUnique({
      where: { id: swapId },
      select: {
        id: true,
        swapNo: true,
        quoteId: true,
        quoteNo: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        status: true,
        fromAssetId: true,
        fromAssetCode: true,
        fromAmount: true,
        toAssetId: true,
        toAssetCode: true,
        toAmount: true,
        netToAmount: true,
        feeAmount: true,
        feeCurrency: true,
        exchangeRate: true,
        customer: {
          select: {
            id: true,
            customerNo: true,
            amlRiskTier: true,
            investorClassification: true,
          },
        },
      },
    });

    if (!swap) {
      throw new NotFoundException(`Swap ${swapId} not found`);
    }

    return swap;
  }

  private async resolveWithdrawContext(
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const withdraw = await (this.getDb(tx) as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: {
        id: true,
        withdrawNo: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        status: true,
        assetId: true,
        amount: true,
        netAmount: true,
        feeAmount: true,
        payoutId: true,
        payoutNo: true,
        preKytStatus: true,
        preKytRiskScore: true,
        kytStatus: true,
        kytRiskScore: true,
        travelRuleRequired: true,
        travelRuleStatus: true,
        complianceStatus: true,
      },
    });

    if (!withdraw) {
      throw new NotFoundException(`Withdraw ${withdrawId} not found`);
    }

    return withdraw;
  }

  private buildPendingSwapFinalSignals(input: {
    swap: {
      id: string;
      quoteId?: string | null;
      quoteNo?: string | null;
      ownerId?: string | null;
      fromAssetId?: string | null;
      fromAssetCode?: string | null;
      fromAmount?: Prisma.Decimal | null;
      toAssetId?: string | null;
      toAssetCode?: string | null;
      toAmount?: Prisma.Decimal | null;
      netToAmount?: Prisma.Decimal | null;
      feeAmount?: Prisma.Decimal | null;
      feeCurrency?: string | null;
      exchangeRate?: Prisma.Decimal | null;
      customer?: {
        amlRiskTier?: string | null;
        investorClassification?: string | null;
      } | null;
    };
  }): Record<string, unknown> {
    return {
      swapId: input.swap.id,
      quoteId: input.swap.quoteId || null,
      quoteNo: input.swap.quoteNo || null,
      customerId: input.swap.ownerId || null,
      fromAssetId: input.swap.fromAssetId || null,
      fromAssetCode: input.swap.fromAssetCode || null,
      fromAmount: input.swap.fromAmount?.toString?.() || null,
      toAssetId: input.swap.toAssetId || null,
      toAssetCode: input.swap.toAssetCode || null,
      toAmount: input.swap.toAmount?.toString?.() || null,
      netToAmount:
        input.swap.netToAmount?.toString?.() || input.swap.toAmount?.toString?.() || null,
      feeAmount: input.swap.feeAmount?.toString?.() || '0',
      feeCurrency: input.swap.feeCurrency || null,
      exchangeRate: input.swap.exchangeRate?.toString?.() || null,
      customerAmlRiskTier: input.swap.customer?.amlRiskTier || 'LOW',
      investorClassification: input.swap.customer?.investorClassification || null,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
      simulationMode: 'MANUAL_PENDING',
    };
  }

  private buildPendingWithdrawFinalSignals(input: {
    withdraw: {
      id: string;
      ownerId?: string | null;
      assetId?: string | null;
      amount?: Prisma.Decimal | null;
      netAmount?: Prisma.Decimal | null;
      feeAmount?: Prisma.Decimal | null;
      payoutId?: string | null;
      payoutNo?: string | null;
      travelRuleRequired?: boolean | null;
    };
    aggregate: TxAggregateSnapshot;
    kytStatus: string;
    travelRuleStatus: string;
  }): Record<string, unknown> {
    return {
      withdrawId: input.withdraw.id,
      payoutId: input.withdraw.payoutId || null,
      payoutNo: input.withdraw.payoutNo || null,
      customerId: input.withdraw.ownerId || null,
      assetId: input.withdraw.assetId || null,
      amount: input.withdraw.amount?.toString?.() || null,
      netAmount: input.withdraw.netAmount?.toString?.() || null,
      feeAmount: input.withdraw.feeAmount?.toString?.() || '0',
      kytStatus: input.kytStatus,
      mainKytStatus: input.kytStatus,
      travelRuleStatus: input.travelRuleStatus,
      travelRuleRequired:
        input.aggregate.travelRuleCase?.required ??
        input.withdraw.travelRuleRequired ??
        false,
      kytCaseId: input.aggregate.mainKytCase?.id || null,
      kytCaseNo: input.aggregate.mainKytCase?.caseNo || null,
      travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      travelRuleCaseNo: input.aggregate.travelRuleCase?.caseNo || null,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL,
      simulationMode: 'MANUAL_PENDING',
      finalComplianceSnapshot: {
        kytStatus: input.kytStatus,
        travelRuleStatus: input.travelRuleStatus,
        travelRuleRequired:
          input.aggregate.travelRuleCase?.required ??
          input.withdraw.travelRuleRequired ??
          false,
        kytCaseId: input.aggregate.mainKytCase?.id || null,
        travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      },
    };
  }

  private buildWithdrawFinalSignals(input: {
    withdraw: {
      id: string;
      ownerId?: string | null;
      assetId?: string | null;
      amount?: Prisma.Decimal | null;
      netAmount?: Prisma.Decimal | null;
      feeAmount?: Prisma.Decimal | null;
      payoutId?: string | null;
      payoutNo?: string | null;
      travelRuleRequired?: boolean | null;
    };
    aggregate: TxAggregateSnapshot;
    kytStatus: string;
    travelRuleStatus: string;
    riskProfile: WithdrawSimulationRiskProfile;
  }): Record<string, unknown> {
    return {
      withdrawId: input.withdraw.id,
      payoutId: input.withdraw.payoutId || null,
      payoutNo: input.withdraw.payoutNo || null,
      customerId: input.withdraw.ownerId || null,
      assetId: input.withdraw.assetId || null,
      amount: input.withdraw.amount?.toString?.() || null,
      netAmount: input.withdraw.netAmount?.toString?.() || null,
      feeAmount: input.withdraw.feeAmount?.toString?.() || '0',
      kytStatus: input.kytStatus,
      mainKytStatus: input.kytStatus,
      travelRuleStatus: input.travelRuleStatus,
      travelRuleRequired:
        input.aggregate.travelRuleCase?.required ??
        input.withdraw.travelRuleRequired ??
        false,
      kytCaseId: input.aggregate.mainKytCase?.id || null,
      kytCaseNo: input.aggregate.mainKytCase?.caseNo || null,
      kytProvider: input.aggregate.mainKytCase?.provider || null,
      kytProviderCaseId: input.aggregate.mainKytCase?.providerCaseId || null,
      kytRiskScore: input.aggregate.mainKytCase?.riskScore ?? null,
      travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      travelRuleCaseNo: input.aggregate.travelRuleCase?.caseNo || null,
      travelRuleProvider: input.aggregate.travelRuleCase?.provider || null,
      travelRuleProviderTransferId:
        input.aggregate.travelRuleCase?.providerTransferId || null,
      counterpartyVasp: input.aggregate.travelRuleCase?.counterpartyVasp || null,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL,
      riskBand: input.riskProfile.riskLevel,
      riskReason: input.riskProfile.riskReason,
      simulationSignalId: input.riskProfile.signalId,
      simulationMode: 'MANUAL',
      finalComplianceSnapshot: {
        kytStatus: input.kytStatus,
        travelRuleStatus: input.travelRuleStatus,
        travelRuleRequired:
          input.aggregate.travelRuleCase?.required ??
          input.withdraw.travelRuleRequired ??
          false,
        kytCaseId: input.aggregate.mainKytCase?.id || null,
        travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      },
    };
  }

  private buildSwapFinalSignals(input: {
    swap: {
      id: string;
      quoteId?: string | null;
      quoteNo?: string | null;
      ownerId?: string | null;
      fromAssetId?: string | null;
      fromAssetCode?: string | null;
      fromAmount?: Prisma.Decimal | null;
      toAssetId?: string | null;
      toAssetCode?: string | null;
      toAmount?: Prisma.Decimal | null;
      netToAmount?: Prisma.Decimal | null;
      feeAmount?: Prisma.Decimal | null;
      feeCurrency?: string | null;
      exchangeRate?: Prisma.Decimal | null;
      customer?: {
        amlRiskTier?: string | null;
        investorClassification?: string | null;
      } | null;
    };
    riskProfile: SwapSimulationRiskProfile;
  }): Record<string, unknown> {
    return {
      swapId: input.swap.id,
      quoteId: input.swap.quoteId || null,
      quoteNo: input.swap.quoteNo || null,
      customerId: input.swap.ownerId || null,
      fromAssetId: input.swap.fromAssetId || null,
      fromAssetCode: input.swap.fromAssetCode || null,
      fromAmount: input.swap.fromAmount?.toString?.() || null,
      toAssetId: input.swap.toAssetId || null,
      toAssetCode: input.swap.toAssetCode || null,
      toAmount: input.swap.toAmount?.toString?.() || null,
      netToAmount: input.swap.netToAmount?.toString?.() || input.swap.toAmount?.toString?.() || null,
      feeAmount: input.swap.feeAmount?.toString?.() || '0',
      feeCurrency: input.swap.feeCurrency || null,
      exchangeRate: input.swap.exchangeRate?.toString?.() || null,
      customerAmlRiskTier: input.swap.customer?.amlRiskTier || 'LOW',
      investorClassification:
        input.swap.customer?.investorClassification || null,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
      riskBand: input.riskProfile.riskLevel,
      riskReason: input.riskProfile.riskReason,
      simulationMode: 'MANUAL',
    };
  }

  private buildPendingDepositFinalSignals(input: {
    deposit: {
      id: string;
      ownerId?: string | null;
      assetId?: string | null;
      travelRuleRequired?: boolean | null;
    };
    aggregate: TxAggregateSnapshot;
    kytStatus: string;
    travelRuleStatus: string;
  }): Record<string, unknown> {
    return {
      depositId: input.deposit.id,
      customerId: input.deposit.ownerId || null,
      assetId: input.deposit.assetId || null,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
      triggerStatus: 'PENDING_SIMULATION',
      kytStatus: input.kytStatus,
      travelRuleStatus: input.travelRuleStatus,
      travelRuleRequired:
        input.aggregate.travelRuleCase?.required ?? input.deposit.travelRuleRequired ?? false,
      kytCaseId: input.aggregate.mainKytCase?.id || null,
      kytCaseNo: input.aggregate.mainKytCase?.caseNo || null,
      kytProvider: input.aggregate.mainKytCase?.provider || null,
      kytProviderCaseId: input.aggregate.mainKytCase?.providerCaseId || null,
      kytRiskScore: input.aggregate.mainKytCase?.riskScore ?? null,
      travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      travelRuleCaseNo: input.aggregate.travelRuleCase?.caseNo || null,
      travelRuleProvider: input.aggregate.travelRuleCase?.provider || null,
      travelRuleProviderTransferId:
        input.aggregate.travelRuleCase?.providerTransferId || null,
      counterpartyVasp: input.aggregate.travelRuleCase?.counterpartyVasp || null,
      simulationMode: 'MANUAL_PENDING',
      finalComplianceSnapshot: {
        kytStatus: input.kytStatus,
        travelRuleStatus: input.travelRuleStatus,
        travelRuleRequired:
          input.aggregate.travelRuleCase?.required ??
          input.deposit.travelRuleRequired ??
          false,
        kytCaseId: input.aggregate.mainKytCase?.id || null,
        travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      },
    };
  }

  private buildDepositFinalSignals(input: {
    deposit: {
      id: string;
      ownerId?: string | null;
      assetId?: string | null;
      travelRuleRequired?: boolean | null;
    };
    aggregate: TxAggregateSnapshot;
    kytStatus: string;
    travelRuleStatus: string;
    riskProfile: DepositSimulationRiskProfile;
  }): Record<string, unknown> {
    return {
      depositId: input.deposit.id,
      customerId: input.deposit.ownerId || null,
      assetId: input.deposit.assetId || null,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
      kytStatus: input.kytStatus,
      travelRuleStatus: input.travelRuleStatus,
      travelRuleRequired:
        input.aggregate.travelRuleCase?.required ?? input.deposit.travelRuleRequired ?? false,
      kytCaseId: input.aggregate.mainKytCase?.id || null,
      kytCaseNo: input.aggregate.mainKytCase?.caseNo || null,
      kytProvider: input.aggregate.mainKytCase?.provider || null,
      kytProviderCaseId: input.aggregate.mainKytCase?.providerCaseId || null,
      kytRiskScore: input.aggregate.mainKytCase?.riskScore ?? null,
      travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      travelRuleCaseNo: input.aggregate.travelRuleCase?.caseNo || null,
      travelRuleProvider: input.aggregate.travelRuleCase?.provider || null,
      travelRuleProviderTransferId:
        input.aggregate.travelRuleCase?.providerTransferId || null,
      counterpartyVasp: input.aggregate.travelRuleCase?.counterpartyVasp || null,
      riskBand: input.riskProfile.riskLevel,
      riskReason: input.riskProfile.riskReason,
      simulationSignalId: input.riskProfile.signalId,
      simulationMode: 'MANUAL',
      finalComplianceSnapshot: {
        kytStatus: input.kytStatus,
        travelRuleStatus: input.travelRuleStatus,
        travelRuleRequired:
          input.aggregate.travelRuleCase?.required ??
          input.deposit.travelRuleRequired ??
          false,
        kytCaseId: input.aggregate.mainKytCase?.id || null,
        travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
      },
    };
  }

  private async executeDepositFinalReview(
    input: {
      deposit: {
        id: string;
        depositNo: string | null;
        ownerType: string;
        ownerId: string | null;
        assetId: string;
        kytStatus?: string | null;
        travelRuleStatus?: string | null;
        travelRuleRequired?: boolean | null;
        payin?: {
          providerTxnId?: string | null;
        } | null;
      };
      aggregate: TxAggregateSnapshot;
      kytStatus: string;
      travelRuleStatus: string;
      riskProfile: DepositSimulationRiskProfile;
      triggerStatus: string;
      decisionResult?: ResolvedDecisionResult;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const triggerStatus = String(input.triggerStatus || '').trim().toUpperCase();
    const riskInput: EvaluateRiskInput = {
      contextType: 'TX_DEPOSIT_FINAL',
      subjectType: 'DEPOSIT',
      subjectId: input.deposit.id,
      ownerType: 'CUSTOMER',
      ownerId: input.deposit.ownerId as string,
      signals: this.buildDepositFinalSignals({
        deposit: input.deposit,
        aggregate: input.aggregate,
        kytStatus: input.kytStatus,
        travelRuleStatus: input.travelRuleStatus,
        riskProfile: input.riskProfile,
      }),
    };

    const decisionResult =
      input.decisionResult || (await this.resolveDecision(riskInput, tx));
    const actionNames = this.normalizeActionNames(
      decisionResult.recommendedActions,
    );
    let workflowTransition: Record<string, unknown> | null = null;

    if (!decisionResult.reused && decisionResult.decision === 'APPROVE') {
      workflowTransition = this.toRecordObject(
        await this.clearDepositIfApproved(
        {
          depositId: input.deposit.id,
          depositNo: input.deposit.depositNo,
          customerId: input.deposit.ownerId as string,
          decisionRecordId: decisionResult.decisionRecordId,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED,
          triggerStatus,
          reason: `Deposit ${input.deposit.depositNo} auto-approved after final transaction decision`,
        },
        tx,
      ),
      );
    }

    await this.recordRiskAudit(
      {
        depositId: input.deposit.id,
        depositNo: input.deposit.depositNo,
        customerId: input.deposit.ownerId as string,
        contextType: riskInput.contextType,
        triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
        triggerStatus,
        decisionRecordId: decisionResult.decisionRecordId,
        decision: decisionResult.decision,
        reusedDecisionRecord: decisionResult.reused,
        alertId: null,
        caseId: null,
      },
      tx,
    );
    await this.writeDecisionRecordOutcomeSnapshot(
      {
        decisionRecordId: decisionResult.decisionRecordId,
        sourceType: 'DEPOSIT',
        sourceId: input.deposit.id,
        sourceNo: input.deposit.depositNo,
        stage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
        rule: TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED,
        decision: decisionResult.decision,
        recommendedActions: actionNames,
        reasonCodes: decisionResult.reasonCodes,
        alertId: null,
        alertNo: null,
        caseId: null,
        caseNo: null,
        workflowTransition,
        reusedDecisionRecord: decisionResult.reused,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: null,
      alertNo: null,
      caseId: null,
      caseNo: null,
    };
  }

  private async clearDepositIfApproved(
    input: {
      depositId: string;
      depositNo?: string | null;
      customerId: string;
      decisionRecordId: string;
      reasonCode: string;
      reason: string;
      triggerStatus: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const transitionService = this.getTransactionWorkflowTransitionService();
    if (!transitionService) {
      this.logger.debug(
        `Transaction deposit workflow transition unavailable; skip CLEAR for deposit ${input.depositId}`,
      );
      return null;
    }

    return transitionService.execute(tx, {
      depositId: input.depositId,
      source: 'SYSTEM',
      sourceId: input.decisionRecordId,
      workflowAction: 'CLEAR',
      reason: input.reason,
      reasonCode: input.reasonCode,
      actor: {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      decisionRecordId: input.decisionRecordId,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
      triggerStatus: input.triggerStatus,
    });
  }

  private async clearSwapIfApproved(
    input: {
      swapId: string;
      swapNo?: string | null;
      quoteId?: string | null;
      quoteNo?: string | null;
      customerId: string;
      customerNo?: string | null;
      decisionRecordId: string;
      reasonCode: string;
      reason: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const transitionService = this.getSwapWorkflowTransitionService();
    if (!transitionService) {
      this.logger.debug(
        `Swap workflow transition unavailable; skip CLEAR for swap ${input.swapId}`,
      );
      return null;
    }

    return transitionService.execute(tx, {
      swapId: input.swapId,
      source: 'SYSTEM',
      sourceId: input.decisionRecordId,
      workflowAction: 'CLEAR',
      reason: input.reason,
      reasonCode: input.reasonCode,
      actor: {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      decisionRecordId: input.decisionRecordId,
      riskDecisionRef: input.decisionRecordId,
      triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
      triggerStatus: 'APPROVE',
    });
  }

  private async clearWithdrawIfApproved(
    input: {
      withdrawId: string;
      withdrawNo?: string | null;
      payoutId?: string | null;
      payoutNo?: string | null;
      customerId: string;
      customerNo?: string | null;
      decisionRecordId: string;
      reasonCode: string;
      reason: string;
      triggerStage: string;
      triggerStatus: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const transitionService = this.getWithdrawWorkflowTransitionService();
    if (!transitionService) {
      this.logger.debug(
        `Withdraw workflow transition unavailable; skip CLEAR for withdraw ${input.withdrawId}`,
      );
      return null;
    }

    return transitionService.execute(tx, {
      withdrawId: input.withdrawId,
      source: 'SYSTEM',
      sourceId: input.decisionRecordId,
      workflowAction: 'CLEAR',
      reason: input.reason,
      reasonCode: input.reasonCode,
      actor: {
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      decisionRecordId: input.decisionRecordId,
      triggerStage: input.triggerStage,
      triggerStatus: input.triggerStatus,
    });
  }

  private async loadCompletedDecisionRecord(
    input: EvaluateRiskInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx) as any;
    const inputHash = this.riskEngineService.buildInputHash(input);

    const row = await db.workflowDecisionRecord.findFirst({
      where: {
        customerId: input.ownerId,
        contextType: input.contextType,
        subjectId: input.subjectId,
        inputHash,
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        outputDecision: true,
        recommendedActions: true,
        reasonCodes: true,
      },
    });

    if (!row) {
      return null;
    }

    return {
      decisionRecordId: row.id,
      decision: row.outputDecision as RiskDecision,
      recommendedActions: this.parseJsonSafely<RiskRecommendedAction[]>(
        row.recommendedActions,
        [],
      ),
      reasonCodes: this.parseJsonSafely<string[]>(row.reasonCodes, []),
      reused: true,
    };
  }

  private async resolveDecision(
    input: EvaluateRiskInput,
    tx?: Prisma.TransactionClient,
  ) {
    const existing = await this.loadCompletedDecisionRecord(input, tx);
    if (existing) {
      return existing;
    }

    const evaluated = await this.riskEngineService.evaluate(input);
    return {
      decisionRecordId: evaluated.decisionRecordId,
      decision: evaluated.decision,
      recommendedActions: evaluated.recommendedActions,
      reasonCodes: evaluated.reasonCodes,
      reused: false,
    };
  }

  private async loadLatestDecisionRecordForSubject(
    input: Pick<EvaluateRiskInput, 'contextType' | 'subjectId' | 'ownerId'>,
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx) as any;
    return db.workflowDecisionRecord.findFirst({
      where: {
        customerId: input.ownerId,
        contextType: input.contextType,
        subjectId: input.subjectId,
        status: {
          in: ['CREATED', 'COMPLETED'],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        outputDecision: true,
      },
    });
  }

  private async ensurePendingDecisionRecord(
    input: EvaluateRiskInput,
    tx?: Prisma.TransactionClient,
  ) {
    const existing = await this.loadLatestDecisionRecordForSubject(input, tx);
    if (existing) {
      return {
        decisionRecordId: existing.id,
        status: String(existing.status || '').trim().toUpperCase(),
        decision:
          (this.normalizeOptionalString(existing.outputDecision) as RiskDecision | null) ||
          null,
        created: false,
      };
    }

    const created = await this.riskEngineService.createPendingDecisionRecord(input, tx);
    return {
      decisionRecordId: created.decisionRecordId,
      status: 'CREATED',
      decision: null,
      created: true,
    };
  }

  private async recordRiskAudit(
    input: {
      depositId: string;
      depositNo?: string | null;
      customerId: string;
      contextType: string;
      triggerStage: string;
      triggerStatus: string;
      decisionRecordId: string;
      decision: string;
      reusedDecisionRecord: boolean;
      alertId?: string | null;
      caseId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_RISK_EVALUATED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: input.depositId,
        entityNo: input.depositNo || undefined,
        traceId: `TRANSACTION:${input.depositId}`,
        workflowType: 'TRANSACTION',
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        reason: `Transaction risk evaluated for ${input.triggerStage}`,
        metadata: {
          depositId: input.depositId,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          decision: input.decision,
          reusedDecisionRecord: input.reusedDecisionRecord,
          alertId: input.alertId || null,
          caseId: input.caseId || null,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );
  }

  private async recordSwapRiskAudit(
    input: {
      swapId: string;
      swapNo?: string | null;
      quoteId?: string | null;
      quoteNo?: string | null;
      customerId: string;
      customerNo?: string | null;
      contextType: string;
      decisionRecordId: string;
      decision: string;
      reusedDecisionRecord: boolean;
      alertId?: string | null;
      caseId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const { traceId } = this.buildSwapAuditWorkflowContext({
      swapId: input.swapId,
      swapNo: input.swapNo,
    });
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_RISK_EVALUATED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: input.swapId,
        entityNo: input.swapNo || undefined,
        traceId,
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: input.customerNo || undefined,
        reason: 'Swap final transaction risk evaluated',
        metadata: {
          swapId: input.swapId,
          quoteId: input.quoteId || null,
          quoteNo: input.quoteNo || null,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
          decisionRecordId: input.decisionRecordId,
          decision: input.decision,
          reusedDecisionRecord: input.reusedDecisionRecord,
          alertId: input.alertId || null,
          caseId: input.caseId || null,
          sourceType: TRANSACTION_SWAP_SOURCE_TYPE,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );
  }

  private async recordCaseAudit(
    input: {
      depositId: string;
      depositNo?: string | null;
      customerId: string;
      contextType: string;
      triggerStage: string;
      triggerStatus: string;
      decisionRecordId: string;
      alertId: string;
      caseId: string;
      caseNo?: string | null;
      reusedCase: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_CASE_ESCALATED,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: input.caseId,
        entityNo: input.caseNo || undefined,
        traceId: `TRANSACTION:${input.depositId}`,
        workflowType: 'TRANSACTION',
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        reason: `Transaction case escalated for ${input.triggerStage}`,
        metadata: {
          depositId: input.depositId,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
          caseId: input.caseId,
          reusedCase: input.reusedCase,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );
  }

  private async recordSwapCaseAudit(
    input: {
      swapId: string;
      swapNo?: string | null;
      quoteId?: string | null;
      quoteNo?: string | null;
      customerId: string;
      customerNo?: string | null;
      contextType: string;
      decisionRecordId: string;
      alertId: string;
      caseId: string;
      caseNo?: string | null;
      reusedCase: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const { traceId } = this.buildSwapAuditWorkflowContext({
      swapId: input.swapId,
      swapNo: input.swapNo,
    });
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_CASE_ESCALATED,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: input.caseId,
        entityNo: input.caseNo || undefined,
        traceId,
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: input.customerNo || undefined,
        reason: 'Swap final transaction case escalated',
        metadata: {
          swapId: input.swapId,
          quoteId: input.quoteId || null,
          quoteNo: input.quoteNo || null,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
          caseId: input.caseId,
          reusedCase: input.reusedCase,
          sourceType: TRANSACTION_SWAP_SOURCE_TYPE,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );
  }

  private buildSwapAuditWorkflowContext(input: {
    swapId: string;
    swapNo?: string | null;
  }) {
    return {
      traceId: `SWAP:${input.swapId}`,
    };
  }

  private async recordWithdrawRiskAudit(
    input: {
      withdrawId: string;
      withdrawNo?: string | null;
      payoutId?: string | null;
      payoutNo?: string | null;
      customerId: string;
      customerNo?: string | null;
      contextType: string;
      triggerStage: string;
      triggerStatus: string;
      decisionRecordId: string;
      decision: string;
      reusedDecisionRecord: boolean;
      alertId?: string | null;
      caseId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_RISK_EVALUATED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: input.withdrawId,
        entityNo: input.withdrawNo || undefined,
        traceId: `${AuditWorkflowTypes.WITHDRAW}:${input.withdrawId}`,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: input.customerNo || undefined,
        reason: `Withdraw transaction risk evaluated for ${input.triggerStage}`,
        metadata: {
          withdrawId: input.withdrawId,
          payoutId: input.payoutId || null,
          payoutNo: input.payoutNo || null,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          decision: input.decision,
          reusedDecisionRecord: input.reusedDecisionRecord,
          alertId: input.alertId || null,
          caseId: input.caseId || null,
          sourceType: TRANSACTION_WITHDRAW_SOURCE_TYPE,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );
  }

  private async recordWithdrawCaseAudit(
    input: {
      withdrawId: string;
      withdrawNo?: string | null;
      payoutId?: string | null;
      payoutNo?: string | null;
      customerId: string;
      customerNo?: string | null;
      contextType: string;
      triggerStage: string;
      triggerStatus: string;
      decisionRecordId: string;
      alertId: string;
      caseId: string;
      caseNo?: string | null;
      reusedCase: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_CASE_ESCALATED,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: input.caseId,
        entityNo: input.caseNo || undefined,
        traceId: `${AuditWorkflowTypes.WITHDRAW}:${input.withdrawId}`,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: input.customerNo || undefined,
        reason: `Withdraw transaction case escalated for ${input.triggerStage}`,
        metadata: {
          withdrawId: input.withdrawId,
          payoutId: input.payoutId || null,
          payoutNo: input.payoutNo || null,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
          caseId: input.caseId,
          reusedCase: input.reusedCase,
          sourceType: TRANSACTION_WITHDRAW_SOURCE_TYPE,
        },
        sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
      },
      tx,
    );
  }

  private async executeSwapFinalReview(
    input: {
      swap: Awaited<ReturnType<TransactionRiskBridgeService['resolveSwapContext']>>;
      riskProfile: SwapSimulationRiskProfile;
      decisionResult: ResolvedDecisionResult;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const riskInput: EvaluateRiskInput = {
      contextType: 'TX_SWAP_FINAL',
      subjectType: 'SWAP',
      subjectId: input.swap.id,
      ownerType: 'CUSTOMER',
      ownerId: input.swap.ownerId,
      signals: this.buildSwapFinalSignals({
        swap: input.swap,
        riskProfile: input.riskProfile,
      }),
    };
    const actionNames = this.normalizeActionNames(
      input.decisionResult.recommendedActions,
    );
    let workflowTransition: Record<string, unknown> | null = null;

    if (!input.decisionResult.reused && input.decisionResult.decision === 'APPROVE') {
      workflowTransition = this.toRecordObject(
        await this.clearSwapIfApproved(
        {
          swapId: input.swap.id,
          swapNo: input.swap.swapNo,
          quoteId: input.swap.quoteId || null,
          quoteNo: input.swap.quoteNo || null,
          customerId: input.swap.ownerId,
          customerNo: input.swap.customer?.customerNo || null,
          decisionRecordId: input.decisionResult.decisionRecordId,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_SWAP_FINAL_REVIEW_REQUIRED,
          reason: `Swap ${input.swap.swapNo} auto-approved after final transaction decision`,
        },
        tx,
      ),
      );
    }

    await this.recordSwapRiskAudit(
      {
        swapId: input.swap.id,
        swapNo: input.swap.swapNo,
        quoteId: input.swap.quoteId || null,
        quoteNo: input.swap.quoteNo || null,
        customerId: input.swap.ownerId,
        customerNo: input.swap.customer?.customerNo || null,
        contextType: riskInput.contextType,
        decisionRecordId: input.decisionResult.decisionRecordId,
        decision: input.decisionResult.decision,
        reusedDecisionRecord: input.decisionResult.reused,
        alertId: null,
        caseId: null,
      },
      tx,
    );
    await this.writeDecisionRecordOutcomeSnapshot(
      {
        decisionRecordId: input.decisionResult.decisionRecordId,
        sourceType: 'SWAP',
        sourceId: input.swap.id,
        sourceNo: input.swap.swapNo,
        stage: TRANSACTION_REVIEW_STAGES.REVIEW_SWAP_FINAL,
        rule: TRANSACTION_REVIEW_RULES.TX_SWAP_FINAL_REVIEW_REQUIRED,
        decision: input.decisionResult.decision,
        recommendedActions: actionNames,
        reasonCodes: input.decisionResult.reasonCodes,
        alertId: null,
        alertNo: null,
        caseId: null,
        caseNo: null,
        workflowTransition,
        reusedDecisionRecord: input.decisionResult.reused,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: input.decisionResult.decisionRecordId,
      decision: input.decisionResult.decision,
      alertId: null,
      alertNo: null,
      caseId: null,
      caseNo: null,
    };
  }

  async handleSwapFinalReview(
    input: SwapFinalReviewInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (input.sourceType !== TxSourceType.SWAP) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    if (input.reportDeduped) {
      return { skipped: true, skipReason: 'REPORT_DEDUPED' };
    }

    const swap = await this.resolveSwapContext(input.swapId, tx);
    if (swap.ownerType !== 'CUSTOMER' || !swap.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const currentStatus = String(swap.status || '').trim().toUpperCase();
    if (
      currentStatus !== 'PENDING_COMPLIANCE' &&
      currentStatus !== 'UNDER_REVIEW'
    ) {
      return { skipped: true, skipReason: 'STATUS_NOT_ELIGIBLE' };
    }

    const pending = await this.ensurePendingDecisionRecord(
      {
        contextType: 'TX_SWAP_FINAL',
        subjectType: 'SWAP',
        subjectId: input.swapId,
        ownerType: 'CUSTOMER',
        ownerId: swap.ownerId,
        signals: this.buildPendingSwapFinalSignals({ swap }),
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: pending.decisionRecordId,
      decision: pending.status === 'COMPLETED' ? pending.decision : null,
    };
  }

  async initializeWithdrawFinalReview(
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const withdraw = await this.resolveWithdrawContext(withdrawId, tx);
    if (withdraw.ownerType !== 'CUSTOMER' || !withdraw.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const currentStatus = String(withdraw.status || '').trim().toUpperCase();
    if (
      currentStatus !== 'PENDING_COMPLIANCE' &&
      currentStatus !== 'UNDER_REVIEW'
    ) {
      return { skipped: true, skipReason: 'STATUS_NOT_ELIGIBLE' };
    }

    const db = this.getDb(tx) as any;
    const [preKytCase, travelRuleCase] = await Promise.all([
      db.kytCase.findUnique({
        where: {
          sourceType_sourceId_screeningStage: {
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdraw.id,
            screeningStage: 'PRE_TXN',
          },
        },
        select: {
          id: true,
          caseNo: true,
          status: true,
          provider: true,
          providerCaseId: true,
          riskScore: true,
        },
      }),
      db.travelRuleCase.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: TxSourceType.WITHDRAW,
            sourceId: withdraw.id,
          },
        },
        select: {
          id: true,
          caseNo: true,
          status: true,
          required: true,
          provider: true,
          providerTransferId: true,
          counterpartyVasp: true,
        },
      }),
    ]);

    const aggregate: TxAggregateSnapshot = {
      derivedComplianceStatus:
        this.deriveWithdrawComplianceStatusFromTransactionStatus(withdraw.status),
      preKytCase,
      mainKytCase: null,
      travelRuleCase,
    };

    const pending = await this.ensurePendingDecisionRecord(
      {
        contextType: 'TX_WITHDRAW_FINAL',
        subjectType: 'WITHDRAW',
        subjectId: withdraw.id,
        ownerType: 'CUSTOMER',
        ownerId: withdraw.ownerId,
        signals: this.buildPendingWithdrawFinalSignals({
          withdraw,
          aggregate,
          kytStatus: 'FINAL',
          travelRuleStatus: travelRuleCase?.status || 'FINAL',
        }),
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: pending.decisionRecordId,
      decision: pending.status === 'COMPLETED' ? pending.decision : null,
    };
  }

  async simulateSwapFinalReview(
    input: ManualRiskSimulationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const db = this.getDb(tx) as any;
    const decisionRecord = await db.workflowDecisionRecord.findUnique({
      where: { id: input.decisionRecordId },
      select: {
        id: true,
        status: true,
        contextType: true,
        subjectId: true,
        customerId: true,
      },
    });

    if (!decisionRecord) {
      throw new NotFoundException(
        `Risk decision record not found: ${input.decisionRecordId}`,
      );
    }
    if (String(decisionRecord.contextType || '').trim().toUpperCase() !== 'TX_SWAP_FINAL') {
      throw new ConflictException(
        `Decision record ${input.decisionRecordId} is not bound to TX_SWAP_FINAL`,
      );
    }
    if (String(decisionRecord.status || '').trim().toUpperCase() !== 'CREATED') {
      throw new ConflictException(
        `Decision record ${input.decisionRecordId} is not pending simulation`,
      );
    }

    const swap = await this.resolveSwapContext(decisionRecord.subjectId, tx);
    const riskProfile: SwapSimulationRiskProfile = {
      riskLevel: input.riskLevel,
      riskReason: input.riskReason,
    };
    const decisionResult = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'TX_SWAP_FINAL',
        subjectType: 'SWAP',
        subjectId: swap.id,
        ownerType: 'CUSTOMER',
        ownerId: swap.ownerId,
        signals: this.buildSwapFinalSignals({
          swap,
          riskProfile,
        }),
      },
      tx,
    );

    return this.executeSwapFinalReview(
      {
        swap,
        riskProfile,
        decisionResult: {
          decisionRecordId: decisionResult.decisionRecordId,
          decision: decisionResult.decision,
          recommendedActions: decisionResult.recommendedActions,
          reasonCodes: decisionResult.reasonCodes,
          reused: false,
        },
      },
      tx,
    );
  }

  private async executeWithdrawFinalReview(
    input: {
      withdraw: Awaited<ReturnType<TransactionRiskBridgeService['resolveWithdrawContext']>>;
      aggregate: TxAggregateSnapshot;
      kytStatus: string;
      travelRuleStatus: string;
      riskProfile: WithdrawSimulationRiskProfile;
      triggerStatus: string;
      decisionResult?: ResolvedDecisionResult;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const triggerStatus = String(input.triggerStatus || '').trim().toUpperCase();
    const riskInput: EvaluateRiskInput = {
      contextType: 'TX_WITHDRAW_FINAL',
      subjectType: 'WITHDRAW',
      subjectId: input.withdraw.id,
      ownerType: 'CUSTOMER',
      ownerId: input.withdraw.ownerId as string,
      signals: input.decisionResult
        ? this.buildWithdrawFinalSignals({
            withdraw: input.withdraw,
            aggregate: input.aggregate,
            kytStatus: input.kytStatus,
            travelRuleStatus: input.travelRuleStatus,
            riskProfile: input.riskProfile,
          })
        : this.buildPendingWithdrawFinalSignals({
            withdraw: input.withdraw,
            aggregate: input.aggregate,
            kytStatus: input.kytStatus,
            travelRuleStatus: input.travelRuleStatus,
          }),
    };

    const decisionResult =
      input.decisionResult || (await this.resolveDecision(riskInput, tx));
    const actionNames = this.normalizeActionNames(
      decisionResult.recommendedActions,
    );
    let workflowTransition: Record<string, unknown> | null = null;

    if (!decisionResult.reused && decisionResult.decision === 'APPROVE') {
      workflowTransition = this.toRecordObject(
        await this.clearWithdrawIfApproved(
          {
            withdrawId: input.withdraw.id,
            withdrawNo: input.withdraw.withdrawNo,
            payoutId: input.withdraw.payoutId || null,
            payoutNo: input.withdraw.payoutNo || null,
            customerId: input.withdraw.ownerId as string,
            customerNo: input.withdraw.ownerNo || null,
            decisionRecordId: decisionResult.decisionRecordId,
            reasonCode:
              TRANSACTION_REVIEW_RULES.TX_WITHDRAW_FINAL_REVIEW_REQUIRED,
            reason: `Withdraw ${input.withdraw.withdrawNo} auto-cleared after final transaction decision`,
            triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL,
            triggerStatus,
          },
          tx,
        ),
      );
    }

    await this.recordWithdrawRiskAudit(
      {
        withdrawId: input.withdraw.id,
        withdrawNo: input.withdraw.withdrawNo,
        payoutId: input.withdraw.payoutId || null,
        payoutNo: input.withdraw.payoutNo || null,
        customerId: input.withdraw.ownerId as string,
        customerNo: input.withdraw.ownerNo || null,
        contextType: riskInput.contextType,
        triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL,
        triggerStatus,
        decisionRecordId: decisionResult.decisionRecordId,
        decision: decisionResult.decision,
        reusedDecisionRecord: decisionResult.reused,
        alertId: null,
        caseId: null,
      },
      tx,
    );

    await this.writeDecisionRecordOutcomeSnapshot(
      {
        decisionRecordId: decisionResult.decisionRecordId,
        sourceType: 'WITHDRAW',
        sourceId: input.withdraw.id,
        sourceNo: input.withdraw.withdrawNo,
        stage: TRANSACTION_REVIEW_STAGES.REVIEW_WITHDRAW_FINAL,
        rule: TRANSACTION_REVIEW_RULES.TX_WITHDRAW_FINAL_REVIEW_REQUIRED,
        decision: decisionResult.decision,
        recommendedActions: actionNames,
        reasonCodes: decisionResult.reasonCodes,
        alertId: null,
        alertNo: null,
        caseId: null,
        caseNo: null,
        workflowTransition,
        reusedDecisionRecord: decisionResult.reused,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: null,
      alertNo: null,
      caseId: null,
      caseNo: null,
    };
  }

  async handleWithdrawPrecheckReview(
    input: WithdrawPrecheckReviewInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (input.sourceType !== TxSourceType.WITHDRAW) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    return { skipped: true, skipReason: 'LEGACY_PRECHECK_READ_ONLY' };
  }

  async simulateWithdrawPrecheckReview(
    input: ManualRiskSimulationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    throw new ConflictException(
      `Decision record ${input.decisionRecordId} is historical read-only and no longer supports manual simulation`,
    );
  }

  async handleWithdrawFinalReviewIfReady(
    input: WithdrawFinalReviewInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (input.sourceType !== TxSourceType.WITHDRAW) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    if (input.reportDeduped) {
      return { skipped: true, skipReason: 'REPORT_DEDUPED' };
    }
    if (!this.isWithdrawFinalReviewReady(input.aggregate)) {
      return { skipped: true, skipReason: 'FINAL_REVIEW_NOT_READY' };
    }

    const withdraw = await this.resolveWithdrawContext(input.withdrawId, tx);
    if (withdraw.ownerType !== 'CUSTOMER' || !withdraw.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const currentStatus = String(withdraw.status || '').trim().toUpperCase();
    if (
      currentStatus !== 'PAYOUT_PENDING' &&
      currentStatus !== 'UNDER_REVIEW'
    ) {
      return { skipped: true, skipReason: 'STATUS_NOT_ELIGIBLE' };
    }

    const kytStatus = this.normalizeKytLifecycleStatus(
      input.aggregate.mainKytCase?.status || withdraw.kytStatus,
    );
    const travelRuleStatus = this.normalizeTravelRuleLifecycleStatus(
      input.aggregate.travelRuleCase?.status || withdraw.travelRuleStatus,
      input.aggregate.travelRuleCase?.required ?? withdraw.travelRuleRequired,
    );
    const riskProfile: WithdrawSimulationRiskProfile = {
      riskLevel:
        kytStatus === 'FINAL' && travelRuleStatus === 'FINAL'
          ? 'LOW'
          : 'MEDIUM',
      riskReason:
        kytStatus === 'FINAL' && travelRuleStatus === 'FINAL'
          ? 'TX_WITHDRAW_RESPONSE_CONTAINERS_FINAL'
          : 'TX_WITHDRAW_RESPONSE_CONTAINERS_PENDING',
      signalId: null,
    };

    return this.executeWithdrawFinalReview(
      {
        withdraw,
        aggregate: input.aggregate,
        kytStatus,
        travelRuleStatus,
        riskProfile,
        triggerStatus: input.triggerStatus,
      },
      tx,
    );
  }

  async simulateWithdrawFinalReview(
    input: ManualRiskSimulationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const db = this.getDb(tx) as any;
    const decisionRecord = await db.workflowDecisionRecord.findUnique({
      where: { id: input.decisionRecordId },
      select: {
        id: true,
        status: true,
        contextType: true,
        subjectId: true,
      },
    });

    if (!decisionRecord) {
      throw new NotFoundException(
        `Risk decision record not found: ${input.decisionRecordId}`,
      );
    }
    if (
      String(decisionRecord.contextType || '').trim().toUpperCase() !==
      'TX_WITHDRAW_FINAL'
    ) {
      throw new ConflictException(
        `Decision record ${input.decisionRecordId} is not bound to TX_WITHDRAW_FINAL`,
      );
    }
    if (String(decisionRecord.status || '').trim().toUpperCase() !== 'CREATED') {
      throw new ConflictException(
        `Decision record ${input.decisionRecordId} is not pending simulation`,
      );
    }

    const withdraw = await this.resolveWithdrawContext(decisionRecord.subjectId, tx);
    if (withdraw.ownerType !== 'CUSTOMER' || !withdraw.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const aggregate: TxAggregateSnapshot = {
      derivedComplianceStatus:
        this.deriveWithdrawComplianceStatusFromTransactionStatus(withdraw.status),
      mainKytCase: {
        status: this.normalizeKytLifecycleStatus(withdraw.kytStatus),
        riskScore: withdraw.kytRiskScore ?? null,
      },
      travelRuleCase: {
        status: this.normalizeTravelRuleLifecycleStatus(
          withdraw.travelRuleStatus,
          !!withdraw.travelRuleRequired,
        ),
        required: !!withdraw.travelRuleRequired,
      },
    };
    const kytStatus = this.normalizeKytLifecycleStatus(withdraw.kytStatus);
    const travelRuleStatus = this.normalizeTravelRuleLifecycleStatus(
      withdraw.travelRuleStatus,
      !!withdraw.travelRuleRequired,
    );
    const riskProfile: WithdrawSimulationRiskProfile = {
      riskLevel: input.riskLevel,
      riskReason: input.riskReason,
      signalId: null,
    };
    const decisionResult = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'TX_WITHDRAW_FINAL',
        subjectType: 'WITHDRAW',
        subjectId: withdraw.id,
        ownerType: 'CUSTOMER',
        ownerId: withdraw.ownerId,
        signals: this.buildWithdrawFinalSignals({
          withdraw,
          aggregate,
          kytStatus,
          travelRuleStatus,
          riskProfile,
        }),
      },
      tx,
    );

    return this.executeWithdrawFinalReview(
      {
        withdraw,
        aggregate,
        kytStatus,
        travelRuleStatus,
        riskProfile,
        triggerStatus: 'MANUAL_SIMULATION',
        decisionResult: {
          decisionRecordId: decisionResult.decisionRecordId,
          decision: decisionResult.decision,
          recommendedActions: decisionResult.recommendedActions,
          reasonCodes: decisionResult.reasonCodes,
          reused: false,
        },
      },
      tx,
    );
  }

  async handleDepositFinalReviewIfReady(
    input: DepositFinalReviewInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (input.sourceType !== TxSourceType.DEPOSIT) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    if (input.reportDeduped) {
      return { skipped: true, skipReason: 'REPORT_DEDUPED' };
    }
    if (!this.isDepositFinalReviewReady(input.aggregate)) {
      return { skipped: true, skipReason: 'FINAL_REVIEW_NOT_READY' };
    }

    const deposit = await this.resolveDepositContext(input.depositId, tx);
    if (deposit.ownerType !== 'CUSTOMER' || !deposit.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const kytStatus = this.normalizeKytLifecycleStatus(
      input.aggregate.mainKytCase?.status || deposit.kytStatus,
    );
    const travelRuleStatus = this.normalizeTravelRuleLifecycleStatus(
      input.aggregate.travelRuleCase?.status || deposit.travelRuleStatus,
      input.aggregate.travelRuleCase?.required ?? deposit.travelRuleRequired,
    );
    const pending = await this.ensurePendingDecisionRecord(
      {
        contextType: 'TX_DEPOSIT_FINAL',
        subjectType: 'DEPOSIT',
        subjectId: input.depositId,
        ownerType: 'CUSTOMER',
        ownerId: deposit.ownerId,
        signals: this.buildPendingDepositFinalSignals({
          deposit,
          aggregate: input.aggregate,
          kytStatus,
          travelRuleStatus,
        }),
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: pending.decisionRecordId,
      decision: pending.status === 'COMPLETED' ? pending.decision : null,
    };
  }

  async handleDirectDepositFinalReview(
    input: DirectDepositFinalReviewInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    if (input.sourceType !== TxSourceType.DEPOSIT) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    if (input.reportDeduped) {
      return { skipped: true, skipReason: 'REPORT_DEDUPED' };
    }

    const deposit = await this.resolveDepositContext(input.depositId, tx);
    if (deposit.ownerType !== 'CUSTOMER' || !deposit.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const aggregate: TxAggregateSnapshot = {
      derivedComplianceStatus: 'CLEAR',
      mainKytCase: {
        status: this.normalizeKytLifecycleStatus(input.kytStatus),
      },
      travelRuleCase: {
        status: this.normalizeTravelRuleLifecycleStatus(
          input.travelRuleStatus,
          input.travelRuleRequired,
        ),
        required: input.travelRuleRequired,
      },
    };
    const kytStatus = this.normalizeKytLifecycleStatus(input.kytStatus);
    const travelRuleStatus = this.normalizeTravelRuleLifecycleStatus(
      input.travelRuleStatus,
      input.travelRuleRequired,
    );
    const pending = await this.ensurePendingDecisionRecord(
      {
        contextType: 'TX_DEPOSIT_FINAL',
        subjectType: 'DEPOSIT',
        subjectId: input.depositId,
        ownerType: 'CUSTOMER',
        ownerId: deposit.ownerId,
        signals: this.buildPendingDepositFinalSignals({
          deposit,
          aggregate,
          kytStatus,
          travelRuleStatus,
        }),
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: pending.decisionRecordId,
      decision: pending.status === 'COMPLETED' ? pending.decision : null,
    };
  }

  async simulateDepositFinalReview(
    input: ManualRiskSimulationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    const db = this.getDb(tx) as any;
    const decisionRecord = await db.workflowDecisionRecord.findUnique({
      where: { id: input.decisionRecordId },
      select: {
        id: true,
        status: true,
        contextType: true,
        subjectId: true,
      },
    });

    if (!decisionRecord) {
      throw new NotFoundException(
        `Risk decision record not found: ${input.decisionRecordId}`,
      );
    }
    if (
      String(decisionRecord.contextType || '').trim().toUpperCase() !==
      'TX_DEPOSIT_FINAL'
    ) {
      throw new ConflictException(
        `Decision record ${input.decisionRecordId} is not bound to TX_DEPOSIT_FINAL`,
      );
    }
    if (String(decisionRecord.status || '').trim().toUpperCase() !== 'CREATED') {
      throw new ConflictException(
        `Decision record ${input.decisionRecordId} is not pending simulation`,
      );
    }

    const deposit = await this.resolveDepositContext(decisionRecord.subjectId, tx);
    if (deposit.ownerType !== 'CUSTOMER' || !deposit.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const aggregate: TxAggregateSnapshot = {
      derivedComplianceStatus: 'CLEAR',
      mainKytCase: {
        status: this.normalizeKytLifecycleStatus(deposit.kytStatus),
      },
      travelRuleCase: {
        status: this.normalizeTravelRuleLifecycleStatus(
          deposit.travelRuleStatus,
          !!deposit.travelRuleRequired,
        ),
        required: !!deposit.travelRuleRequired,
      },
    };
    const kytStatus = this.normalizeKytLifecycleStatus(deposit.kytStatus);
    const travelRuleStatus = this.normalizeTravelRuleLifecycleStatus(
      deposit.travelRuleStatus,
      !!deposit.travelRuleRequired,
    );
    const riskProfile: DepositSimulationRiskProfile = {
      riskLevel: input.riskLevel,
      riskReason: input.riskReason,
      signalId: null,
    };
    const decisionResult = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'TX_DEPOSIT_FINAL',
        subjectType: 'DEPOSIT',
        subjectId: deposit.id,
        ownerType: 'CUSTOMER',
        ownerId: deposit.ownerId,
        signals: this.buildDepositFinalSignals({
          deposit,
          aggregate,
          kytStatus,
          travelRuleStatus,
          riskProfile,
        }),
      },
      tx,
    );

    return this.executeDepositFinalReview(
      {
        deposit,
        aggregate,
        kytStatus,
        travelRuleStatus,
        riskProfile,
        triggerStatus: 'MANUAL_SIMULATION',
        decisionResult: {
          decisionRecordId: decisionResult.decisionRecordId,
          decision: decisionResult.decision,
          recommendedActions: decisionResult.recommendedActions,
          reasonCodes: decisionResult.reasonCodes,
          reused: false,
        },
      },
      tx,
    );
  }

  async handleDepositKytUpdate(
    input: DepositKytRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    // Historical provider-result ingestion path only. Current deposit routing
    // should converge on lifecycle snapshots plus TX_DEPOSIT_FINAL.
    if (input.sourceType !== TxSourceType.DEPOSIT) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    if (input.reportDeduped) {
      return { skipped: true, skipReason: 'REPORT_DEDUPED' };
    }

    const status = String(input.status || '').trim().toUpperCase();
    if (!['PASS', 'REVIEW', 'FAIL'].includes(status)) {
      return { skipped: true, skipReason: 'STATUS_NOT_ELIGIBLE' };
    }

    const deposit = await this.resolveDepositContext(input.depositId, tx);
    if (deposit.ownerType !== 'CUSTOMER' || !deposit.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const riskInput: EvaluateRiskInput = {
      contextType: 'TX_DEPOSIT_KYT_MAIN',
      subjectType: 'DEPOSIT',
      subjectId: input.depositId,
      ownerType: 'CUSTOMER',
      ownerId: deposit.ownerId,
      signals: {
        depositId: input.depositId,
        customerId: deposit.ownerId,
        assetId: deposit.assetId,
        derivedComplianceStatus: input.aggregate.derivedComplianceStatus,
        triggerSource: 'KYT',
        triggerStage: input.screeningStage,
        status,
        kytStatus: status,
        provider: input.provider || null,
        providerCaseId: input.providerCaseId || null,
        riskScore: input.riskScore ?? null,
        aggregate: input.aggregate,
      },
    };

    const decisionResult = await this.resolveDecision(riskInput, tx);
    const actionNames = this.normalizeActionNames(
      decisionResult.recommendedActions,
    );

    await this.recordRiskAudit(
      {
        depositId: input.depositId,
        depositNo: deposit.depositNo,
        customerId: deposit.ownerId,
        contextType: riskInput.contextType,
        triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
        triggerStatus: status,
        decisionRecordId: decisionResult.decisionRecordId,
        decision: decisionResult.decision,
        reusedDecisionRecord: decisionResult.reused,
        alertId: null,
        caseId: null,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: null,
      alertNo: null,
      caseId: null,
      caseNo: null,
    };
  }

  async handleDepositTravelRuleUpdate(
    input: DepositTravelRuleRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
    // Historical provider-result ingestion path only. Current deposit routing
    // should converge on lifecycle snapshots plus TX_DEPOSIT_FINAL.
    if (input.sourceType !== TxSourceType.DEPOSIT) {
      return { skipped: true, skipReason: 'UNSUPPORTED_SOURCE_TYPE' };
    }
    if (input.reportDeduped) {
      return { skipped: true, skipReason: 'REPORT_DEDUPED' };
    }

    const status = String(input.status || '').trim().toUpperCase();
    if (!['ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_REQUIRED'].includes(status)) {
      return { skipped: true, skipReason: 'STATUS_NOT_ELIGIBLE' };
    }

    const deposit = await this.resolveDepositContext(input.depositId, tx);
    if (deposit.ownerType !== 'CUSTOMER' || !deposit.ownerId) {
      return { skipped: true, skipReason: 'UNSUPPORTED_OWNER' };
    }

    const riskInput: EvaluateRiskInput = {
      contextType: 'TX_DEPOSIT_TRAVEL_RULE',
      subjectType: 'DEPOSIT',
      subjectId: input.depositId,
      ownerType: 'CUSTOMER',
      ownerId: deposit.ownerId,
      signals: {
        depositId: input.depositId,
        customerId: deposit.ownerId,
        assetId: deposit.assetId,
        derivedComplianceStatus: input.aggregate.derivedComplianceStatus,
        triggerSource: 'TRAVEL_RULE',
        triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
        status,
        travelRuleStatus: status,
        required: input.required,
        provider: input.provider || null,
        providerTransferId: input.providerTransferId || null,
        counterpartyVasp: input.counterpartyVasp || null,
        aggregate: input.aggregate,
      },
    };

    const decisionResult = await this.resolveDecision(riskInput, tx);
    const actionNames = this.normalizeActionNames(
      decisionResult.recommendedActions,
    );

    await this.recordRiskAudit(
      {
        depositId: input.depositId,
        depositNo: deposit.depositNo,
        customerId: deposit.ownerId,
        contextType: riskInput.contextType,
        triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
        triggerStatus: status,
        decisionRecordId: decisionResult.decisionRecordId,
        decision: decisionResult.decision,
        reusedDecisionRecord: decisionResult.reused,
        alertId: null,
        caseId: null,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: null,
      alertNo: null,
      caseId: null,
      caseNo: null,
    };
  }
}
