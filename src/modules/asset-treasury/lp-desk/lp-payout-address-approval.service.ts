// LP 两步准入 Task 4 · LP 打款地址登记审批（CFO 单步）。照 lp-profile-approval.service.ts 逐行同构：
// workflowType=LP_ADDRESS 派生 `workflow.lp-address.decided` 事件，LpPayoutAddressWorkflowService 用 @OnEvent 接住。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** LP 打款地址登记审批：PENDING_APPROVAL → ACTIVE / REJECTED。 */
@Injectable()
export class LpPayoutAddressApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.LP_ADDRESS_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.LP_ADDRESS;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
