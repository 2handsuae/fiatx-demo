import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class CustodianWalletCreateApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTODIAN_WALLET_CREATE;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
