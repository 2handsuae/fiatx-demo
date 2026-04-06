import { GovernedExecutionListener } from './governed-execution.listener';
import {
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';

const makeEvent = (bindingOverrides: Record<string, unknown> = {}): ChangeTicketConsumedEvent => ({
  ticketId: 'ticket-1',
  ticketNo: 'CT2604060001',
  traceId: 'trace-abc',
  actor: {
    actorType: 'ADMIN',
    userId: 'admin-1',
    userNo: 'ADM-001',
    role: 'TECH_ADMIN',
    roleCodes: ['TECH_ADMIN'],
  },
  binding: bindingOverrides,
});

describe('GovernedExecutionListener', () => {
  let listener: GovernedExecutionListener;
  let usersService: { executeAdminMemberProvisioning: jest.Mock };
  let accessControlService: { executeGovernedRoleBindingChange: jest.Mock };

  beforeEach(() => {
    usersService = {
      executeAdminMemberProvisioning: jest.fn().mockResolvedValue({ userNo: 'ADM-NEW' }),
    };
    accessControlService = {
      executeGovernedRoleBindingChange: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    };
    listener = new GovernedExecutionListener(
      usersService as any,
      accessControlService as any,
    );
  });

  it('routes ADMIN_MEMBER_PROVISIONING intent to usersService', async () => {
    const event = makeEvent({
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_ADMIN'],
    });

    await listener.handleChangeTicketConsumed(event);

    expect(usersService.executeAdminMemberProvisioning).toHaveBeenCalledWith(
      event.binding,
      event.actor,
    );
    expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
  });

  it('routes ADMIN_ROLE_BINDING_CHANGE intent to accessControlService', async () => {
    const event = makeEvent({
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: 'user-123',
      roleCodes: ['DPO'],
    });

    await listener.handleChangeTicketConsumed(event);

    expect(accessControlService.executeGovernedRoleBindingChange).toHaveBeenCalledWith(
      event.binding,
      event.actor,
    );
    expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
  });

  it('does not call any service for unknown intent', async () => {
    const event = makeEvent({ intent: 'FUTURE_WAVE_INTENT', someField: 'value' });

    await listener.handleChangeTicketConsumed(event);

    expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
    expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
  });

  it('does not call any service when intent is absent', async () => {
    const event = makeEvent({});

    await listener.handleChangeTicketConsumed(event);

    expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
    expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
  });

  it('propagates errors from usersService to the caller', async () => {
    usersService.executeAdminMemberProvisioning.mockRejectedValue(
      new Error('provisioning failed'),
    );
    const event = makeEvent({
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'fail@fiatx.com',
      roleCodes: ['CISO'],
    });

    await expect(listener.handleChangeTicketConsumed(event)).rejects.toThrow('provisioning failed');
  });

  it('propagates errors from accessControlService to the caller', async () => {
    accessControlService.executeGovernedRoleBindingChange.mockRejectedValue(
      new Error('role binding failed'),
    );
    const event = makeEvent({
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: 'user-1',
      roleCodes: ['DPO'],
    });

    await expect(listener.handleChangeTicketConsumed(event)).rejects.toThrow('role binding failed');
  });
});
