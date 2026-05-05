import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from './constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../governance/approvals/constants/approval.constants';

@Injectable()
export class AuditEvidenceExportApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT;
  readonly auditActions = {
    granted: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
