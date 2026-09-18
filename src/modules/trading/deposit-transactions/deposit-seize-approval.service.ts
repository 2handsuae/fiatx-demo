import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class DepositSeizeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.DEPOSIT_SEIZE;
  readonly workflowType = AuditBusinessWorkflowTypes.DEPOSIT_SEIZE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
