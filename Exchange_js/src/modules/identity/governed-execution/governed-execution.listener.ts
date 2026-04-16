import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';
import { UsersService } from '../users/users.service';
import { AccessControlService } from '../access-control/access-control.service';
import { BusinessConfigService } from '../../governance/business-config/business-config.service';

@Injectable()
export class GovernedExecutionListener {
  constructor(
    private readonly usersService: UsersService,
    private readonly accessControlService: AccessControlService,
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  @OnEvent(CHANGE_TICKET_CONSUMED)
  async handleChangeTicketConsumed(event: ChangeTicketConsumedEvent): Promise<void> {
    const { binding, actor } = event;

    switch (binding.intent) {
      case 'ADMIN_MEMBER_PROVISIONING':
        await this.usersService.executeAdminMemberProvisioning(binding as any, actor);
        break;
      case 'ADMIN_ROLE_BINDING_CHANGE':
        await this.accessControlService.executeGovernedRoleBindingChange(binding as any, actor);
        break;
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
