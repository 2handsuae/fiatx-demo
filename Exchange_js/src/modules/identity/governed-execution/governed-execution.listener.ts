import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';
import { BusinessConfigService } from '../../governance/business-config/business-config.service';

@Injectable()
export class GovernedExecutionListener {
  constructor(
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  @OnEvent(CHANGE_TICKET_CONSUMED)
  async handleChangeTicketConsumed(event: ChangeTicketConsumedEvent): Promise<void> {
    const { binding } = event;

    switch (binding.intent) {
      case 'BUSINESS_CONFIG_CHANGE': {
        const releaseNo = String(binding.releaseNo || '');
        if (releaseNo) {
          await this.businessConfigService.publishReleaseFromGovernance(releaseNo, event.ticketNo);
        }
        break;
      }
      default:
        break;
    }
  }
}
