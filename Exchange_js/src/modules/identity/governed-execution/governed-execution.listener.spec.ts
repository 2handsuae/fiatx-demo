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
    role: 'TECH_OFFICER',
    roleCodes: ['TECH_OFFICER'],
  },
  binding: bindingOverrides,
});

describe('GovernedExecutionListener', () => {
  let listener: GovernedExecutionListener;
  let businessConfigService: { publishReleaseFromGovernance: jest.Mock };

  beforeEach(() => {
    businessConfigService = {
      publishReleaseFromGovernance: jest.fn().mockResolvedValue(undefined),
    };
    listener = new GovernedExecutionListener(
      businessConfigService as any,
    );
  });

  it('routes BUSINESS_CONFIG_CHANGE intent to businessConfigService', async () => {
    const event = makeEvent({
      intent: 'BUSINESS_CONFIG_CHANGE',
      releaseNo: 'REL-001',
    });

    await listener.handleChangeTicketConsumed(event);

    expect(businessConfigService.publishReleaseFromGovernance).toHaveBeenCalledWith(
      'REL-001',
      event.ticketNo,
    );
  });

  it('does not call any service for unknown intent', async () => {
    const event = makeEvent({ intent: 'FUTURE_WAVE_INTENT', someField: 'value' });

    await listener.handleChangeTicketConsumed(event);

    expect(businessConfigService.publishReleaseFromGovernance).not.toHaveBeenCalled();
  });

  it('does not call any service when intent is absent', async () => {
    const event = makeEvent({});

    await listener.handleChangeTicketConsumed(event);

    expect(businessConfigService.publishReleaseFromGovernance).not.toHaveBeenCalled();
  });
});
