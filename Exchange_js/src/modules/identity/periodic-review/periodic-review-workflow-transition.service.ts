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
  CustomerOnboardingStatus,
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
  private readonly auditLogsService: AuditLogsService;

  constructor(private readonly prisma: PrismaService) {
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
  }): CustomerOnboardingStatus {
    return resolveCustomerCanonicalState(customer).onboardingStatus;
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
    const prefix =
      input.producerType === 'CASE'
        ? 'PERIODIC_CASE'
        : input.producerType === 'DECISION_RECORD'
          ? 'PERIODIC_DECISION_RECORD'
          : 'PERIODIC_ALERT';
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
      return 'PERIODIC_REVIEW_WORKFLOW_CLEAR';
    }
    if (workflowDecision === 'REJECT') {
      return 'PERIODIC_REVIEW_WORKFLOW_REJECT';
    }
    if (workflowDecision === 'REQUIRE_EDD') {
      return 'PERIODIC_REVIEW_WORKFLOW_REQUIRE_EDD';
    }
    return `PERIODIC_REVIEW_WORKFLOW_${String(dispositionCode || '').trim().toUpperCase()}`;
  }

  private async recordCanonicalWorkflowAudit(
    tx: Prisma.TransactionClient,
    customer: any,
    cycle: any,
    input: WorkflowTransitionInput,
    dispositionCode: string,
    fromStatus: string,
    toStatus: string,
    caseType: string | null,
    caseId: string | null,
  ) {
    const traceContext = buildComplianceWorkflowTraceContext({
      workflow: PERIODIC_REVIEW_WORKFLOW,
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
        workflowType:
          traceContext?.workflowType || AuditWorkflowTypes.PERIODIC_REVIEW,
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
          cycleId: cycle.id,
          cycleNo: cycle.cycleNo,
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
    const fromStatus = this.getCustomerOnboardingStatus(customer);
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
    const workflowDecision = this.getWorkflowDecision(dispositionCode);
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
        latestRiskApprovalId: customer.latestRiskApprovalId || null,
        latestRiskApprovalStatus: customer.latestRiskApprovalStatus || null,
        createdFinalApprovalId: null,
      };
      await this.writeWorkflowTransitionSnapshot(tx, input, noTransition);
      return noTransition;
    }

    const now = new Date();
    let transitionCode: WorkflowTransitionCode = WORKFLOW_TRANSITION_CODES.NO_TRANSITION;
    let toStatus: CustomerOnboardingStatus = fromStatus;
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

      if (workflowDecision === 'CLEAR') {
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
      } else if (workflowDecision === 'REJECT') {
        transitionCode =
          WORKFLOW_TRANSITION_CODES.PERIODIC_REVIEW_CDD_REJECT_TO_REJECTED;
        cycleUpdateData.status = 'REJECTED';
        cycleUpdateData.rejectedAt = now;
        cycleUpdateData.resolutionReason = String(input.reason || '').trim() || null;
        Object.assign(customerUpdateData, {
          nextReviewAt: null,
        });
      } else if (workflowDecision === 'REQUIRE_EDD') {
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

      if (workflowDecision === 'CLEAR') {
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
      } else if (workflowDecision === 'REJECT') {
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
            workflowDecision === 'CLEAR'
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

    await this.recordCanonicalWorkflowAudit(
      tx,
      customer,
      cycle,
      input,
      dispositionCode,
      fromStatus,
      toStatus,
      caseType,
      caseId,
    );

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
      latestRiskApprovalId: updatedCustomer.latestRiskApprovalId || null,
      latestRiskApprovalStatus: updatedCustomer.latestRiskApprovalStatus || null,
      createdFinalApprovalId: null,
    };
    await this.writeWorkflowTransitionSnapshot(tx, input, output);
    return output;
  }
}
