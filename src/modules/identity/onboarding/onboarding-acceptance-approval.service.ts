import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';

/** 高风险客户准入核准（高管单步批）。裁决后派生 `workflow.customer-onboarding-acceptance.decided`，由 OnboardingWorkflowService 接。 */
@Injectable()
export class OnboardingAcceptanceApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_ONBOARDING_ACCEPTANCE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
