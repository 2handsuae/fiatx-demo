import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import {
  buildCustomerLifecyclePatch as buildCustomerLifecycleStatePatch,
  CustomerOnboardingStatus,
  CustomerOperatingStatus,
  CustomerReviewStage,
  CustomerRestrictionStatus,
  getExpectedReviewStageFromCustomerState,
  resolveCustomerCanonicalState,
} from '../customer-status.util';
import {
  ALERT_DISPOSITION_CODES,
  CASE_DISPOSITION_CODES,
  normalizeWorkflowDecision,
} from '../../risk-engine/constants/compliance-disposition.constant';
import {
  buildComplianceWorkflowTraceContext,
  ComplianceReviewStage,
  ComplianceWorkflow,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_WORKFLOW,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';

export type WorkflowTransitionProducerType = 'ALERT' | 'CASE' | 'DECISION_RECORD';
type LegacyCompatibleOnboardingStatus =
  | CustomerOnboardingStatus
  | 'PENDING_CDD_INPUT'
  | 'CDD_UNDER_REVIEW'
  | 'PENDING_EDD_INPUT'
  | 'EDD_UNDER_REVIEW';

export const WORKFLOW_TRANSITION_CODES = {
  CDD_APPROVE_TO_ACTIVE: 'CDD_APPROVE_TO_ACTIVE',
  CDD_REJECT_TO_REJECTED: 'CDD_REJECT_TO_REJECTED',
  CDD_REQUIRE_EDD_TO_PENDING_EDD: 'CDD_REQUIRE_EDD_TO_PENDING_EDD',
  EDD_APPROVE_TO_FINAL_APPROVAL: 'EDD_APPROVE_TO_FINAL_APPROVAL',
  EDD_REJECT_TO_REJECTED: 'EDD_REJECT_TO_REJECTED',
  PERIODIC_REVIEW_CDD_APPROVE_TO_CLEARED: 'PERIODIC_REVIEW_CDD_APPROVE_TO_CLEARED',
  PERIODIC_REVIEW_CDD_REJECT_TO_REJECTED: 'PERIODIC_REVIEW_CDD_REJECT_TO_REJECTED',
  PERIODIC_REVIEW_CDD_REQUIRE_EDD_TO_PENDING_EDD:
    'PERIODIC_REVIEW_CDD_REQUIRE_EDD_TO_PENDING_EDD',
  PERIODIC_REVIEW_EDD_APPROVE_TO_CLEARED: 'PERIODIC_REVIEW_EDD_APPROVE_TO_CLEARED',
  PERIODIC_REVIEW_EDD_REJECT_TO_REJECTED: 'PERIODIC_REVIEW_EDD_REJECT_TO_REJECTED',
  TX_DEPOSIT_FLAG_TO_UNDER_REVIEW: 'TX_DEPOSIT_FLAG_TO_UNDER_REVIEW',
  TX_DEPOSIT_CLEAR_TO_SUCCESS: 'TX_DEPOSIT_CLEAR_TO_SUCCESS',
  TX_DEPOSIT_FREEZE_TO_FROZEN: 'TX_DEPOSIT_FREEZE_TO_FROZEN',
  TX_DEPOSIT_REJECT_TO_REJECTED: 'TX_DEPOSIT_REJECT_TO_REJECTED',
  TX_DEPOSIT_RELEASE_BLOCKED: 'TX_DEPOSIT_RELEASE_BLOCKED',
  TX_WITHDRAW_FLAG_TO_UNDER_REVIEW: 'TX_WITHDRAW_FLAG_TO_UNDER_REVIEW',
  TX_WITHDRAW_CLEAR_TO_PENDING_COMPLIANCE:
    'TX_WITHDRAW_CLEAR_TO_PENDING_COMPLIANCE',
  TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING:
    'TX_WITHDRAW_CLEAR_TO_PAYOUT_PENDING',
  TX_WITHDRAW_FREEZE_TO_UNDER_REVIEW:
    'TX_WITHDRAW_FREEZE_TO_UNDER_REVIEW',
  TX_WITHDRAW_REJECT_TO_REJECTED: 'TX_WITHDRAW_REJECT_TO_REJECTED',
  TX_WITHDRAW_RELEASE_BLOCKED: 'TX_WITHDRAW_RELEASE_BLOCKED',
  NO_TRANSITION: 'NO_TRANSITION',
} as const;

export type WorkflowTransitionCode =
  (typeof WORKFLOW_TRANSITION_CODES)[keyof typeof WORKFLOW_TRANSITION_CODES];

export interface WorkflowTransitionUpdatedSubject {
  id: string;
  sourceType: 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
  subjectNo: string | null;
  blocked: boolean;
  blockedReason: string | null;
}

export interface WorkflowTransitionInput {
  workflow: ComplianceWorkflow;
  stage: ComplianceReviewStage;
  producerType: WorkflowTransitionProducerType;
  producerId: string;
  customerId: string;
  journeyId?: string;
  sourceId?: string;
  sourceType?: string;
  dispositionCode: string;
  reason?: string | null;
  actorId: string;
  actorRole: string;
  latestDecisionRecordId?: string | null;
  linkedCaseIds?: string[];
}

export interface WorkflowTransitionOutput {
  workflow: ComplianceWorkflow;
  stage: ComplianceReviewStage;
  dispositionCode: string;
  transitionCode: WorkflowTransitionCode;
  fromStatus: string;
  toStatus: string;
  executed: boolean;
  updatedCustomer: any;
  updatedSubject?: WorkflowTransitionUpdatedSubject | null;
  eddResponse?: any | null;
  activeCaseId?: string | null;
  latestFinalApprovalId?: string | null;
  latestFinalApprovalStatus?: string | null;
  createdFinalApprovalId?: string | null;
}

@Injectable()
export class OnboardingWorkflowTransitionService {
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private readonly noTransitionDispositionCodes = new Set<string>([
    ALERT_DISPOSITION_CODES.ESCALATE_TO_CASE,
    ALERT_DISPOSITION_CODES.FALSE_POSITIVE,
    ALERT_DISPOSITION_CODES.RESOLVED_BY_WORKFLOW,
    'RESTRICT',
    'REPORT',
    CASE_DISPOSITION_CODES.FALSE_POSITIVE,
    CASE_DISPOSITION_CODES.RISK_CONFIRMED,
  ]);

  private getCustomerOnboardingStatus(customer: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): LegacyCompatibleOnboardingStatus {
    return resolveCustomerCanonicalState(customer)
      .onboardingStatus as LegacyCompatibleOnboardingStatus;
  }

  private buildCustomerLifecyclePatch(
    customer: {
      onboardingStatus?: string | null;
      operatingStatus?: string | null;
      restrictionStatus?: string | null;
      eddRequired?: boolean | null;
      cddDocumentExpiresAt?: Date | string | null;
    },
    next: {
      onboardingStatus: LegacyCompatibleOnboardingStatus;
      operatingStatus?: CustomerOperatingStatus;
      restrictionStatus?: CustomerRestrictionStatus;
      eddRequired?: boolean;
    },
  ): Prisma.CustomerMainUpdateInput {
    return buildCustomerLifecycleStatePatch(
      customer,
      next as Parameters<typeof buildCustomerLifecycleStatePatch>[1],
    );
  }

  private buildLatestFinalApprovalBindingPatch(
    approvalId?: string | null,
  ): Prisma.CustomerMainUpdateInput {
    if (approvalId) {
      return {
        latestFinalApproval: {
          connect: { id: approvalId },
        },
      };
    }

    return {
      latestFinalApproval: {
        disconnect: true,
      },
    };
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private normalizeDispositionCode(value: unknown): string {
    return String(value || '').trim().toUpperCase();
  }

  private getExpectedReviewStage(customer: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): CustomerReviewStage | null {
    return getExpectedReviewStageFromCustomerState(customer);
  }

  private async createEddResponseIfNeeded(
    tx: Prisma.TransactionClient,
    customerId: string,
    journeyId: string,
    cddResponseId: string,
  ) {
    const existing = await tx.eddResponse.findFirst({
      where: {
        customerId,
        journeyId,
        status: 'CREATED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) return existing;

    return tx.eddResponse.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddResponseId,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId,
        status: 'CREATED',
      },
    });
  }

  private async resolveCddResponse(
    tx: Prisma.TransactionClient,
    customer: any,
    linkedCaseIds: string[],
  ) {
    let cddResponse = null;
    if (linkedCaseIds.length > 0) {
      cddResponse = await tx.cddResponse.findFirst({
        where: {
          id: { in: linkedCaseIds },
          customerId: customer.id,
          workflow: ONBOARDING_WORKFLOW,
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!cddResponse) {
      cddResponse = await tx.cddResponse.findFirst({
        where: {
          customerId: customer.id,
          workflow: ONBOARDING_WORKFLOW,
          journeyId: customer.id,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!cddResponse) {
      throw new BadRequestException(
        'Unable to locate CDD response for onboarding workflow transition.',
      );
    }

    return cddResponse;
  }

  private async resolveEddResponse(
    tx: Prisma.TransactionClient,
    customer: any,
    linkedCaseIds: string[],
  ) {
    let eddResponse = null;
    if (linkedCaseIds.length > 0) {
      eddResponse = await tx.eddResponse.findFirst({
        where: {
          id: { in: linkedCaseIds },
          customerId: customer.id,
          workflow: ONBOARDING_WORKFLOW,
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!eddResponse) {
      eddResponse = await tx.eddResponse.findFirst({
        where: {
          customerId: customer.id,
          workflow: ONBOARDING_WORKFLOW,
          journeyId: customer.id,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!eddResponse) {
      throw new BadRequestException(
        'Unable to locate EDD response for onboarding workflow transition.',
      );
    }

    return eddResponse;
  }

  private buildAuditAction(input: {
    producerType: WorkflowTransitionProducerType;
    dispositionCode: string;
  }): string {
    const prefix =
      input.producerType === 'CASE'
        ? 'CASE'
        : input.producerType === 'DECISION_RECORD'
          ? 'DECISION_RECORD'
          : 'ALERT';
    const workflowDecision = this.getWorkflowDecision(input.dispositionCode);
    switch (workflowDecision) {
      case 'CLEAR':
        return `${prefix}_CLEAR`;
      case 'REJECT':
        return `${prefix}_REJECT`;
      case 'REQUIRE_EDD':
        return `${prefix}_REQUIRE_EDD`;
      default:
        return `${prefix}_${input.dispositionCode}`;
    }
  }

  private getWorkflowDecision(value: unknown): 'CLEAR' | 'REJECT' | 'REQUIRE_EDD' | null {
    const normalized = normalizeWorkflowDecision(value);
    if (normalized === 'CLEAR' || normalized === 'REJECT' || normalized === 'REQUIRE_EDD') {
      return normalized;
    }
    if (String(value || '').trim().toUpperCase() === CASE_DISPOSITION_CODES.CLEAR) {
      return 'CLEAR';
    }
    return null;
  }

  private getWorkflowAuditAction(dispositionCode: string): string {
    const workflowDecision = this.getWorkflowDecision(dispositionCode);
    if (workflowDecision === 'CLEAR') {
      return 'ONBOARDING_WORKFLOW_CLEAR';
    }
    if (workflowDecision === 'REJECT') {
      return 'ONBOARDING_WORKFLOW_REJECT';
    }
    if (workflowDecision === 'REQUIRE_EDD') {
      return 'ONBOARDING_WORKFLOW_REQUIRE_EDD';
    }
    return `ONBOARDING_WORKFLOW_${String(dispositionCode || '').trim().toUpperCase()}`;
  }

  private async recordCanonicalWorkflowAudit(
    tx: Prisma.TransactionClient,
    customer: any,
    input: WorkflowTransitionInput,
    dispositionCode: string,
    fromStatus: string,
    toStatus: string,
    caseType: string | null,
    caseId: string | null,
  ) {
    const traceContext = buildComplianceWorkflowTraceContext({
      workflow: ONBOARDING_WORKFLOW,
      journeyId:
        input.journeyId || customer.id,
    });
    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: this.getWorkflowAuditAction(dispositionCode),
        module: AuditModules.ONBOARDING,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: customer.id,
        entityNo: customer.customerNo || undefined,
        traceId: traceContext?.traceId || undefined,
        workflowType: traceContext?.workflowType || AuditWorkflowTypes.ONBOARDING,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: customer.id,
        entityOwnerNo: customer.customerNo || undefined,
        statusFrom: fromStatus || undefined,
        statusTo: toStatus || undefined,
        reason: String(input.reason || '').trim() || dispositionCode,
        metadata: {
          producerType: input.producerType,
          producerId: input.producerId,
          stage: input.stage,
          caseType,
          caseId,
          dispositionCode,
        },
        sourcePlatform: 'APPLICATION',
      },
      {
        actorType: 'ADMIN',
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
      tx,
    );
  }

  private async writeWorkflowTransitionSnapshot(
    tx: Prisma.TransactionClient,
    input: WorkflowTransitionInput,
    output: WorkflowTransitionOutput,
  ) {
    const decisionRecordId = String(input.latestDecisionRecordId || '').trim();
    if (!decisionRecordId) return;

    const current = await (tx as any).workflowDecisionRecord.findUnique({
      where: { id: decisionRecordId },
      select: { outputs: true },
    });

    if (!current) return;

    let outputs: Record<string, unknown> = {};
    try {
      outputs =
        current.outputs && typeof current.outputs === 'string'
          ? (JSON.parse(current.outputs) as Record<string, unknown>)
          : {};
    } catch {
      outputs = {};
    }

    const nextOutputs = {
      ...outputs,
      workflowTransition: {
        workflow: output.workflow,
        stage: output.stage,
        dispositionCode: output.dispositionCode,
        transitionCode: output.transitionCode,
        fromStatus: output.fromStatus,
        toStatus: output.toStatus,
        executed: output.executed,
        eddResponseId: output.eddResponse?.id || null,
        activeCaseId: output.activeCaseId || null,
      },
    };

    await (tx as any).workflowDecisionRecord.update({
      where: { id: decisionRecordId },
      data: {
        outputs: JSON.stringify(nextOutputs),
      },
    });
  }

  async execute(
    tx: Prisma.TransactionClient,
    input: WorkflowTransitionInput,
  ): Promise<WorkflowTransitionOutput> {
    const workflow = String(input.workflow || '').trim().toUpperCase();
    if (workflow !== ONBOARDING_WORKFLOW) {
      throw new BadRequestException(`Unsupported onboarding workflow: ${workflow || 'UNKNOWN'}`);
    }

    const stage = String(input.stage || '').trim().toUpperCase() as ComplianceReviewStage;
    if (
      stage !== ONBOARDING_REVIEW_STAGES.REVIEW_CDD &&
      stage !== ONBOARDING_REVIEW_STAGES.REVIEW_EDD
    ) {
      throw new BadRequestException(`Unsupported onboarding review stage: ${stage || 'UNKNOWN'}`);
    }

    const customer = await tx.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${input.customerId}`);
    }

    const fromStatus = this.getCustomerOnboardingStatus(customer);
    const expectedStage = this.getExpectedReviewStage(customer);
    if (!expectedStage) {
      throw new BadRequestException(
        `Workflow transition is only allowed in REVIEW_CDD/REVIEW_EDD, current=${fromStatus}`,
      );
    }
    if (expectedStage !== stage) {
      throw new BadRequestException(
        `Workflow transition stage mismatch, expected=${expectedStage}, actual=${stage}`,
      );
    }

    const dispositionCode = this.normalizeDispositionCode(input.dispositionCode);
    const workflowDecision = this.getWorkflowDecision(dispositionCode);
    const linkedCaseIds = Array.from(
      new Set((input.linkedCaseIds || []).map((item) => String(item || '').trim()).filter(Boolean)),
    );

    if (this.noTransitionDispositionCodes.has(dispositionCode)) {
      const noTransition: WorkflowTransitionOutput = {
        workflow: ONBOARDING_WORKFLOW,
        stage,
        dispositionCode,
        transitionCode: WORKFLOW_TRANSITION_CODES.NO_TRANSITION,
        fromStatus,
        toStatus: fromStatus,
        executed: false,
        updatedCustomer: customer,
        eddResponse: null,
        activeCaseId: linkedCaseIds[0] || null,
        latestFinalApprovalId: customer.latestFinalApprovalId || null,
        latestFinalApprovalStatus: customer.latestFinalApprovalStatus || null,
        createdFinalApprovalId: null,
      };
      await this.writeWorkflowTransitionSnapshot(tx, input, noTransition);
      return noTransition;
    }

    const now = new Date();
    let toStatus: LegacyCompatibleOnboardingStatus = fromStatus;
    let transitionCode: WorkflowTransitionCode = WORKFLOW_TRANSITION_CODES.NO_TRANSITION;
    let eddResponse: any | null = null;
    let caseType: 'CDD' | 'EDD' | null = null;
    let caseId: string | null = null;
    let createdFinalApprovalId: string | null = null;
    let customerUpdateData: Prisma.CustomerMainUpdateInput = {
      latestDecisionRecordId: input.latestDecisionRecordId || customer.latestDecisionRecordId || null,
    };

    if (stage === ONBOARDING_REVIEW_STAGES.REVIEW_CDD) {
      const cddResponse = await this.resolveCddResponse(tx, customer, linkedCaseIds);
      caseType = 'CDD';
      caseId = cddResponse.id;

      if (workflowDecision === 'CLEAR') {
        transitionCode = WORKFLOW_TRANSITION_CODES.CDD_APPROVE_TO_ACTIVE;
        toStatus = 'APPROVED';
        customerUpdateData = {
          ...customerUpdateData,
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'APPROVED',
            operatingStatus: 'ACTIVE',
            eddRequired: false,
          }),
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
          cddDocumentExpiresAt: this.addDays(now, 365),
          nextReviewAt: this.addDays(now, 365),
        };
      } else if (workflowDecision === 'REJECT') {
        transitionCode = WORKFLOW_TRANSITION_CODES.CDD_REJECT_TO_REJECTED;
        toStatus = 'REJECTED';
        customerUpdateData = {
          ...customerUpdateData,
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'REJECTED',
            operatingStatus: 'INACTIVE',
            eddRequired: false,
          }),
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
        };
      } else if (workflowDecision === 'REQUIRE_EDD') {
        eddResponse = await this.createEddResponseIfNeeded(
          tx,
          customer.id,
          input.journeyId || customer.id,
          cddResponse.id,
        );
        transitionCode = WORKFLOW_TRANSITION_CODES.CDD_REQUIRE_EDD_TO_PENDING_EDD;
        toStatus = 'PENDING_EDD_INPUT';
        customerUpdateData = {
          ...customerUpdateData,
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'PENDING_EDD_INPUT',
            operatingStatus: 'INACTIVE',
            eddRequired: true,
          }),
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
          cddDocumentExpiresAt: this.addDays(now, 365),
        };
      } else {
        throw new BadRequestException(
          `Disposition ${dispositionCode} cannot transition REVIEW_CDD workflow.`,
        );
      }

      await tx.cddResponse.update({
        where: { id: cddResponse.id },
        data: {
          status: 'FINAL',
          reviewerId: input.actorId,
          reviewerRole: input.actorRole,
          reviewedAt: now,
          reviewerDecision:
            workflowDecision === 'CLEAR'
              ? 'APPROVE'
              : workflowDecision === 'REJECT'
                ? 'REJECT'
                : 'REQUIRE_EDD',
          decisionReason: String(input.reason || '').trim() || dispositionCode,
          requiresEdd: workflowDecision === 'REQUIRE_EDD',
        },
      });
    } else {
      const reviewEddResponse = await this.resolveEddResponse(tx, customer, linkedCaseIds);
      caseType = 'EDD';
      caseId = reviewEddResponse.id;
      eddResponse = reviewEddResponse;

      if (workflowDecision === 'CLEAR') {
        transitionCode = WORKFLOW_TRANSITION_CODES.EDD_APPROVE_TO_FINAL_APPROVAL;
        toStatus = 'FINAL_APPROVAL';
        const pendingFinalApproval =
          await this.onboardingFinalApprovalService.ensurePendingApprovalInTransaction(tx, {
            customer: {
              ...customer,
              onboardingStatus: 'FINAL_APPROVAL',
              operatingStatus: 'INACTIVE',
              eddRequired: true,
            },
            actorId: input.actorId,
            actorRole: input.actorRole,
            reason: String(input.reason || '').trim() || dispositionCode,
          });
        createdFinalApprovalId = pendingFinalApproval.created
          ? pendingFinalApproval.approval.id
          : null;
        customerUpdateData = {
          ...customerUpdateData,
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'FINAL_APPROVAL',
            operatingStatus: 'INACTIVE',
            eddRequired: true,
          }),
          ...this.buildLatestFinalApprovalBindingPatch(
            pendingFinalApproval.approval.id,
          ),
          latestFinalApprovalStatus: pendingFinalApproval.approval.status || 'PENDING',
        };
      } else if (workflowDecision === 'REJECT') {
        transitionCode = WORKFLOW_TRANSITION_CODES.EDD_REJECT_TO_REJECTED;
        toStatus = 'REJECTED';
        customerUpdateData = {
          ...customerUpdateData,
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'REJECTED',
            operatingStatus: 'INACTIVE',
            eddRequired: true,
          }),
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
        };
      } else {
        throw new BadRequestException(
          `Disposition ${dispositionCode} cannot transition REVIEW_EDD workflow.`,
        );
      }

      await tx.eddResponse.update({
        where: { id: reviewEddResponse.id },
        data: {
          status: 'FINAL',
          mlroReviewerId: input.actorId,
          mlroReviewedAt: now,
          mlroDecision:
            workflowDecision === 'CLEAR' ? 'APPROVE' : 'REJECT',
          decisionReason: String(input.reason || '').trim() || dispositionCode,
        },
      });
    }

    const updatedCustomer = await tx.customerMain.update({
      where: { id: customer.id },
      data: customerUpdateData,
    });

    await this.recordCanonicalWorkflowAudit(
      tx,
      customer,
      input,
      dispositionCode,
      fromStatus,
      toStatus,
      caseType,
      caseId,
    );

    const output: WorkflowTransitionOutput = {
      workflow: ONBOARDING_WORKFLOW,
      stage,
      dispositionCode,
      transitionCode,
      fromStatus,
      toStatus,
      executed: true,
      updatedCustomer,
      eddResponse,
      activeCaseId: eddResponse?.id || null,
      latestFinalApprovalId: updatedCustomer.latestFinalApprovalId || null,
      latestFinalApprovalStatus: updatedCustomer.latestFinalApprovalStatus || null,
      createdFinalApprovalId,
    };
    await this.writeWorkflowTransitionSnapshot(tx, input, output);
    return output;
  }
}
