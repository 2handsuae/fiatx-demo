import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';
import { UsersService } from '../users/users.service';
import { AccessControlService } from '../access-control/access-control.service';

@Injectable()
export class GovernedExecutionListener {
  constructor(
    private readonly usersService: UsersService,
    private readonly accessControlService: AccessControlService,
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
      default:
        break;
    }
  }
}
