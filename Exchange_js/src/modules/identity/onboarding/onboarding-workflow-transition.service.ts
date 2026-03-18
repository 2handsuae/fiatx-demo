import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  ALERT_DISPOSITION_CODES,
  CASE_DISPOSITION_CODES,
} from '../../risk-engine/constants/compliance-disposition.constant';
import {
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_WORKFLOW,
  OnboardingReviewStage,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';

export type WorkflowTransitionProducerType = 'ALERT' | 'CASE';

export const WORKFLOW_TRANSITION_CODES = {
  CDD_APPROVE_TO_ACTIVE: 'CDD_APPROVE_TO_ACTIVE',
  CDD_REJECT_TO_REJECTED: 'CDD_REJECT_TO_REJECTED',
  CDD_REQUIRE_EDD_TO_PENDING_EDD: 'CDD_REQUIRE_EDD_TO_PENDING_EDD',
  EDD_APPROVE_TO_FINAL_APPROVAL: 'EDD_APPROVE_TO_FINAL_APPROVAL',
  EDD_REJECT_TO_REJECTED: 'EDD_REJECT_TO_REJECTED',
  NO_TRANSITION: 'NO_TRANSITION',
} as const;

export type WorkflowTransitionCode =
  (typeof WORKFLOW_TRANSITION_CODES)[keyof typeof WORKFLOW_TRANSITION_CODES];

export type CustomerPublicStatus =
  | 'NONE'
  | 'PENDING_CDD'
  | 'REVIEW_CDD'
  | 'PENDING_EDD'
  | 'REVIEW_EDD'
  | 'FINAL_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface WorkflowTransitionInput {
  workflow: typeof ONBOARDING_WORKFLOW;
  stage: OnboardingReviewStage;
  producerType: WorkflowTransitionProducerType;
  producerId: string;
  customerId: string;
  journeyId: string;
  dispositionCode: string;
  reason?: string | null;
  actorId: string;
  actorRole: string;
  latestDecisionRecordId?: string | null;
  linkedCaseIds?: string[];
}

export interface WorkflowTransitionOutput {
  workflow: typeof ONBOARDING_WORKFLOW;
  stage: OnboardingReviewStage;
  dispositionCode: string;
  transitionCode: WorkflowTransitionCode;
  fromStatus: CustomerPublicStatus;
  toStatus: CustomerPublicStatus;
  executed: boolean;
  updatedCustomer: any;
  eddCase?: any | null;
  activeCaseId?: string | null;
  finalApprovalStatus?: string | null;
}

@Injectable()
export class OnboardingWorkflowTransitionService {
  private readonly noTransitionDispositionCodes = new Set<string>([
    ALERT_DISPOSITION_CODES.ESCALATE_TO_CASE,
    ALERT_DISPOSITION_CODES.FALSE_POSITIVE,
    ALERT_DISPOSITION_CODES.NO_ACTION,
    CASE_DISPOSITION_CODES.RESTRICT,
    CASE_DISPOSITION_CODES.REPORT,
    CASE_DISPOSITION_CODES.FALSE_POSITIVE,
  ]);

