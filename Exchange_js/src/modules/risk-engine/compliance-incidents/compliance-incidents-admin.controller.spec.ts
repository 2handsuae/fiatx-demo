import { ForbiddenException } from '@nestjs/common';
import { ComplianceIncidentsAdminController } from './compliance-incidents-admin.controller';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import { ComplianceIncidentAction } from './constants/compliance-incident-rules.constant';

describe('ComplianceIncidentsAdminController', () => {
  const serviceMock = {
    findAll: jest.fn(),
    createFromAlert: jest.fn(),
    findOne: jest.fn(),
    applyAction: jest.fn(),
    linkAlert: jest.fn(),
  };

  let controller: ComplianceIncidentsAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ComplianceIncidentsAdminController(
      serviceMock as unknown as ComplianceIncidentsService,
    );
  });

  it('should reject customer token for findAll', async () => {
    expect(() =>
      controller.findAll({ user: { type: 'CUSTOMER' } }, {} as any),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin to create incident from alert', async () => {
    serviceMock.createFromAlert.mockResolvedValue({ id: 'inc-1' });

    const result = await controller.createFromAlert(
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
        reason: 'Escalate for investigation',
      },
    );

    expect(serviceMock.createFromAlert).toHaveBeenCalledWith(
      'alert-1',
      {
        reason: 'Escalate for investigation',
      },
      expect.objectContaining({
        actorId: 'admin-1',
        actorNo: 'US0001',
      }),
    );
    expect(result).toEqual({ id: 'inc-1' });
  });

  it('should default assignee to actor on ASSIGN', async () => {
    serviceMock.applyAction.mockResolvedValue({ id: 'inc-1' });

    await controller.applyAction(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'inc-1',
      {
        action: ComplianceIncidentAction.ASSIGN,
      },
    );

    expect(serviceMock.applyAction).toHaveBeenCalledWith(
      'inc-1',
      {
        action: ComplianceIncidentAction.ASSIGN,
        assigneeUserId: 'admin-1',
      },
      expect.objectContaining({
        actorId: 'admin-1',
      }),
    );
  });

  it('should reject customer token for createFromAlert', async () => {
    expect(() =>
      controller.createFromAlert(
        { user: { type: 'CUSTOMER' } },
        'alert-1',
        { reason: 'r' },
      ),
    ).toThrow(ForbiddenException);
  });

  it('should call linkAlert service for admin', async () => {
    serviceMock.linkAlert.mockResolvedValue({ id: 'inc-1' });

    const result = await controller.linkAlert(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'inc-1',
      {
        alertId: 'alert-2',
        note: 'same customer',
      },
    );

    expect(serviceMock.linkAlert).toHaveBeenCalledWith(
      'inc-1',
      { alertId: 'alert-2', note: 'same customer' },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
    expect(result).toEqual({ id: 'inc-1' });
  });
});
