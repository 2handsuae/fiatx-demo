import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import {
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_WORKFLOW,
  TRANSACTION_DEPOSIT_SOURCE_TYPE,
  TRANSACTION_WITHDRAW_SOURCE_TYPE,
  TRANSACTION_SWAP_SOURCE_TYPE,
  TRANSACTION_WORKFLOW,
  OnboardingReviewStage,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  OnboardingWorkflowTransitionService,
  WorkflowTransitionInput,
  WorkflowTransitionOutput,
} from './onboarding-workflow-transition.service';
import { PeriodicReviewWorkflowTransitionService } from '../periodic-review/periodic-review-workflow-transition.service';
import { DepositWorkflowService } from '../../trading/deposit-transactions/deposit-workflow.service';
import {
  DepositTransactionsService,
  DepositStatusUpdateOptions,
} from '../../trading/deposit-transactions/deposit-transactions.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
} from '../../trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionWorkflowService } from '../../trading/withdraw-transactions/withdraw-transaction-workflow.service';
import { normalizeWorkflowDecision } from '../../risk-engine/constants/compliance-disposition.constant';

@Injectable()
export class WorkflowTransitionService {
  constructor(
    private readonly onboardingWorkflowTransitionService: OnboardingWorkflowTransitionService,
    private readonly periodicReviewWorkflowTransitionService: PeriodicReviewWorkflowTransitionService,
    private readonly moduleRef?: ModuleRef,
  ) {}

  private getDepositWorkflowService() {
    const service = this.moduleRef?.get(DepositWorkflowService, {
      strict: false,
    });
    if (!service) {
      throw new BadRequestException('Deposit workflow service is unavailable');
    }
    return service;
  }

  private getDepositTransactionsService() {
    const service = this.moduleRef?.get(DepositTransactionsService, {
      strict: false,
    });
    if (!service) {
      throw new BadRequestException('Deposit transactions service is unavailable');
    }
    return service;
  }

  private getTransactionWithdrawWorkflowTransitionService() {
    const service = this.moduleRef?.get(WithdrawTransactionWorkflowService, {
      strict: false,
    });
    if (!service) {
      throw new BadRequestException(
        'Withdraw transaction workflow transition service is unavailable',
      );
    }
    return service;
  }

  private resolveTransactionWorkflowAction(
    dispositionCode: unknown,
  ): 'FLAG' | 'CLEAR' | 'REJECT' | 'FREEZE' {
    const normalized = String(dispositionCode || '').trim().toUpperCase();
    const workflowDecision = normalizeWorkflowDecision(normalized);
    if (workflowDecision === 'CLEAR' || normalized === 'FALSE_POSITIVE') {
      return 'CLEAR';
    }
    if (
      normalized === 'FREEZE' ||
      normalized === 'FREEZE_TRANSACTION'
    ) {
      return 'FREEZE';
    }
    if (
      workflowDecision === 'REJECT' ||
      normalized === 'RISK_CONFIRMED'
    ) {
      return 'REJECT';
    }
    throw new BadRequestException(
      `Unsupported transaction workflow disposition: ${normalized || 'UNKNOWN'}`,
    );
  }

