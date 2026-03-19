import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_WORKFLOW,
  OnboardingReviewStage,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  OnboardingWorkflowTransitionService,
  WorkflowTransitionInput,
  WorkflowTransitionOutput,
} from './onboarding-workflow-transition.service';
import { PeriodicReviewWorkflowTransitionService } from '../periodic-review/periodic-review-workflow-transition.service';

@Injectable()
export class WorkflowTransitionService {
  constructor(
    private readonly onboardingWorkflowTransitionService: OnboardingWorkflowTransitionService,
    private readonly periodicReviewWorkflowTransitionService: PeriodicReviewWorkflowTransitionService,
  ) {}

  async transition(
    tx: Prisma.TransactionClient,
    input: WorkflowTransitionInput,
  ): Promise<WorkflowTransitionOutput> {
    const workflow = String(input.workflow || '').trim().toUpperCase();
    if (workflow === ONBOARDING_WORKFLOW) {
      return this.onboardingWorkflowTransitionService.execute(tx, {
        ...input,
        workflow: ONBOARDING_WORKFLOW,
        stage: String(input.stage || '').trim().toUpperCase() as OnboardingReviewStage,
      });
    }

    if (workflow === PERIODIC_REVIEW_WORKFLOW) {
      return this.periodicReviewWorkflowTransitionService.execute(tx, {
        ...input,
        workflow: PERIODIC_REVIEW_WORKFLOW,
      });
    }

    throw new BadRequestException(`Unsupported workflow transition: ${workflow || 'UNKNOWN'}`);
  }
}
