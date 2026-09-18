import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AdminSuspensionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_SUSPENSION;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
