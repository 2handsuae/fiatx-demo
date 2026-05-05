import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AdminSuspensionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_SUSPENSION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ADMIN_USER;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
