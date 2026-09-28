// 战役乙波一 T5 · LP 兑换单审批（CFO 单步）。裁决后派生 `workflow.lp-exchange.decided`，
// 由 LpExchangeWorkflowService 接（同 T3 LpProfileApprovalService 17 行模板）。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class LpExchangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.LP_EXCHANGE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.LP_EXCHANGE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
