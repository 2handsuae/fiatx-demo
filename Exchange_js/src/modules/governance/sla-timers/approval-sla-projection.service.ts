import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ApprovalDecisionEvent,
  ApprovalEvents,
} from '../approvals/constants/approval.constants';
import { SlaTimersService } from './sla-timers.service';

@Injectable()
export class ApprovalSlaProjectionService {
  constructor(private readonly slaTimersService: SlaTimersService) {}

  @OnEvent(ApprovalEvents.SUBMITTED, { async: true })
  async onSubmitted(event: ApprovalDecisionEvent) {
    await this.slaTimersService.ensureApprovalTimeoutTimer(event.approvalId);
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async onApproved(event: ApprovalDecisionEvent) {
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} approved`,
    );
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async onRejected(event: ApprovalDecisionEvent) {
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} rejected`,
    );
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async onCancelled(event: ApprovalDecisionEvent) {
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} cancelled`,
    );
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async onExpired(event: ApprovalDecisionEvent) {
    await this.slaTimersService.closeApprovalTimeoutTimer(
      event.approvalId,
      `Approval ${event.approvalNo} expired`,
    );
  }
}
