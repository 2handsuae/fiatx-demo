// 战役乙波二 T5 · 付款单审批（CFO 单步）。裁决后派生 `workflow.vendor-payment.decided`，
// 由 VendorPaymentWorkflowService 接（同 capital-injection-approval.service.ts 17 行模板）。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class VendorPaymentApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.VENDOR_PAYMENT_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.VENDOR_PAYMENT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
