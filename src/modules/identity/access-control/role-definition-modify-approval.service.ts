import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';

@Injectable()
export class RoleDefinitionModifyApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ROLE_DEFINITION_MODIFY;
  readonly workflowType = AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
