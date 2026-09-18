import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class CustomerRestrictionReleaseOpsApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS;
  // 与 MLRO handler 共用同一 workflowType：两条审批路线汇入同一个二级事件
  // workflow.customer-restriction-release.decided（见 ApprovalHandlerBase.buildSecondaryEventName）。
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
