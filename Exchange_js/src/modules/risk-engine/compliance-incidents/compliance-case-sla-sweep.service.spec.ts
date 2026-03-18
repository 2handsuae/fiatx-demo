import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceCaseSlaSweepService } from './compliance-case-sla-sweep.service';
import { ComplianceIncidentsService } from './compliance-incidents.service';

describe('ComplianceCaseSlaSweepService', () => {
  const alertsServiceMock: any = {
    markOverdueAlerts: jest.fn(),
  };
  const casesServiceMock: any = {
    markOverdueCases: jest.fn(),
  };

  let service: ComplianceCaseSlaSweepService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceCaseSlaSweepService(
      alertsServiceMock as unknown as ComplianceAlertsService,
      casesServiceMock as unknown as ComplianceIncidentsService,
    );
  });

  it('should sweep overdue alerts and cases in one pass', async () => {
    alertsServiceMock.markOverdueAlerts.mockResolvedValue({ markedCount: 2 });
    casesServiceMock.markOverdueCases.mockResolvedValue({ markedCount: 1 });

    await service.runOnce();

    expect(alertsServiceMock.markOverdueAlerts).toHaveBeenCalledTimes(1);
    expect(casesServiceMock.markOverdueCases).toHaveBeenCalledTimes(1);
  });

  it('should reset running flag after sweep failure so next run can continue', async () => {
    alertsServiceMock.markOverdueAlerts.mockRejectedValueOnce(new Error('boom'));
    alertsServiceMock.markOverdueAlerts.mockResolvedValueOnce({ markedCount: 0 });
    casesServiceMock.markOverdueCases.mockResolvedValue({ markedCount: 0 });

    await service.runOnce();
    await service.runOnce();

    expect(alertsServiceMock.markOverdueAlerts).toHaveBeenCalledTimes(2);
    expect(casesServiceMock.markOverdueCases).toHaveBeenCalledTimes(2);
  });
});
