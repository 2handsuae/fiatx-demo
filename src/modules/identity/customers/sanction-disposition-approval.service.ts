// 战役甲波三 T4：制裁定性审批 handler，模板逐字照抄
// customer-restriction-release-mlro-approval.service.ts / regulatory-filing-approval.service.ts
// 的类形状。合规官提、MLRO 单步批（spec §4，DEFAULT_APPROVAL_POLICIES 已注册），裁决后统一
// 派生 `workflow.sanction-disposition.decided`（ApprovalHandlerBase.buildSecondaryEventName，
// 事件名先登记 domain-events.constants.ts），由 SanctionDispositionWorkflowService 一处接。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class SanctionDispositionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SANCTION_DISPOSITION;
  readonly workflowType = AuditBusinessWorkflowTypes.SANCTION_DISPOSITION;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
