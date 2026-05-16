import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

@Injectable()
export class TransactionLimitCreationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.TRANSACTION_LIMIT_CREATION;
  readonly workflowType = AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION;
  readonly auditActions = {
    granted: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.TRANSACTION_LIMIT_POLICY;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
