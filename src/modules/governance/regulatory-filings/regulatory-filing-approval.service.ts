// 战役甲波二 · 报送台骨架（Task 4）：签发审批 handler，模板逐字照抄
// incident-approval.service.ts 的类形状。合规官提、高管（SENIOR_MANAGEMENT_OFFICER）
// 单步批（spec §4，DEFAULT_APPROVAL_POLICIES 已注册），裁决后统一派生
// `workflow.regulatory-filing.decided`（ApprovalHandlerBase.buildSecondaryEventName），
// 由 RegulatoryFilingWorkflowService 一处接。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

@Injectable()
export class RegFilingSubmitApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.REG_FILING_SUBMIT;
  readonly workflowType = AuditBusinessWorkflowTypes.REGULATORY_FILING;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
