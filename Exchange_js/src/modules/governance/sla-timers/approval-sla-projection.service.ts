import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ApprovalDecisionEvent,
  ApprovalActionTypes,
  ApprovalEvents,
} from '../approvals/constants/approval.constants';
import { SlaTimersService } from './sla-timers.service';

@Injectable()
export class ApprovalSlaProjectionService {
  constructor(private readonly slaTimersService: SlaTimersService) {}

  private isWave1GovernedFlow(actionType: string): boolean {
    return (
      actionType === ApprovalActionTypes.CHANGE_TICKET_APPROVAL ||
      actionType === ApprovalActionTypes.DELETE_REQUEST_APPROVAL ||
      actionType === ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL
    );
  }

  @OnEvent(ApprovalEvents.SUBMITTED, { async: true })
  async onSubmitted(event: ApprovalDecisionEvent) {
    if (this.isWave1GovernedFlow(event.actionType)) {
      return;
    }
    await this.slaTimersService.ensureApprovalTimeoutTimer(event.approvalId);
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async onApproved(event: ApprovalDecisionEvent) {
    if (this.isWave1GovernedFlow(event.actionType)) {
      return;
    }
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} approved`,
    );
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async onRejected(event: ApprovalDecisionEvent) {
    if (this.isWave1GovernedFlow(event.actionType)) {
      return;
    }
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} rejected`,
    );
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async onCancelled(event: ApprovalDecisionEvent) {
    if (this.isWave1GovernedFlow(event.actionType)) {
      return;
    }
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} cancelled`,
    );
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async onExpired(event: ApprovalDecisionEvent) {
    if (this.isWave1GovernedFlow(event.actionType)) {
      return;
    }
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} expired`,
    );
  }
}
