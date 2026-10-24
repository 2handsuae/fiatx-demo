// 战役乙波一 T3 · LP 档案建档审批链（CFO 单步），派生 `workflow.lp-profile.decided` 事件，
// LpProfileWorkflowService 用 @OnEvent 接住（照 internal-transfer-approval.service.ts 17 行模板）。
// （LP 两步准入 Task 9：结算坐标变更那条审批链已退役，本文件只剩建档一个 handler。）
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** LP 档案建档审批：PENDING_APPROVAL → ACTIVE / REJECTED。 */
@Injectable()
export class LpProfileApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.LP_PROFILE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.LP_PROFILE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
