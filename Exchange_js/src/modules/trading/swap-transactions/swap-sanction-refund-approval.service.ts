import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

// 波五 Task 3：逐字镜像 withdraw-sanction-refund-approval.service.ts。
@Injectable()
export class SwapSanctionRefundApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SWAP_SANCTION_REFUND;
  readonly workflowType = AuditBusinessWorkflowTypes.SWAP_SANCTION_REFUND;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
