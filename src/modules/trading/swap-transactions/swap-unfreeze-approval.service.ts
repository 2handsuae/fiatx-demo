import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

// 波五 Task 3：逐字镜像 withdraw-unfreeze-approval.service.ts —— 把
// governance.approval.{approved,rejected,cancelled,expired} 过滤到本 actionType，
// 转发成 workflow.swap-unfreeze.decided 给 SwapWorkflowService 消费。
@Injectable()
export class SwapUnfreezeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SWAP_UNFREEZE;
  readonly workflowType = AuditBusinessWorkflowTypes.SWAP_UNFREEZE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
