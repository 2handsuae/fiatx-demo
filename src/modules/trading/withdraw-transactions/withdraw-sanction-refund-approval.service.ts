import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class WithdrawSanctionRefundApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.WITHDRAW_SANCTION_REFUND;
  readonly workflowType = AuditBusinessWorkflowTypes.WITHDRAW_SANCTION_REFUND;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
