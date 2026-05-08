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
export class RoleDefinitionCreateApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ROLE_DEFINITION_CREATE;
  readonly workflowType = AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE;
  readonly auditActions = {
    granted: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ACCESS_CONTROL;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
