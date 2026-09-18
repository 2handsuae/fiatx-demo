import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** 平账二期：内部划转单审批（CFO 单步）。裁决后派生 `workflow.internal-transfer.decided`，由 InternalTransferWorkflowService 接。 */
@Injectable()
export class InternalTransferApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.INTERNAL_TRANSFER;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
