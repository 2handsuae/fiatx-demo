import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import {
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_WORKFLOW,
  TRANSACTION_WORKFLOW,
  OnboardingReviewStage,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  OnboardingWorkflowTransitionService,
  WorkflowTransitionInput,
  WorkflowTransitionOutput,
} from './onboarding-workflow-transition.service';
import { PeriodicReviewWorkflowTransitionService } from '../periodic-review/periodic-review-workflow-transition.service';
import { TransactionDepositWorkflowService } from '../../trading/deposit-transactions/transaction-deposit-workflow.service';

@Injectable()
export class WorkflowTransitionService {
  constructor(
    private readonly onboardingWorkflowTransitionService: OnboardingWorkflowTransitionService,
    private readonly periodicReviewWorkflowTransitionService: PeriodicReviewWorkflowTransitionService,
    private readonly moduleRef?: ModuleRef,
  ) {}

  private getTransactionWorkflowTransitionService() {
    const service = this.moduleRef?.get(TransactionDepositWorkflowService, {
      strict: false,
    });
    if (!service) {
      throw new BadRequestException('Transaction workflow transition service is unavailable');
    }
    return service;
  }

  private resolveTransactionWorkflowAction(
    dispositionCode: unknown,
  ): 'FLAG' | 'CLEAR' | 'REJECT' | 'FREEZE' {
    const normalized = String(dispositionCode || '').trim().toUpperCase();
    if (
      normalized === 'CLEAR' ||
      normalized === 'APPROVE' ||
      normalized === 'APPROVE_STAGE' ||
      normalized === 'FALSE_POSITIVE'
    ) {
      return 'CLEAR';
    }
    if (
      normalized === 'FREEZE' ||
      normalized === 'FREEZE_TRANSACTION'
    ) {
      return 'FREEZE';
    }
    if (
      normalized === 'REJECT' ||
      normalized === 'REJECT_STAGE' ||
      normalized === 'RISK_CONFIRMED'
    ) {
      return 'REJECT';
    }
    throw new BadRequestException(
      `Unsupported transaction workflow disposition: ${normalized || 'UNKNOWN'}`,
    );
  }

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

    if (workflow === TRANSACTION_WORKFLOW) {
      const depositId = String(input.sourceId || '').trim();
      if (!depositId) {
        throw new BadRequestException('Transaction workflow transition requires sourceId=depositId');
      }
      const service = this.getTransactionWorkflowTransitionService();
      const result = await service.execute(tx, {
        depositId,
        source: input.producerType,
        sourceId: input.producerId,
        workflowAction: this.resolveTransactionWorkflowAction(input.dispositionCode),
        reason: input.reason || null,
        actor: {
          actorType: 'ADMIN',
          actorId: input.actorId,
          actorRole: input.actorRole,
          sourcePlatform: 'ADMIN_API',
        },
      });

      return {
        workflow: TRANSACTION_WORKFLOW,
        stage: input.stage,
        dispositionCode: String(input.dispositionCode || '').trim().toUpperCase(),
        transitionCode: result.transitionCode as any,
        fromStatus: result.depositStatusBefore,
        toStatus: result.depositStatusAfter,
        executed: result.applied,
        updatedCustomer: {
          id: result.depositId,
          depositNo: result.depositNo,
          blocked: result.blocked,
          blockedReason: result.blockedReason,
        },
      };
    }

    throw new BadRequestException(`Unsupported workflow transition: ${workflow || 'UNKNOWN'}`);
  }
}
