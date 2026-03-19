import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  CustomerPublicStatus,
  getLegacyPublicStatusFromCanonical,
  resolveCustomerCanonicalState,
} from '../customer-status.util';
import {
  ALERT_DISPOSITION_CODES,
  CASE_DISPOSITION_CODES,
} from '../../risk-engine/constants/compliance-disposition.constant';
import {
  ComplianceReviewStage,
  ONBOARDING_REVIEW_STAGES,
  PERIODIC_REVIEW_WORKFLOW,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  WorkflowTransitionCode,
  WORKFLOW_TRANSITION_CODES,
  WorkflowTransitionInput,
  WorkflowTransitionOutput,
  WorkflowTransitionProducerType,
} from '../onboarding/onboarding-workflow-transition.service';

@Injectable()
export class PeriodicReviewWorkflowTransitionService {
  private readonly noTransitionDispositionCodes = new Set<string>([
    ALERT_DISPOSITION_CODES.ESCALATE_TO_CASE,
    ALERT_DISPOSITION_CODES.FALSE_POSITIVE,
    ALERT_DISPOSITION_CODES.NO_ACTION,
    CASE_DISPOSITION_CODES.RESTRICT,
    CASE_DISPOSITION_CODES.REPORT,
    CASE_DISPOSITION_CODES.FALSE_POSITIVE,
  ]);

  private getCustomerPublicStatus(customer: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): CustomerPublicStatus {
    return getLegacyPublicStatusFromCanonical(
      resolveCustomerCanonicalState(customer).onboardingStatus,
    );
  }

  private getCompatibilityFinalApprovalStatus(customer: {
    latestFinalApprovalStatus?: string | null;
    onboardingStatus?: string | null;
  }): string | null {
    const latest = String(customer.latestFinalApprovalStatus || '').trim().toUpperCase();
    if (latest === 'APPROVED' || latest === 'REJECTED' || latest === 'PENDING') {
      return latest;
    }
    return String(customer.onboardingStatus || '').trim().toUpperCase() === 'FINAL_APPROVAL'
      ? 'PENDING'
      : null;
  }

  private buildActiveCycleBindingPatch(
    cycleId?: string | null,
  ): Prisma.CustomerMainUpdateInput {
    if (cycleId) {
      return {
        activePeriodicReviewCycle: {
          connect: { id: cycleId },
        },
      };
    }

    return {
      activePeriodicReviewCycle: {
        disconnect: true,
      },
    };
  }

  private buildAuditAction(input: {
    producerType: WorkflowTransitionProducerType;
    dispositionCode: string;
  }): string {
    const prefix = input.producerType === 'CASE' ? 'PERIODIC_CASE' : 'PERIODIC_ALERT';
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

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private normalizeDispositionCode(value: unknown): string {
    return String(value || '').trim().toUpperCase();
  }

  private getExpectedStageFromCycleStatus(
    status?: string | null,
  ): ComplianceReviewStage | null {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized === 'CDD_UNDER_REVIEW') {
      return ONBOARDING_REVIEW_STAGES.REVIEW_CDD;
    }
    if (normalized === 'EDD_UNDER_REVIEW') {
      return ONBOARDING_REVIEW_STAGES.REVIEW_EDD;
    }
    return null;
  }

