// 甲波六 T6 · 服务商准入审批 handler（两个类同文件，模板照 lp-profile-approval.service.ts / lp-profile-high-risk-approval.service.ts）。
// 两类共用 workflowType OUTSOURCING_VENDOR，故派生同一个事件名 `workflow.outsourcing-vendor.decided`
// （事件名已在 domain-events.constants.ts 登记），由 OutsourcingVendorWorkflowService 的 @OnEvent 一处接；
// 各 handler 只认自己 actionType 的单（ApprovalHandlerBase 里 actionType 不符直接略过），所以 workflow 每个裁决只收一次。
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

/** 一般（NON_MATERIAL）服务商准入审批，CFO 单步：PENDING_APPROVAL → ACTIVE / REJECTED / PENDING_ASSESSMENT（撤单）。 */
@Injectable()
export class OutsourcingVendorApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.VENDOR_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.OUTSOURCING_VENDOR;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}

/** 重大（MATERIAL）服务商准入审批，CFO → 高管两步：PENDING_APPROVAL → PENDING_NOTIFICATION / REJECTED / PENDING_ASSESSMENT（撤单）。 */
@Injectable()
export class OutsourcingVendorMaterialApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.OUTSOURCING_VENDOR;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
