import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** 平账 B 批 ①：补录审批（CFO 单步）。裁决后派生 `workflow.deposit-supplement.decided`，由 InboundTransferSignalsService 接。 */
@Injectable()
export class DepositSupplementApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.DEPOSIT_SUPPLEMENT;
  readonly workflowType = AuditBusinessWorkflowTypes.DEPOSIT_SUPPLEMENT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
