import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** 平账 B 批 ③：退回认领审批（CFO 单步）。裁决后派生 `workflow.withdraw-return-claim.decided`，由 WithdrawWorkflowService 接。 */
@Injectable()
export class WithdrawReturnClaimApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.WITHDRAW_RETURN_CLAIM;
  readonly workflowType = AuditBusinessWorkflowTypes.WITHDRAW_RETURN_CLAIM;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
