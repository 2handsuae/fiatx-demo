import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ComplianceAlertsAdminController } from './compliance-alerts-admin.controller';
import { ComplianceAlertsService } from './compliance-alerts.service';
import { ComplianceAlertAction } from './constants/compliance-alert-rules.constant';

describe('ComplianceAlertsAdminController', () => {
  const serviceMock = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    applyAction: jest.fn(),
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

  it('should surface bad request when removed action is submitted', async () => {
    serviceMock.applyAction.mockRejectedValue(
      new BadRequestException('Unsupported action'),
    );

    await expect(
      controller.applyAction(
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
          action: 'REOPEN' as any,
        },
      ),
    ).rejects.toThrow('Unsupported action');
  });
});
