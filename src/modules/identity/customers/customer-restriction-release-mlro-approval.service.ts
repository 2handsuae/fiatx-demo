import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class CustomerRestrictionReleaseMlroApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
