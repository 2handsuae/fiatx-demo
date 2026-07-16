import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class TransactionLimitChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
