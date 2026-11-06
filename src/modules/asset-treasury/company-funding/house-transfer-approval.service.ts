// 戊波二 T5 · 公司调拨单审批（CFO 单步，48h 可撤）。裁决后派生 `workflow.house-transfer.decided`，
// 由 HouseTransferWorkflowService 接（同 vendor-payment-approval.service.ts 模板）。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class HouseTransferApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.HOUSE_TRANSFER_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.HOUSE_TRANSFER;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
