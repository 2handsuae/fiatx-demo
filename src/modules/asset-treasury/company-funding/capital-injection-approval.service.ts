// 战役乙波二 T3 · 注资单审批（CFO 单步）。裁决后派生 `workflow.capital-injection.decided`，
// 由 CapitalInjectionWorkflowService 接（同 lp-exchange-approval.service.ts 17 行模板）。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class CapitalInjectionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CAPITAL_INJECTION_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.CAPITAL_INJECTION;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