  private normalizePublicStatus(value?: string | null): CustomerPublicStatus {
    const normalized = String(value || 'NONE').trim().toUpperCase();
    const all: CustomerPublicStatus[] = [
      'NONE',
      'PENDING_CDD',
      'REVIEW_CDD',
      'PENDING_EDD',
      'REVIEW_EDD',
      'FINAL_APPROVAL',
      'ACTIVE',
      'REJECTED',
      'WITHDRAWN',
    ];
    if (all.includes(normalized as CustomerPublicStatus)) {
      return normalized as CustomerPublicStatus;
    }
    return 'NONE';
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private normalizeDispositionCode(value: unknown): string {
    return String(value || '').trim().toUpperCase();
  }

  private getExpectedReviewStage(status: CustomerPublicStatus): OnboardingReviewStage | null {
    if (status === ONBOARDING_REVIEW_STAGES.REVIEW_CDD) {
      return ONBOARDING_REVIEW_STAGES.REVIEW_CDD;
    }
    if (status === ONBOARDING_REVIEW_STAGES.REVIEW_EDD) {
      return ONBOARDING_REVIEW_STAGES.REVIEW_EDD;
    }
    return null;
  }

  private async createEddCaseIfNeeded(
    tx: Prisma.TransactionClient,
    customerId: string,
    journeyId: string,
    cddCaseId: string,
  ) {
    const existing = await tx.eddCase.findFirst({
      where: {
        customerId,
        journeyId,
        status: 'CREATED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) return existing;

    return tx.eddCase.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddCaseId,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId,
        status: 'CREATED',
      },
    });
  }

  private async resolveCddCase(
    tx: Prisma.TransactionClient,
    customer: any,
    linkedCaseIds: string[],
  ) {
    let cddCase = customer.currentCddCaseId
      ? await tx.cddCase.findUnique({
          where: { id: customer.currentCddCaseId },
        })
      : null;
    if (cddCase && cddCase.customerId !== customer.id) {
      cddCase = null;
    }
    if (!cddCase && linkedCaseIds.length > 0) {
      cddCase = await tx.cddCase.findFirst({
        where: {
          id: { in: linkedCaseIds },
          customerId: customer.id,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!cddCase) {
      throw new BadRequestException(
        'Unable to locate CDD case for onboarding workflow transition.',
      );
    }

    return cddCase;
  }

  private async resolveEddCase(
    tx: Prisma.TransactionClient,
    customer: any,
    linkedCaseIds: string[],
  ) {
    let eddCase = customer.currentEddCaseId
      ? await tx.eddCase.findUnique({
          where: { id: customer.currentEddCaseId },
        })
      : null;
    if (eddCase && eddCase.customerId !== customer.id) {
      eddCase = null;
    }
    if (!eddCase && linkedCaseIds.length > 0) {
      eddCase = await tx.eddCase.findFirst({
        where: {
          id: { in: linkedCaseIds },
          customerId: customer.id,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!eddCase) {
      throw new BadRequestException(
        'Unable to locate EDD case for onboarding workflow transition.',
      );
    }

    return eddCase;
  }

  private buildAuditAction(input: {
    producerType: WorkflowTransitionProducerType;
    dispositionCode: string;
  }): string {
    const prefix = input.producerType === 'CASE' ? 'CASE' : 'ALERT';
    switch (input.dispositionCode) {
      case ALERT_DISPOSITION_CODES.APPROVE_STAGE:
      case CASE_DISPOSITION_CODES.APPROVE_STAGE:
        return `${prefix}_APPROVE`;
      case ALERT_DISPOSITION_CODES.REJECT_STAGE:
      case CASE_DISPOSITION_CODES.REJECT_STAGE:
        return `${prefix}_REJECT`;
      case ALERT_DISPOSITION_CODES.REQUIRE_EDD:
      case CASE_DISPOSITION_CODES.REQUIRE_EDD:
        return `${prefix}_REQUIRE_EDD`;
      default:
        return `${prefix}_${input.dispositionCode}`;
    }
  }

  private async writeWorkflowTransitionSnapshot(
    tx: Prisma.TransactionClient,
    input: WorkflowTransitionInput,
    output: WorkflowTransitionOutput,
  ) {
    const decisionRecordId = String(input.latestDecisionRecordId || '').trim();
    if (!decisionRecordId) return;

    const current = await (tx as any).onboardingDecisionRecord.findUnique({
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
        eddCaseId: output.eddCase?.id || null,
        activeCaseId: output.activeCaseId || null,
      },
    };

    await (tx as any).onboardingDecisionRecord.update({
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

    const stage = String(input.stage || '').trim().toUpperCase() as OnboardingReviewStage;
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

    const fromStatus = this.normalizePublicStatus(customer.publicStatus);
    const expectedStage = this.getExpectedReviewStage(fromStatus);
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
        eddCase: null,
        activeCaseId: customer.activeCaseId || null,
        finalApprovalStatus: customer.finalApprovalStatus || null,
      };
      await this.writeWorkflowTransitionSnapshot(tx, input, noTransition);
      return noTransition;
    }

    const now = new Date();
    let toStatus: CustomerPublicStatus = fromStatus;
    let transitionCode: WorkflowTransitionCode = WORKFLOW_TRANSITION_CODES.NO_TRANSITION;
    let eddCase: any | null = null;
    let caseType: 'CDD' | 'EDD' | null = null;
    let caseId: string | null = null;
    let customerUpdateData: Prisma.CustomerMainUpdateInput = {
      activeJourneyId: input.journeyId,
      latestDecisionRecordId: input.latestDecisionRecordId || customer.latestDecisionRecordId || null,
    };

    if (stage === ONBOARDING_REVIEW_STAGES.REVIEW_CDD) {
      const cddCase = await this.resolveCddCase(tx, customer, linkedCaseIds);
      caseType = 'CDD';
      caseId = cddCase.id;

      if (dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE) {
        transitionCode = WORKFLOW_TRANSITION_CODES.CDD_APPROVE_TO_ACTIVE;
        toStatus = 'ACTIVE';
        customerUpdateData = {
          ...customerUpdateData,
          publicStatus: 'ACTIVE',
          cddStatus: 'APPROVED',
          eddRequired: false,
          eddStatus: 'NOT_REQUIRED',
          complianceStatus: 'ACTIVE',
          finalApprovalStatus: 'APPROVED',
          finalApprovalReason: String(input.reason || '').trim() || 'ALERT_APPROVE',
          finalApprovalReviewerId: input.actorId,
          finalApprovalReviewedAt: now,
          cddDocumentExpiresAt: this.addDays(now, 365),
          nextReviewAt: this.addDays(now, 365),
          activeCaseType: null,
          activeCaseId: null,
          currentEddCaseId: null,
        };
      } else if (dispositionCode === ALERT_DISPOSITION_CODES.REJECT_STAGE) {
        transitionCode = WORKFLOW_TRANSITION_CODES.CDD_REJECT_TO_REJECTED;
        toStatus = 'REJECTED';
        customerUpdateData = {
          ...customerUpdateData,
          publicStatus: 'REJECTED',
          cddStatus: 'REJECTED',
          eddRequired: false,
          eddStatus: 'NOT_REQUIRED',
          complianceStatus: 'BLOCKED',
          finalApprovalStatus: 'REJECTED',
          finalApprovalReason: String(input.reason || '').trim() || 'ALERT_REJECT',
          finalApprovalReviewerId: input.actorId,
          finalApprovalReviewedAt: now,
          activeCaseType: null,
          activeCaseId: null,
          currentEddCaseId: null,
        };
      } else if (dispositionCode === ALERT_DISPOSITION_CODES.REQUIRE_EDD) {
        eddCase = await this.createEddCaseIfNeeded(tx, customer.id, input.journeyId, cddCase.id);
        transitionCode = WORKFLOW_TRANSITION_CODES.CDD_REQUIRE_EDD_TO_PENDING_EDD;
        toStatus = 'PENDING_EDD';
        customerUpdateData = {
          ...customerUpdateData,
          publicStatus: 'PENDING_EDD',
          cddStatus: 'APPROVED',
          eddRequired: true,
          eddStatus: 'REQUIRED',
          complianceStatus: 'IN_PROGRESS',
          finalApprovalStatus: 'NOT_REQUIRED',
          finalApprovalReason: null,
          finalApprovalReviewerId: null,
          finalApprovalReviewedAt: null,
          cddDocumentExpiresAt: this.addDays(now, 365),
          activeCaseType: 'EDD',
          activeCaseId: eddCase.id,
          currentEddCaseId: eddCase.id,
        };
      } else {
        throw new BadRequestException(
          `Disposition ${dispositionCode} cannot transition REVIEW_CDD workflow.`,
        );
      }

      await tx.cddCase.update({
        where: { id: cddCase.id },
        data: {
          status: 'FINAL',
          reviewerId: input.actorId,
          reviewerRole: input.actorRole,
          reviewedAt: now,
          reviewerDecision:
            dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE
              ? 'APPROVE'
              : dispositionCode === ALERT_DISPOSITION_CODES.REJECT_STAGE
                ? 'REJECT'
                : 'REQUIRE_EDD',
          decisionReason: String(input.reason || '').trim() || dispositionCode,
          requiresEdd: dispositionCode === ALERT_DISPOSITION_CODES.REQUIRE_EDD,
        },
      });
    } else {
      const reviewEddCase = await this.resolveEddCase(tx, customer, linkedCaseIds);
      caseType = 'EDD';
      caseId = reviewEddCase.id;
      eddCase = reviewEddCase;

      if (dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE) {
        transitionCode = WORKFLOW_TRANSITION_CODES.EDD_APPROVE_TO_FINAL_APPROVAL;
        toStatus = 'FINAL_APPROVAL';
        customerUpdateData = {
          ...customerUpdateData,
          publicStatus: 'FINAL_APPROVAL',
          cddStatus: 'APPROVED',
          eddRequired: true,
          eddStatus: 'APPROVED',
          complianceStatus: 'IN_PROGRESS',
          finalApprovalStatus: 'PENDING',
          finalApprovalReason: null,
          finalApprovalReviewerId: null,
          finalApprovalReviewedAt: null,
          activeCaseType: null,
          activeCaseId: null,
        };
      } else if (dispositionCode === ALERT_DISPOSITION_CODES.REJECT_STAGE) {
        transitionCode = WORKFLOW_TRANSITION_CODES.EDD_REJECT_TO_REJECTED;
        toStatus = 'REJECTED';
        customerUpdateData = {
          ...customerUpdateData,
          publicStatus: 'REJECTED',
          cddStatus: 'APPROVED',
          eddRequired: true,
          eddStatus: 'REJECTED',
          complianceStatus: 'BLOCKED',
          finalApprovalStatus: 'REJECTED',
          finalApprovalReason: String(input.reason || '').trim() || 'ALERT_REJECT',
          finalApprovalReviewerId: input.actorId,
          finalApprovalReviewedAt: now,
          activeCaseType: null,
          activeCaseId: null,
        };
      } else {
        throw new BadRequestException(
          `Disposition ${dispositionCode} cannot transition REVIEW_EDD workflow.`,
        );
      }

      await tx.eddCase.update({
        where: { id: reviewEddCase.id },
        data: {
          status: 'FINAL',
          mlroReviewerId: input.actorId,
          mlroReviewedAt: now,
          mlroDecision:
            dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE ? 'APPROVE' : 'REJECT',
          decisionReason: String(input.reason || '').trim() || dispositionCode,
        },
      });
    }

    const updatedCustomer = await tx.customerMain.update({
      where: { id: customer.id },
      data: customerUpdateData,
    });

    await (tx as any).onboardingAuditLog.create({
      data: {
        customerId: customer.id,
        caseType,
        caseId,
        action: this.buildAuditAction({
          producerType: input.producerType,
          dispositionCode,
        }),
        actorId: input.actorId,
        actorRole: input.actorRole,
        fromStage: fromStatus,
        toStage: toStatus,
        detail: String(input.reason || '').trim() || null,
      },
    });

    const output: WorkflowTransitionOutput = {
      workflow: ONBOARDING_WORKFLOW,
      stage,
      dispositionCode,
      transitionCode,
      fromStatus,
      toStatus,
      executed: true,
      updatedCustomer,
      eddCase,
      activeCaseId: updatedCustomer.activeCaseId || null,
      finalApprovalStatus: updatedCustomer.finalApprovalStatus || null,
    };
    await this.writeWorkflowTransitionSnapshot(tx, input, output);
    return output;
  }
}