  private resolveTransactionProducerType(
    producerType: WorkflowTransitionInput['producerType'],
  ): 'ALERT' | 'CASE' {
    if (producerType === 'ALERT' || producerType === 'CASE') {
      return producerType;
    }
    throw new BadRequestException(
      'Transaction workflow does not support DECISION_RECORD as a producer source',
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
      const sourceId = String(input.sourceId || '').trim();
      if (!sourceId) {
        throw new BadRequestException('Transaction workflow transition requires sourceId');
      }
      const sourceType = String(
        input.sourceType || TRANSACTION_DEPOSIT_SOURCE_TYPE,
      )
        .trim()
        .toUpperCase();
      const transactionProducerType = this.resolveTransactionProducerType(
        input.producerType,
      );
      const workflowAction = this.resolveTransactionWorkflowAction(
        input.dispositionCode,
      );

      if (sourceType === TRANSACTION_SWAP_SOURCE_TYPE) {
        throw new BadRequestException(
          'Swap transactions are synchronous and do not support async compliance transitions',
        );
      }

      if (sourceType === TRANSACTION_WITHDRAW_SOURCE_TYPE) {
        const service = this.getTransactionWithdrawWorkflowTransitionService();
        const result = await service.execute(tx, {
          withdrawId: sourceId,
          source: transactionProducerType,
          sourceId: input.producerId,
          workflowAction,
          reason: input.reason || null,
          actor: {
            actorType: 'ADMIN',
            actorId: input.actorId,
            actorRole: input.actorRole,
            sourcePlatform: 'ADMIN_API',
          },
          decisionRecordId: input.latestDecisionRecordId || null,
          caseId: input.producerType === 'CASE' ? input.producerId : null,
          alertId: input.producerType === 'ALERT' ? input.producerId : null,
          triggerStage: input.stage,
        });

        return {
          workflow: TRANSACTION_WORKFLOW,
          stage: input.stage,
          dispositionCode: String(input.dispositionCode || '').trim().toUpperCase(),
          transitionCode: result.transitionCode as any,
          fromStatus: result.withdrawStatusBefore,
          toStatus: result.withdrawStatusAfter,
          executed: result.applied,
          updatedCustomer: null,
          updatedSubject: {
            id: result.withdrawId,
            sourceType: TRANSACTION_WITHDRAW_SOURCE_TYPE,
            subjectNo: result.withdrawNo,
            blocked: result.blocked,
            blockedReason: result.blockedReason,
          },
        };
      }

      const depositWorkflowSvc = this.getDepositWorkflowService();
      const depositTransactionsSvc = this.getDepositTransactionsService();

      const actorOptions: DepositStatusUpdateOptions = {
        tx,
        actor: {
          actorType: 'ADMIN',
          actorId: input.actorId,
          actorRole: input.actorRole,
        },
        reason: input.reason || undefined,
        sourcePlatform: 'ADMIN_API',
      };

      let depositStatusBefore: string | undefined;
      let depositStatusAfter: string | undefined;
      let depositNo: string | null = null;
      let blocked = false;
      let blockedReason: string | null = null;

      if (workflowAction === 'CLEAR') {
        const before = await depositTransactionsSvc.findOne(sourceId);
        depositStatusBefore = before.status;
        depositNo = before.depositNo;
        await depositWorkflowSvc.approveDeposit(sourceId);
        depositStatusAfter = DepositTransactionStatus.SUCCESS;
        blocked = false;
        blockedReason = null;
      } else if (workflowAction === 'REJECT') {
        const before = await depositTransactionsSvc.findOne(sourceId);
        depositStatusBefore = before.status;
        depositNo = before.depositNo;
        await depositTransactionsSvc.updateStatus(sourceId, {
          action: DepositTransactionAction.REJECT,
          reason: input.reason || undefined,
        }, actorOptions);
        depositStatusAfter = DepositTransactionStatus.REJECTED;
        blocked = true;
        blockedReason = 'RISK_CONFIRMED';
      } else if (workflowAction === 'FREEZE') {
        const before = await depositTransactionsSvc.findOne(sourceId);
        depositStatusBefore = before.status;
        depositNo = before.depositNo;
        await depositTransactionsSvc.updateStatus(sourceId, {
          action: DepositTransactionAction.FREEZE,
          reason: input.reason || undefined,
        }, actorOptions);
        depositStatusAfter = DepositTransactionStatus.FROZEN;
        blocked = true;
        blockedReason = 'FREEZE_TRANSACTION';
      } else {
        // FLAG → ACTION_PENDING
        const before = await depositTransactionsSvc.findOne(sourceId);
        depositStatusBefore = before.status;
        depositNo = before.depositNo;
        await depositTransactionsSvc.updateStatus(sourceId, {
          action: DepositTransactionAction.ACTION_PENDING,
          reason: input.reason || undefined,
        }, actorOptions);
        depositStatusAfter = DepositTransactionStatus.ACTION_PENDING;
        blocked = true;
        blockedReason = 'TX_REVIEW_REQUIRED';
      }

      return {
        workflow: TRANSACTION_WORKFLOW,
        stage: input.stage,
        dispositionCode: String(input.dispositionCode || '').trim().toUpperCase(),
        transitionCode: `TX_DEPOSIT_${workflowAction}_TO_${depositStatusAfter}` as any,
        fromStatus: depositStatusBefore ?? '',
        toStatus: depositStatusAfter,
        executed: true,
        updatedCustomer: null,
        updatedSubject: {
          id: sourceId,
          sourceType: TRANSACTION_DEPOSIT_SOURCE_TYPE,
          subjectNo: depositNo,
          blocked,
          blockedReason,
        },
      };
    }

    throw new BadRequestException(`Unsupported workflow transition: ${workflow || 'UNKNOWN'}`);
  }
}
