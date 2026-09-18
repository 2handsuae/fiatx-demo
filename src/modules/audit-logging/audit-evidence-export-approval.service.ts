import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from './constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../governance/approvals/constants/approval.constants';

@Injectable()
export class AuditEvidenceExportApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
