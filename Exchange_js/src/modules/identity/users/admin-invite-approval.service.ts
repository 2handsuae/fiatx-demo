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
export class AdminInviteApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_INVITE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_INVITE;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ACCESS_CONTROL;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
