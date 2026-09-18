import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** 平账 B 批 ②：退汇认领审批（CFO 单步）。裁决后派生 `workflow.deposit-clawback.decided`，由 DepositWorkflowService 接。 */
@Injectable()
export class DepositClawbackApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.DEPOSIT_CLAWBACK;
  readonly workflowType = AuditBusinessWorkflowTypes.DEPOSIT_CLAWBACK;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