  private async createEddResponseIfNeeded(
    tx: Prisma.TransactionClient,
    cycle: any,
    customerId: string,
    cddResponseId: string,
  ) {
    const existing = cycle.currentEddResponseId
      ? await tx.eddResponse.findUnique({
          where: { id: cycle.currentEddResponseId },
        })
      : null;

    if (existing && existing.customerId === customerId) {
      return existing;
    }

    return tx.eddResponse.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddResponseId,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId: cycle.cycleNo,
        workflow: PERIODIC_REVIEW_WORKFLOW,
        periodicReviewCycleId: cycle.id,
        status: 'CREATED',
      },
    });
  }

  private async resolveCycle(
    tx: Prisma.TransactionClient,
    input: WorkflowTransitionInput,
    customer: any,
  ) {
    const sourceId = String(input.sourceId || '').trim();

    if (sourceId) {
      const cycle = await (tx as any).periodicReviewCycle.findUnique({
        where: { id: sourceId },
      });
      if (cycle && cycle.customerId === customer.id) {
        return cycle;
      }
    }

    if (customer.activePeriodicReviewCycleId) {
      const cycle = await (tx as any).periodicReviewCycle.findUnique({
        where: { id: customer.activePeriodicReviewCycleId },
      });
      if (cycle && cycle.customerId === customer.id) {
        return cycle;
      }
    }

    const linkedCaseIds = Array.from(
      new Set((input.linkedCaseIds || []).map((item) => String(item || '').trim()).filter(Boolean)),
    );
    if (linkedCaseIds.length > 0) {
      const [cddResponse, eddResponse] = await Promise.all([
        tx.cddResponse.findFirst({
          where: {
            id: { in: linkedCaseIds },
            customerId: customer.id,
            workflow: PERIODIC_REVIEW_WORKFLOW,
            periodicReviewCycleId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        }),
        tx.eddResponse.findFirst({
          where: {
            id: { in: linkedCaseIds },
            customerId: customer.id,
            workflow: PERIODIC_REVIEW_WORKFLOW,
            periodicReviewCycleId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const cycleId =
        cddResponse?.periodicReviewCycleId || eddResponse?.periodicReviewCycleId || null;
      if (cycleId) {
        const cycle = await (tx as any).periodicReviewCycle.findUnique({
          where: { id: cycleId },
        });
        if (cycle && cycle.customerId === customer.id) {
          return cycle;
        }
      }
    }

    throw new BadRequestException(
      'Unable to locate periodic review cycle for workflow transition.',
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
    if (workflow !== PERIODIC_REVIEW_WORKFLOW) {
      throw new BadRequestException(
        `Unsupported periodic review workflow: ${workflow || 'UNKNOWN'}`,
      );
    }

    const stage = String(input.stage || '').trim().toUpperCase() as ComplianceReviewStage;
    if (
      stage !== ONBOARDING_REVIEW_STAGES.REVIEW_CDD &&
      stage !== ONBOARDING_REVIEW_STAGES.REVIEW_EDD
    ) {
      throw new BadRequestException(
        `Unsupported periodic review stage: ${stage || 'UNKNOWN'}`,
      );
    }

    const customer = await tx.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${input.customerId}`);
    }

    const cycle = await this.resolveCycle(tx, input, customer);
    const fromStatus = this.getCustomerPublicStatus(customer);
    const expectedStage = this.getExpectedStageFromCycleStatus(cycle.status);
    if (!expectedStage) {
      throw new BadRequestException(
        `Periodic review transition is not allowed from cycle status ${String(
          cycle.status || '',
        )}`,
      );
    }
    if (expectedStage !== stage) {
      throw new BadRequestException(
        `Periodic review stage mismatch, expected=${expectedStage}, actual=${stage}`,
      );
    }

    const dispositionCode = this.normalizeDispositionCode(input.dispositionCode);
    if (this.noTransitionDispositionCodes.has(dispositionCode)) {
      const noTransition: WorkflowTransitionOutput = {
        workflow: PERIODIC_REVIEW_WORKFLOW,
        stage,
        dispositionCode,
        transitionCode: WORKFLOW_TRANSITION_CODES.NO_TRANSITION,
        fromStatus,
        toStatus: fromStatus,
        executed: false,
        updatedCustomer: customer,
        eddResponse: null,
        activeCaseId: cycle.currentEddResponseId || cycle.currentCddResponseId || null,
        finalApprovalStatus: this.getCompatibilityFinalApprovalStatus(customer),
        latestFinalApprovalId: customer.latestFinalApprovalId || null,
        latestFinalApprovalStatus: customer.latestFinalApprovalStatus || null,
        createdFinalApprovalId: null,
      };
      await this.writeWorkflowTransitionSnapshot(tx, input, noTransition);
      return noTransition;
    }

    const now = new Date();
    let transitionCode: WorkflowTransitionCode = WORKFLOW_TRANSITION_CODES.NO_TRANSITION;
    let toStatus: CustomerPublicStatus = fromStatus;
    let eddResponse: any | null = null;
    let caseType: 'CDD' | 'EDD' | null = null;
    let caseId: string | null = null;

    const customerUpdateData: Prisma.CustomerMainUpdateInput = {
      latestDecisionRecordId: input.latestDecisionRecordId || customer.latestDecisionRecordId || null,
      periodicReviewOverdueAt: null,
      periodicReviewOverdueReason: null,
    };
    const cycleUpdateData: Record<string, unknown> = {
      latestDecisionRecordId:
        input.latestDecisionRecordId || cycle.latestDecisionRecordId || null,
    };

    const clearRestriction =
      String(customer.restrictionStatus || '').trim().toUpperCase() === 'RESTRICTED' &&
      String(customer.restrictionCaseId || '').trim() ===
        String(cycle.primaryIncidentId || '').trim();

    if (stage === ONBOARDING_REVIEW_STAGES.REVIEW_CDD) {
      const cddResponse = cycle.currentCddResponseId
        ? await tx.cddResponse.findUnique({
            where: { id: cycle.currentCddResponseId },
          })
        : null;
      if (!cddResponse || cddResponse.customerId !== customer.id) {
        throw new BadRequestException(
          'Unable to locate periodic review CDD response for workflow transition.',
        );
      }

      caseType = 'CDD';
      caseId = cddResponse.id;

      if (dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE) {
        transitionCode =
          WORKFLOW_TRANSITION_CODES.PERIODIC_REVIEW_CDD_APPROVE_TO_CLEARED;
        cycleUpdateData.status = 'CLEARED';
        cycleUpdateData.clearedAt = now;
        cycleUpdateData.resolutionReason = String(input.reason || '').trim() || null;
        Object.assign(customerUpdateData, this.buildActiveCycleBindingPatch(null), {
          nextReviewAt: this.addDays(now, 365),
        });
        if (clearRestriction) {
          Object.assign(customerUpdateData, {
            restrictionStatus: 'CLEAR',
            restrictionCaseId: null,
            restrictionReleasedAt: now,
          });
        }
      } else if (dispositionCode === ALERT_DISPOSITION_CODES.REJECT_STAGE) {
        transitionCode =
          WORKFLOW_TRANSITION_CODES.PERIODIC_REVIEW_CDD_REJECT_TO_REJECTED;
        cycleUpdateData.status = 'REJECTED';
        cycleUpdateData.rejectedAt = now;
        cycleUpdateData.resolutionReason = String(input.reason || '').trim() || null;
        Object.assign(customerUpdateData, {
          nextReviewAt: null,
        });
      } else if (dispositionCode === ALERT_DISPOSITION_CODES.REQUIRE_EDD) {
        eddResponse = await this.createEddResponseIfNeeded(tx, cycle, customer.id, cddResponse.id);
        transitionCode =
          WORKFLOW_TRANSITION_CODES.PERIODIC_REVIEW_CDD_REQUIRE_EDD_TO_PENDING_EDD;
        cycleUpdateData.status = 'PENDING_EDD_INPUT';
        cycleUpdateData.currentEddResponseId = eddResponse.id;
        cycleUpdateData.resolutionReason = null;
      } else {
        throw new BadRequestException(
          `Disposition ${dispositionCode} cannot transition periodic REVIEW_CDD workflow.`,
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
      const reviewEddResponse = cycle.currentEddResponseId
        ? await tx.eddResponse.findUnique({
            where: { id: cycle.currentEddResponseId },
          })
        : null;
      if (!reviewEddResponse || reviewEddResponse.customerId !== customer.id) {
        throw new BadRequestException(
          'Unable to locate periodic review EDD response for workflow transition.',
        );
      }

      caseType = 'EDD';
      caseId = reviewEddResponse.id;
      eddResponse = reviewEddResponse;

      if (dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE) {
        transitionCode =
          WORKFLOW_TRANSITION_CODES.PERIODIC_REVIEW_EDD_APPROVE_TO_CLEARED;
        cycleUpdateData.status = 'CLEARED';
        cycleUpdateData.clearedAt = now;
        cycleUpdateData.resolutionReason = String(input.reason || '').trim() || null;
        Object.assign(customerUpdateData, this.buildActiveCycleBindingPatch(null), {
          nextReviewAt: this.addDays(now, 365),
        });
        if (clearRestriction) {
          Object.assign(customerUpdateData, {
            restrictionStatus: 'CLEAR',
            restrictionCaseId: null,
            restrictionReleasedAt: now,
          });
        }
      } else if (dispositionCode === ALERT_DISPOSITION_CODES.REJECT_STAGE) {
        transitionCode =
          WORKFLOW_TRANSITION_CODES.PERIODIC_REVIEW_EDD_REJECT_TO_REJECTED;
        cycleUpdateData.status = 'REJECTED';
        cycleUpdateData.rejectedAt = now;
        cycleUpdateData.resolutionReason = String(input.reason || '').trim() || null;
        Object.assign(customerUpdateData, {
          nextReviewAt: null,
        });
      } else {
        throw new BadRequestException(
          `Disposition ${dispositionCode} cannot transition periodic REVIEW_EDD workflow.`,
        );
      }

      await tx.eddResponse.update({
        where: { id: reviewEddResponse.id },
        data: {
          status: 'FINAL',
          mlroReviewerId: input.actorId,
          mlroReviewedAt: now,
          mlroDecision:
            dispositionCode === ALERT_DISPOSITION_CODES.APPROVE_STAGE
              ? 'APPROVE'
              : 'REJECT',
          decisionReason: String(input.reason || '').trim() || dispositionCode,
        },
      });
    }

    const updatedCustomer = await tx.customerMain.update({
      where: { id: customer.id },
      data: customerUpdateData,
    });
    await (tx as any).periodicReviewCycle.update({
      where: { id: cycle.id },
      data: cycleUpdateData,
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
        fromStage: String(cycle.status || '').trim().toUpperCase(),
        toStage: String(cycleUpdateData.status || cycle.status || '').trim().toUpperCase(),
        detail: String(input.reason || '').trim() || null,
      },
    });

    const output: WorkflowTransitionOutput = {
      workflow: PERIODIC_REVIEW_WORKFLOW,
      stage,
      dispositionCode,
      transitionCode,
      fromStatus,
      toStatus,
      executed: true,
      updatedCustomer,
      eddResponse,
      activeCaseId:
        stage === ONBOARDING_REVIEW_STAGES.REVIEW_CDD
          ? String((cycleUpdateData.currentEddResponseId as string | undefined) || '')
              .trim() || null
          : cycle.currentEddResponseId || null,
      finalApprovalStatus: this.getCompatibilityFinalApprovalStatus(updatedCustomer),
      latestFinalApprovalId: updatedCustomer.latestFinalApprovalId || null,
      latestFinalApprovalStatus: updatedCustomer.latestFinalApprovalStatus || null,
      createdFinalApprovalId: null,
    };
    await this.writeWorkflowTransitionSnapshot(tx, input, output);
    return output;
  }
}
