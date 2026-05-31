import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class SwapFeeLevelCreationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION;
  readonly workflowType = AuditBusinessWorkflowTypes.SWAP_FEE_LEVEL_CREATION;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
