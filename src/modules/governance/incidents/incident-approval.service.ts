// 平账三期 · 事故登记（Task 7）：结案审批 handler，模板逐处照抄
// internal-transfer-approval.service.ts。两条动作类型（安全类两步 MLRO→CFO / 资金类单步
// CFO，Task 3 已登记）共用同一 workflowType，裁决后统一派生
// `workflow.incident.decided`（ApprovalHandlerBase.buildSecondaryEventName），由
// IncidentCloseWorkflowService 一处接（复刻 CustomerRestrictionRelease 的 MLRO/OPS
// 双 handler 汇入同一 workflowType 的先例）。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

@Injectable()
export class IncidentCloseSecurityApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.INCIDENT_CLOSE_SECURITY;
  readonly workflowType = AuditBusinessWorkflowTypes.INCIDENT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}

@Injectable()
export class IncidentCloseFinancialApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.INCIDENT_CLOSE_FINANCIAL;
  readonly workflowType = AuditBusinessWorkflowTypes.INCIDENT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
