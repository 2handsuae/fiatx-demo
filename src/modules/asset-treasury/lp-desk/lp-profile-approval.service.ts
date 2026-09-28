// 战役乙波一 T3 · LP 档案两条审批链（CFO 单步）。两个 handler 共享同一 workflowType=
// LP_PROFILE，故派生的是同一个 `workflow.lp-profile.decided` 事件——LpProfileWorkflowService
// 用单一 @OnEvent 接住，按 event.actionType 分岔（照 internal-transfer-approval.service.ts
// 17 行模板）。
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

/** LP 档案结算坐标变更审批：批准落新坐标，驳回 / 超时坐标不动。 */
@Injectable()
export class LpProfileChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.LP_PROFILE_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.LP_PROFILE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
