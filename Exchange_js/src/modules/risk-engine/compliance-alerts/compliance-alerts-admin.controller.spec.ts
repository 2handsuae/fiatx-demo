import { ForbiddenException } from '@nestjs/common';
import { ComplianceAlertsAdminController } from './compliance-alerts-admin.controller';
import { ComplianceAlertsService } from './compliance-alerts.service';
import { ComplianceAlertAction } from './constants/compliance-alert-rules.constant';

describe('ComplianceAlertsAdminController', () => {
  const serviceMock = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    applyAction: jest.fn(),
    resolveAlert: jest.fn(),
    simulateRandomAlerts: jest.fn(),
  };

  let controller: ComplianceAlertsAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ComplianceAlertsAdminController(
      serviceMock as unknown as ComplianceAlertsService,
    );
  });

  it('should reject customer token for findAll', async () => {
    expect(() =>
      controller.findAll({ user: { type: 'CUSTOMER' } }, {}),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin to query alerts', async () => {
    serviceMock.findAll.mockResolvedValue({ total: 0, items: [] });

    const result = await controller.findAll(
      { user: { type: 'ADMIN' } },
      { status: 'NEW' } as any,
    );

    expect(serviceMock.findAll).toHaveBeenCalledWith({ status: 'NEW' });
    expect(result.total).toBe(0);
  });

  it('should allow admin to load alert detail', async () => {
    serviceMock.findOne.mockResolvedValue({ id: 'alert-1' });

    const result = await controller.findOne(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'COMPLIANCE_LEAD',
        },
      },
      'alert-1',
    );

    expect(serviceMock.findOne).toHaveBeenCalledWith(
      'alert-1',
      expect.objectContaining({
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      }),
    );
    expect(result).toEqual({ id: 'alert-1' });
  });

  it('should default assignee to actor on ASSIGN action', async () => {
    serviceMock.applyAction.mockResolvedValue({ id: 'alert-1' });

    const result = await controller.applyAction(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'alert-1',
      {
        action: ComplianceAlertAction.ASSIGN,
      },
    );

    expect(serviceMock.applyAction).toHaveBeenCalledWith(
      'alert-1',
      {
        action: ComplianceAlertAction.ASSIGN,
        assigneeUserId: 'admin-1',
      },
      expect.objectContaining({
        actorId: 'admin-1',
        actorNo: 'US0001',
      }),
    );
    expect(result).toEqual({ id: 'alert-1' });
  });

  it('should reject customer token for simulate', async () => {
    expect(() =>
      controller.simulate({ user: { type: 'CUSTOMER' } }),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin token for simulate', async () => {
    serviceMock.simulateRandomAlerts.mockResolvedValue({
      createdCount: 10,
      items: [],
    });

    const result = await controller.simulate({ user: { type: 'ADMIN' } });

    expect(serviceMock.simulateRandomAlerts).toHaveBeenCalledWith(10);
    expect(result.createdCount).toBe(10);
  });

  it('should forward resolve requests with admin actor context', async () => {
    serviceMock.resolveAlert.mockResolvedValue({ id: 'alert-1', status: 'CLOSED' });

    const result = await controller.resolve(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'COMPLIANCE_LEAD',
        },
      },
      'alert-1',
      {
        resolutionType: 'FALSE_POSITIVE' as any,
      },
    );

    expect(serviceMock.resolveAlert).toHaveBeenCalledWith(
      'alert-1',
      { resolutionType: 'FALSE_POSITIVE' },
      expect.objectContaining({
        actorId: 'admin-1',
        actorNo: 'US0001',
        actorRole: 'COMPLIANCE_LEAD',
      }),
    );
    expect(result).toEqual({ id: 'alert-1', status: 'CLOSED' });
  });
});
