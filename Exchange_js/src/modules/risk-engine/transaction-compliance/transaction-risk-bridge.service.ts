import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceAlertSeverity } from '../compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceIncidentsService } from '../compliance-incidents/compliance-incidents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../audit-logs/dto/audit-log.dto';
import {
  TRANSACTION_REVIEW_RULES,
  TRANSACTION_REVIEW_STAGES,
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
import { TxSourceType } from './types/tx-compliance.types';
import { TransactionDepositWorkflowService } from '../../trading/deposit-transactions/transaction-deposit-workflow.service';

type DbClient = Prisma.TransactionClient | PrismaService;

interface TxAggregateSnapshot {
  derivedComplianceStatus: string;
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
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
    private readonly moduleRef?: ModuleRef,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

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

  private getTransactionWorkflowTransitionService() {
    return (
      this.moduleRef?.get(TransactionDepositWorkflowService, {
        strict: false,
      }) || null
    );
  }

  private getComplianceAlertsService() {
    const service =
      this.moduleRef?.get(ComplianceAlertsService, {
        strict: false,
      }) || null;
    if (!service) {
      throw new NotFoundException(
        'ComplianceAlertsService is unavailable in TransactionRiskBridgeService',
      );
    }
    return service;
  }

  private getComplianceIncidentsService() {
    const service =
      this.moduleRef?.get(ComplianceIncidentsService, {
        strict: false,
      }) || null;
    if (!service) {
      throw new NotFoundException(
        'ComplianceIncidentsService is unavailable in TransactionRiskBridgeService',
      );
    }
    return service;
  }

  private normalizeSeverity(value: unknown): ComplianceAlertSeverity {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === ComplianceAlertSeverity.LOW ||
      normalized === ComplianceAlertSeverity.MEDIUM ||
      normalized === ComplianceAlertSeverity.HIGH ||
      normalized === ComplianceAlertSeverity.CRITICAL
    ) {
      return normalized as ComplianceAlertSeverity;
    }
    return ComplianceAlertSeverity.HIGH;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private mapDecisionToAlertDisposition(decision: RiskDecision): string | null {
    const normalized = String(decision || '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'APPROVE' || normalized === 'REVIEW') {
      return null;
    }
    return normalized;
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

  private normalizeKytStatus(value: unknown): string {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'CLEAR') return 'PASS';
    if (normalized === 'HOLD') return 'REVIEW';
    if (normalized === 'REJECT') return 'FAIL';
    return normalized;
  }

  private normalizeTravelRuleStatus(value: unknown, required?: boolean | null): string {
    const normalized = String(value || '').trim().toUpperCase();
    if (!required && !normalized) return 'NOT_REQUIRED';
    if (!required && normalized === 'PENDING') return 'NOT_REQUIRED';
    return normalized;
  }

  private isDepositFinalReviewReady(aggregate: TxAggregateSnapshot): boolean {
    if (!aggregate.mainKytCase || !aggregate.travelRuleCase) {
      return false;
    }

    const kytStatus = this.normalizeKytStatus(aggregate.mainKytCase?.status);
    const required = aggregate.travelRuleCase?.required ?? false;
    const travelRuleStatus = this.normalizeTravelRuleStatus(
      aggregate.travelRuleCase?.status,
      required,
    );

    return (
      ['PASS', 'REVIEW', 'FAIL'].includes(kytStatus) &&
      ['ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_REQUIRED'].includes(travelRuleStatus)
    );
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

  private async resolveDepositSimulationRiskProfile(
    deposit: {
      payin?: { providerTxnId?: string | null } | null;
      kytStatus?: string | null;
      travelRuleStatus?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<DepositSimulationRiskProfile> {
    const providerTxnId = String(deposit.payin?.providerTxnId || '').trim();
    if (!providerTxnId) {
      return this.deriveFallbackRiskProfile({
        kytStatus: deposit.kytStatus,
        travelRuleStatus: deposit.travelRuleStatus,
      });
    }

    const signal = await (this.getDb(tx) as any).inboundTransferSignal.findUnique({
      where: { id: providerTxnId },
      select: {
        id: true,
        simulationRiskLevel: true,
        simulationRiskReason: true,
      },
    });

    const riskLevel = String(signal?.simulationRiskLevel || '').trim().toUpperCase();
    if (riskLevel === 'MEDIUM' || riskLevel === 'HIGH') {
      return {
        riskLevel,
        riskReason: this.normalizeOptionalString(signal?.simulationRiskReason),
        signalId: signal?.id || null,
      };
    }

    if (riskLevel === 'LOW') {
      return {
        riskLevel: 'LOW',
        riskReason: null,
        signalId: signal?.id || null,
      };
    }

    const fallback = this.deriveFallbackRiskProfile({
      kytStatus: deposit.kytStatus,
      travelRuleStatus: deposit.travelRuleStatus,
    });
    return {
      ...fallback,
      signalId: signal?.id || null,
    };
  }

  private deriveFallbackRiskProfile(input: {
    kytStatus?: string | null;
    travelRuleStatus?: string | null;
  }): DepositSimulationRiskProfile {
    const kytStatus = this.normalizeKytStatus(input.kytStatus);
    const travelRuleStatus = this.normalizeTravelRuleStatus(
      input.travelRuleStatus,
      true,
    );
    if (kytStatus === 'FAIL') {
      return {
        riskLevel: 'HIGH',
        riskReason: 'SANCTIONS_HIT',
        signalId: null,
      };
    }
    if (travelRuleStatus === 'REJECTED' || travelRuleStatus === 'EXPIRED') {
      return {
        riskLevel: 'MEDIUM',
        riskReason: 'TRAVEL_RULE_ISSUE',
        signalId: null,
      };
    }
    if (kytStatus === 'REVIEW') {
      return {
        riskLevel: 'MEDIUM',
        riskReason: 'KYT_ISSUE',
        signalId: null,
      };
    }
    return {
      riskLevel: 'LOW',
      riskReason: null,
      signalId: null,
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
      simulationRiskLevel: input.riskProfile.riskLevel,
      simulationRiskReason: input.riskProfile.riskReason,
      simulationSignalId: input.riskProfile.signalId,
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

    const decisionResult = await this.resolveDecision(riskInput, tx);
    const actionNames = this.normalizeActionNames(
      decisionResult.recommendedActions,
    );

    let alert: { id: string; alertNo?: string | null } | null = null;
    if (
      !decisionResult.reused &&
      actionNames.includes(RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT)
    ) {
      const alertAction = decisionResult.recommendedActions.find(
        (item) =>
          normalizeRiskRecommendedActionType(item.type) ===
          RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
      );
      alert = await this.getComplianceAlertsService().triggerSystemAlert(
        {
          ruleCode: TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED,
          sourceModule: AuditModules.TRANSACTION_COMPLIANCE,
          sourceType: TxSourceType.DEPOSIT,
          sourceId: input.deposit.id,
          sourceNo: input.deposit.depositNo,
          stage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: input.deposit.id,
          entityNo: input.deposit.depositNo,
          ownerType: 'CUSTOMER',
          ownerId: input.deposit.ownerId,
          customerId: input.deposit.ownerId,
          decisionRecommendation:
            String(alertAction?.payload?.recommendation || decisionResult.decision),
          decision: this.mapDecisionToAlertDisposition(decisionResult.decision),
          decisionRecordIds: [decisionResult.decisionRecordId],
          severity: this.normalizeSeverity(alertAction?.payload?.severity),
          message:
            input.riskProfile.riskLevel === 'HIGH'
              ? `Deposit ${input.deposit.depositNo} requires high-risk final transaction review.`
              : `Deposit ${input.deposit.depositNo} requires final transaction compliance review.`,
          metadata: {
            contextType: riskInput.contextType,
            triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
            triggerStatus,
            reasonCodes: decisionResult.reasonCodes,
            recommendedActions: actionNames,
            decisionRecordId: decisionResult.decisionRecordId,
            depositId: input.deposit.id,
            customerId: input.deposit.ownerId,
            riskBand: input.riskProfile.riskLevel,
            riskReason: input.riskProfile.riskReason,
            simulationRiskLevel: input.riskProfile.riskLevel,
            simulationRiskReason: input.riskProfile.riskReason,
            kytStatus: input.kytStatus,
            travelRuleStatus: input.travelRuleStatus,
            kytCaseId: input.aggregate.mainKytCase?.id || null,
            travelRuleCaseId: input.aggregate.travelRuleCase?.id || null,
          },
          sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
        },
        tx,
      );

      await this.recordAlertAudit(
        {
          depositId: input.deposit.id,
          depositNo: input.deposit.depositNo,
          customerId: input.deposit.ownerId as string,
          contextType: riskInput.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
          triggerStatus,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          alertNo: alert.alertNo || null,
        },
        tx,
      );
    }

    let escalatedCase: { id: string; incidentNo?: string | null } | null = null;
    if (
      !decisionResult.reused &&
      alert &&
      actionNames.includes(RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE)
    ) {
      escalatedCase = await this.autoEscalateCaseIfNeeded(
        {
          alertId: alert.id,
          depositId: input.deposit.id,
          depositNo: input.deposit.depositNo,
          customerId: input.deposit.ownerId as string,
          decisionRecordId: decisionResult.decisionRecordId,
          decision: decisionResult.decision,
          recommendedActions: actionNames,
          reason:
            `Auto-escalated final transaction case for deposit ${input.deposit.depositNo}`,
          contextType: riskInput.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
          triggerStatus,
        },
        tx,
      );
    }

    if (!decisionResult.reused && decisionResult.decision === 'APPROVE') {
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
      );
    } else if (!decisionResult.reused && alert && escalatedCase) {
      await this.flagDepositIfNeeded(
        {
          depositId: input.deposit.id,
          depositNo: input.deposit.depositNo,
          customerId: input.deposit.ownerId as string,
          source: 'CASE',
          sourceId: escalatedCase.id,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          caseId: escalatedCase.id,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
          triggerStatus,
          reason: `Deposit ${input.deposit.depositNo} moved under review after final transaction case escalation`,
        },
        tx,
      );
    } else if (!decisionResult.reused && alert) {
      await this.flagDepositIfNeeded(
        {
          depositId: input.deposit.id,
          depositNo: input.deposit.depositNo,
          customerId: input.deposit.ownerId as string,
          source: 'ALERT',
          sourceId: alert.id,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_DEPOSIT_FINAL_REVIEW_REQUIRED,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_DEPOSIT_FINAL,
          triggerStatus,
          reason: `Deposit ${input.deposit.depositNo} moved under review after final transaction alert hit`,
        },
        tx,
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
        alertId: alert?.id || null,
        caseId: escalatedCase?.id || null,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: alert?.id || null,
      alertNo: alert?.alertNo || null,
      caseId: escalatedCase?.id || null,
      caseNo: escalatedCase?.incidentNo || null,
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
        module: AuditModules.TRANSACTION_COMPLIANCE,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: input.depositId,
        entityNo: input.depositNo || undefined,
        traceId: `TRANSACTION:${input.depositId}`,
        workflowType: 'TRANSACTION',
        workflowId: input.depositId,
        workflowNo: input.depositNo || input.depositId,
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

  private async recordAlertAudit(
    input: {
      depositId: string;
      depositNo?: string | null;
      customerId: string;
      contextType: string;
      triggerStage: string;
      triggerStatus: string;
      decisionRecordId: string;
      alertId: string;
      alertNo?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_ALERT_UPSERTED,
        module: AuditModules.TRANSACTION_COMPLIANCE,
        entityType: AuditEntityTypes.COMPLIANCE_ALERT,
        entityId: input.alertId,
        entityNo: input.alertNo || undefined,
        traceId: `TRANSACTION:${input.depositId}`,
        workflowType: 'TRANSACTION',
        workflowId: input.depositId,
        workflowNo: input.depositNo || input.depositId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        reason: `Transaction alert upserted for ${input.triggerStage}`,
        metadata: {
          depositId: input.depositId,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
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
        module: AuditModules.TRANSACTION_COMPLIANCE,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: input.caseId,
        entityNo: input.caseNo || undefined,
        traceId: `TRANSACTION:${input.depositId}`,
        workflowType: 'TRANSACTION',
        workflowId: input.depositId,
        workflowNo: input.depositNo || input.depositId,
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

  private async autoEscalateCaseIfNeeded(
    input: {
      alertId: string;
      depositId: string;
      decisionRecordId: string;
      decision: RiskDecision;
      recommendedActions: string[];
      reason: string;
      contextType: string;
      triggerStage: string;
      triggerStatus: string;
      depositNo?: string | null;
      customerId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx);
    const existingLink = await db.complianceIncidentAlert.findUnique({
      where: { alertId: input.alertId },
      select: {
        incidentId: true,
      },
    });

    if (existingLink?.incidentId) {
      const existingIncident = await db.complianceIncident.findUnique({
        where: { id: existingLink.incidentId },
        select: {
          id: true,
          incidentNo: true,
        },
      });

      if (!existingIncident) {
        throw new NotFoundException(
          `Compliance case ${existingLink.incidentId} not found for alert ${input.alertId}`,
        );
      }

      await this.recordCaseAudit(
        {
          depositId: input.depositId,
          depositNo: input.depositNo,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
          caseId: existingIncident.id,
          caseNo: existingIncident.incidentNo,
          reusedCase: true,
        },
        tx,
      );

      return {
        id: existingIncident.id,
        incidentNo: existingIncident.incidentNo,
      };
    }

    const actor = {
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      actorNo: 'SYSTEM',
      actorRole: 'SYSTEM',
      sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
    };

    try {
      const created = tx
        ? await (async () => {
            const incidentId =
              await this.getComplianceIncidentsService().createFromAlertInTransaction(
                tx,
                input.alertId,
                {
                  reason: input.reason,
                  decision: input.decision,
                  decisionRecordIds: [input.decisionRecordId],
                  recommendedActions: input.recommendedActions,
                },
                actor,
              );

            const incident = await tx.complianceIncident.findUnique({
              where: { id: incidentId },
              select: {
                id: true,
                incidentNo: true,
              },
            });

            if (!incident) {
              throw new NotFoundException(
                `Compliance case ${incidentId} not found after escalation`,
              );
            }

            return incident;
          })()
        : await this.getComplianceIncidentsService().createFromAlert(
            input.alertId,
            {
              reason: input.reason,
              decision: input.decision,
              decisionRecordIds: [input.decisionRecordId],
              recommendedActions: input.recommendedActions,
            },
            actor,
          );

      await this.recordCaseAudit(
        {
          depositId: input.depositId,
          depositNo: input.depositNo,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
          caseId: created.id,
          caseNo: (created as any).incidentNo || null,
          reusedCase: false,
        },
        tx,
      );

      return created;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }

      this.logger.warn(
        `Transaction case auto-escalation raced for alert=${input.alertId}, resolving existing link`,
      );

      const linked = await db.complianceIncidentAlert.findUnique({
        where: { alertId: input.alertId },
        select: {
          incidentId: true,
        },
      });

      if (!linked?.incidentId) {
        throw error;
      }

      const linkedIncident = await db.complianceIncident.findUnique({
        where: { id: linked.incidentId },
        select: {
          id: true,
          incidentNo: true,
        },
      });

      if (!linkedIncident) {
        throw error;
      }

      await this.recordCaseAudit(
        {
          depositId: input.depositId,
          depositNo: input.depositNo,
          customerId: input.customerId,
          contextType: input.contextType,
          triggerStage: input.triggerStage,
          triggerStatus: input.triggerStatus,
          decisionRecordId: input.decisionRecordId,
          alertId: input.alertId,
          caseId: linkedIncident.id,
          caseNo: linkedIncident.incidentNo,
          reusedCase: true,
        },
        tx,
      );

      return linkedIncident;
    }
  }

  private async flagDepositIfNeeded(
    input: {
      depositId: string;
      depositNo?: string | null;
      customerId: string;
      source: 'ALERT' | 'CASE';
      sourceId: string;
      decisionRecordId: string;
      alertId?: string | null;
      caseId?: string | null;
      reasonCode: string;
      triggerStage: string;
      triggerStatus: string;
      reason: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const transitionService = this.getTransactionWorkflowTransitionService();
    if (!transitionService) {
      this.logger.debug(
        `Transaction deposit workflow transition unavailable; skip FLAG for deposit ${input.depositId}`,
      );
      return null;
    }

    return transitionService.execute(tx, {
      depositId: input.depositId,
      source: input.source,
      sourceId: input.sourceId,
      workflowAction: 'FLAG',
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
      alertId: input.alertId || null,
      caseId: input.caseId || null,
      triggerStage: input.triggerStage,
      triggerStatus: input.triggerStatus,
    });
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

    const kytStatus = this.normalizeKytStatus(
      input.aggregate.mainKytCase?.status || deposit.kytStatus,
    );
    const travelRuleStatus = this.normalizeTravelRuleStatus(
      input.aggregate.travelRuleCase?.status || deposit.travelRuleStatus,
      input.aggregate.travelRuleCase?.required ?? deposit.travelRuleRequired,
    );
    const riskProfile = await this.resolveDepositSimulationRiskProfile(deposit, tx);
    return this.executeDepositFinalReview(
      {
        deposit,
        aggregate: input.aggregate,
        kytStatus,
        travelRuleStatus,
        riskProfile,
        triggerStatus: input.triggerStatus,
      },
      tx,
    );
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
        status: this.normalizeKytStatus(input.kytStatus),
      },
      travelRuleCase: {
        status: this.normalizeTravelRuleStatus(
          input.travelRuleStatus,
          input.travelRuleRequired,
        ),
        required: input.travelRuleRequired,
      },
    };
    const riskProfile = await this.resolveDepositSimulationRiskProfile(deposit, tx);

    return this.executeDepositFinalReview(
      {
        deposit,
        aggregate,
        kytStatus: this.normalizeKytStatus(input.kytStatus),
        travelRuleStatus: this.normalizeTravelRuleStatus(
          input.travelRuleStatus,
          input.travelRuleRequired,
        ),
        riskProfile,
        triggerStatus: input.triggerStatus,
      },
      tx,
    );
  }

  async handleDepositKytUpdate(
    input: DepositKytRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
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

    let alert: { id: string; alertNo?: string | null } | null = null;
    if (actionNames.includes(RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT)) {
      const alertAction = decisionResult.recommendedActions.find(
        (item) =>
          normalizeRiskRecommendedActionType(item.type) ===
          RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
      );
      alert = await this.getComplianceAlertsService().triggerSystemAlert(
        {
          ruleCode: TRANSACTION_REVIEW_RULES.TX_KYT_REVIEW_REQUIRED,
          sourceModule: AuditModules.TRANSACTION_COMPLIANCE,
          sourceType: TxSourceType.DEPOSIT,
          sourceId: input.depositId,
          sourceNo: deposit.depositNo,
          stage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
          entityType: AuditEntityTypes.KYT_CASE,
          entityId: input.aggregate.mainKytCase?.id || null,
          entityNo: input.aggregate.mainKytCase?.caseNo || null,
          ownerType: 'CUSTOMER',
          ownerId: deposit.ownerId,
          customerId: deposit.ownerId,
          decisionRecommendation:
            String(alertAction?.payload?.recommendation || decisionResult.decision),
          decision: this.mapDecisionToAlertDisposition(decisionResult.decision),
          decisionRecordIds: [decisionResult.decisionRecordId],
          severity: this.normalizeSeverity(alertAction?.payload?.severity),
          message:
            status === 'FAIL'
              ? `Deposit ${deposit.depositNo} failed KYT review.`
              : `Deposit ${deposit.depositNo} requires KYT review.`,
          metadata: {
            contextType: riskInput.contextType,
            triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
            triggerStatus: status,
            reasonCodes: decisionResult.reasonCodes,
            recommendedActions: actionNames,
            decisionRecordId: decisionResult.decisionRecordId,
            depositId: input.depositId,
            customerId: deposit.ownerId,
          },
          sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
        },
        tx,
      );

      await this.recordAlertAudit(
        {
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          contextType: riskInput.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
          triggerStatus: status,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          alertNo: alert.alertNo || null,
        },
        tx,
      );
    }

    let escalatedCase: { id: string; incidentNo?: string | null } | null = null;
    if (
      alert &&
      actionNames.includes(RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE)
    ) {
      escalatedCase = await this.autoEscalateCaseIfNeeded(
        {
          alertId: alert.id,
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          decisionRecordId: decisionResult.decisionRecordId,
          decision: decisionResult.decision,
          recommendedActions: actionNames,
          reason:
            status === 'FAIL'
              ? `Auto-escalated transaction case for failed deposit KYT (${deposit.depositNo})`
              : `Auto-escalated transaction case for deposit KYT (${deposit.depositNo})`,
          contextType: riskInput.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
          triggerStatus: status,
        },
        tx,
      );
    }

    if (alert && escalatedCase) {
      await this.flagDepositIfNeeded(
        {
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          source: 'CASE',
          sourceId: escalatedCase.id,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          caseId: escalatedCase.id,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_KYT_REVIEW_REQUIRED,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
          triggerStatus: status,
          reason:
            status === 'FAIL'
              ? `Deposit ${deposit.depositNo} moved under review after KYT fail case escalation`
              : `Deposit ${deposit.depositNo} moved under review after KYT case escalation`,
        },
        tx,
      );
    } else if (alert) {
      await this.flagDepositIfNeeded(
        {
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          source: 'ALERT',
          sourceId: alert.id,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_KYT_REVIEW_REQUIRED,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_KYT,
          triggerStatus: status,
          reason: `Deposit ${deposit.depositNo} moved under review after KYT alert hit`,
        },
        tx,
      );
    }

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
        alertId: alert?.id || null,
        caseId: escalatedCase?.id || null,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: alert?.id || null,
      alertNo: alert?.alertNo || null,
      caseId: escalatedCase?.id || null,
      caseNo: escalatedCase?.incidentNo || null,
    };
  }

  async handleDepositTravelRuleUpdate(
    input: DepositTravelRuleRiskInput,
    tx?: Prisma.TransactionClient,
  ): Promise<BridgeExecutionResult> {
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

    let alert: { id: string; alertNo?: string | null } | null = null;
    if (actionNames.includes(RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT)) {
      const alertAction = decisionResult.recommendedActions.find(
        (item) =>
          normalizeRiskRecommendedActionType(item.type) ===
          RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
      );
      alert = await this.getComplianceAlertsService().triggerSystemAlert(
        {
          ruleCode: TRANSACTION_REVIEW_RULES.TX_TRAVEL_RULE_REVIEW_REQUIRED,
          sourceModule: AuditModules.TRANSACTION_COMPLIANCE,
          sourceType: TxSourceType.DEPOSIT,
          sourceId: input.depositId,
          sourceNo: deposit.depositNo,
          stage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
          entityType: AuditEntityTypes.TRAVEL_RULE_CASE,
          entityId: input.aggregate.travelRuleCase?.id || null,
          entityNo: input.aggregate.travelRuleCase?.caseNo || null,
          ownerType: 'CUSTOMER',
          ownerId: deposit.ownerId,
          customerId: deposit.ownerId,
          decisionRecommendation:
            String(alertAction?.payload?.recommendation || decisionResult.decision),
          decision: this.mapDecisionToAlertDisposition(decisionResult.decision),
          decisionRecordIds: [decisionResult.decisionRecordId],
          severity: this.normalizeSeverity(alertAction?.payload?.severity),
          message:
            status === 'REJECTED' || status === 'EXPIRED'
              ? `Deposit ${deposit.depositNo} failed travel rule review.`
              : `Deposit ${deposit.depositNo} requires travel rule review.`,
          metadata: {
            contextType: riskInput.contextType,
            triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
            triggerStatus: status,
            reasonCodes: decisionResult.reasonCodes,
            recommendedActions: actionNames,
            decisionRecordId: decisionResult.decisionRecordId,
            depositId: input.depositId,
            customerId: deposit.ownerId,
          },
          sourcePlatform: tx ? 'SYSTEM_TX' : 'SYSTEM',
        },
        tx,
      );

      await this.recordAlertAudit(
        {
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          contextType: riskInput.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
          triggerStatus: status,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          alertNo: alert.alertNo || null,
        },
        tx,
      );
    }

    let escalatedCase: { id: string; incidentNo?: string | null } | null = null;
    if (
      alert &&
      actionNames.includes(RISK_RECOMMENDED_ACTIONS.AUTO_ESCALATE_CASE)
    ) {
      escalatedCase = await this.autoEscalateCaseIfNeeded(
        {
          alertId: alert.id,
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          decisionRecordId: decisionResult.decisionRecordId,
          decision: decisionResult.decision,
          recommendedActions: actionNames,
          reason: `Auto-escalated transaction case for deposit travel rule (${deposit.depositNo})`,
          contextType: riskInput.contextType,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
          triggerStatus: status,
        },
        tx,
      );
    }

    if (alert && escalatedCase) {
      await this.flagDepositIfNeeded(
        {
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          source: 'CASE',
          sourceId: escalatedCase.id,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          caseId: escalatedCase.id,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_TRAVEL_RULE_REVIEW_REQUIRED,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
          triggerStatus: status,
          reason:
            status === 'REJECTED' || status === 'EXPIRED'
              ? `Deposit ${deposit.depositNo} moved under review after travel rule case escalation`
              : `Deposit ${deposit.depositNo} moved under review after travel rule alert hit`,
        },
        tx,
      );
    } else if (alert) {
      await this.flagDepositIfNeeded(
        {
          depositId: input.depositId,
          depositNo: deposit.depositNo,
          customerId: deposit.ownerId,
          source: 'ALERT',
          sourceId: alert.id,
          decisionRecordId: decisionResult.decisionRecordId,
          alertId: alert.id,
          reasonCode: TRANSACTION_REVIEW_RULES.TX_TRAVEL_RULE_REVIEW_REQUIRED,
          triggerStage: TRANSACTION_REVIEW_STAGES.REVIEW_TRAVEL_RULE,
          triggerStatus: status,
          reason: `Deposit ${deposit.depositNo} moved under review after travel rule alert hit`,
        },
        tx,
      );
    }

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
        alertId: alert?.id || null,
        caseId: escalatedCase?.id || null,
      },
      tx,
    );

    return {
      skipped: false,
      decisionRecordId: decisionResult.decisionRecordId,
      decision: decisionResult.decision,
      alertId: alert?.id || null,
      alertNo: alert?.alertNo || null,
      caseId: escalatedCase?.id || null,
      caseNo: escalatedCase?.incidentNo || null,
    };
  }
}
