import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AdminRoleBindingChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
