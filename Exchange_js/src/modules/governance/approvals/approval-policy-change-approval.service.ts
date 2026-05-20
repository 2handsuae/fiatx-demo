import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from './approval-handler.base';
import { ApprovalActionTypes } from './constants/approval.constants';

@Injectable()
export class ApprovalPolicyChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.APPROVAL_POLICY_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.APPROVAL_POLICY;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
