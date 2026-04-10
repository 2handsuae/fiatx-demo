// sumsub-webhook-dispatcher.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';

export interface SumsubWebhookEvent {
  type: string;
  applicantId?: string;
  inspectionId?: string;
  actionId?: string;
  reviewMode?: string;
  reviewResult?: {
    reviewAnswer: 'GREEN' | 'RED';
    rejectLabels?: string[];
    reviewRejectType?: string;
  };
  createdAtMs?: string;
  [key: string]: any;
}

export interface DispatchContext {
  rawBody?: Buffer;
  signature?: string;
  simulated: boolean;
  actorId?: string;
}

@Injectable()
export class SumsubWebhookDispatcher {
  private readonly logger = new Logger(SumsubWebhookDispatcher.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly onboardingService: OnboardingService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  async dispatch(event: SumsubWebhookEvent, context: DispatchContext): Promise<any> {
    // Clue 1: explicit reviewMode tells us this is doc monitoring
    if (event.reviewMode === 'ongoingDocExpired') {
      return this.materialRefreshService.handleSumsubDocMonitoringFire({
        applicantId: event.applicantId || '',
      });
    }

    // Clue 2: matching pending ClientRiskAssessment by inspectionId
    if (event.inspectionId && event.reviewResult) {
      const pending = await this.prisma.clientRiskAssessment.findFirst({
        where: {
          sumsubAmlCheckInspectionId: event.inspectionId,
          status: 'PENDING_SUMSUB_RESULT',
        },
      });
      if (pending) {
        return this.clientRiskAssessmentService.handleSumsubAmlResult(
          event.inspectionId,
          event.reviewResult,
        );
      }
    }

    // Clue 3: matching pending MaterialRefreshCycle by actionId
    if (event.actionId && event.reviewResult) {
      const pending = await this.prisma.materialRefreshCycle.findFirst({
        where: {
          sumsubActionId: event.actionId,
          status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] },
        },
      });
      if (pending) {
        return this.materialRefreshService.handleSumsubActionResult({
          actionId: event.actionId,
          reviewResult: event.reviewResult,
        });
      }
    }

    // Clues 4/5: look up customer by applicantId
    if (!event.applicantId) {
      this.logger.warn('unrouted_webhook_no_applicant_id', { event });
      return;
    }

    const customer = await this.prisma.customerMain.findFirst({
      where: { sumsubApplicantId: event.applicantId },
    });
    if (!customer) {
      this.logger.warn('unrouted_webhook_no_customer', { applicantId: event.applicantId });
      return;
    }

    // Clue 4: customer still in onboarding — delegate to onboarding service
    if (customer.onboardingStatus === 'PENDING_VERIFICATION') {
      return this.onboardingService.handleSumsubVerificationEvent(event as any, context as any);
    }

    // Clue 5: APPROVED + spontaneous AML RED → start new Layer 2 assessment
    if (
      customer.onboardingStatus === 'APPROVED' &&
      event.type === 'applicantReviewed' &&
      event.reviewResult?.reviewAnswer === 'RED'
    ) {
      await this.clientRiskAssessmentService.startAssessment({
        customerId: customer.id,
        triggerType: 'SUMSUB_AML_HIT',
        triggeredContext: {
          spontaneousEvent: event,
          labels: event.reviewResult.rejectLabels || [],
        },
      });
      return;
    }

    this.logger.warn('unrouted_sumsub_webhook', {
      applicantId: event.applicantId,
      type: event.type,
      customerStatus: customer.onboardingStatus,
    });
  }
}
