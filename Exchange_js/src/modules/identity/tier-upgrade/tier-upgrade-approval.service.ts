import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';

/** 档位升级核准（高管单步批）。裁决后派生 `workflow.customer-tier-upgrade.decided`，由 TierUpgradeWorkflowService 接。 */
@Injectable()
export class TierUpgradeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_TIER_UPGRADE;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_TIER_UPGRADE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
