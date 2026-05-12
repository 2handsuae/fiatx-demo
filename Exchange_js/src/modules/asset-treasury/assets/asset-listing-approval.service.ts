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
export class AssetListingApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ASSET_LISTING;
  readonly workflowType = AuditBusinessWorkflowTypes.ASSET_LISTING;
  readonly auditActions = {
    granted: AuditGovernanceActions.ASSET_LISTING.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ASSET_LISTING.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ASSET_LISTING.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ASSET_LISTING.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ASSET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
