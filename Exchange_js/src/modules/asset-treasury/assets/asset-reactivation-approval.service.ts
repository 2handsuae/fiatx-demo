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
export class AssetReactivationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ASSET_REACTIVATION;
  readonly workflowType = AuditBusinessWorkflowTypes.ASSET_REACTIVATION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ASSET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
