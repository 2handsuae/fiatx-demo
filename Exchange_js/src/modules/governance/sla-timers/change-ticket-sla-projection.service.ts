import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ChangeTicketDeployEvent,
  ChangeTicketEvents,
} from '../change-tickets/constants/change-ticket.constants';
import { SlaTimersService } from './sla-timers.service';

@Injectable()
export class ChangeTicketSlaProjectionService {
  constructor(private readonly slaTimersService: SlaTimersService) {}

  @OnEvent(ChangeTicketEvents.DEPLOY_MARKED, { async: true })
  async onDeployMarked(event: ChangeTicketDeployEvent) {
    await this.slaTimersService.ensureChangePostApprovalFollowUpTimer(event.ticketId);
  }
}
