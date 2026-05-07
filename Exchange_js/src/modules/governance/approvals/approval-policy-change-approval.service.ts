import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from './approval-handler.base';
import { ApprovalActionTypes } from './constants/approval.constants';

@Injectable()
export class ApprovalPolicyChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.APPROVAL_POLICY_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.APPROVAL_POLICY;
  readonly auditActions = {
    granted: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.APPROVAL_POLICY;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
