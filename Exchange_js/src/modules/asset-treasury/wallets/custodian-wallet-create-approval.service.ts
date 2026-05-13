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
export class CustodianWalletCreateApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTODIAN_WALLET_CREATE;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE;
  readonly auditActions = {
    granted: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.WALLET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
