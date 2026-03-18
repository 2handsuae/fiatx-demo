import { ForbiddenException } from '@nestjs/common';
import { ComplianceCasesAdminController } from './compliance-cases-admin.controller';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import { ComplianceIncidentAction } from './constants/compliance-incident-rules.constant';

describe('ComplianceCasesAdminController', () => {
  const serviceMock = {
    findAll: jest.fn(),
    createFromAlert: jest.fn(),
    findOne: jest.fn(),
    getReport: jest.fn(),
    saveReportDraft: jest.fn(),
    finalizeReport: jest.fn(),
    applyAction: jest.fn(),
    linkAlert: jest.fn(),
  };

  let controller: ComplianceCasesAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ComplianceCasesAdminController(
      serviceMock as unknown as ComplianceIncidentsService,
    );
  });

  it('should reject customer token for findAll', () => {
    expect(() =>
      controller.findAll({ user: { type: 'CUSTOMER' } }, {} as any),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin to create case from alert', async () => {
    serviceMock.createFromAlert.mockResolvedValue({ id: 'case-1' });

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
      { reason: 'Escalate for investigation' },
    );

    expect(serviceMock.createFromAlert).toHaveBeenCalledWith(
      'alert-1',
      { reason: 'Escalate for investigation' },
      expect.objectContaining({
        actorId: 'admin-1',
        actorNo: 'US0001',
      }),
    );
    expect(result).toEqual({ id: 'case-1' });
  });

  it('should default assignee to actor on ASSIGN', async () => {
    serviceMock.applyAction.mockResolvedValue({ id: 'case-1' });

    await controller.applyAction(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'case-1',
      {
        action: ComplianceIncidentAction.ASSIGN,
      },
    );

    expect(serviceMock.applyAction).toHaveBeenCalledWith(
      'case-1',
      {
        action: ComplianceIncidentAction.ASSIGN,
        assigneeUserId: 'admin-1',
      },
      expect.objectContaining({
        actorId: 'admin-1',
      }),
    );
  });

  it('should call linkAlert service for admin', async () => {
    serviceMock.linkAlert.mockResolvedValue({ id: 'case-1' });

    const result = await controller.linkAlert(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'case-1',
      {
        alertId: 'alert-2',
        note: 'same customer',
      },
    );

    expect(serviceMock.linkAlert).toHaveBeenCalledWith(
      'case-1',
      { alertId: 'alert-2', note: 'same customer' },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
    expect(result).toEqual({ id: 'case-1' });
  });

  it('should call getReport service for admin', async () => {
    serviceMock.getReport.mockResolvedValue({ currentReport: { id: 'report-1' } });

    const result = await controller.getReport(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'case-1',
    );

    expect(serviceMock.getReport).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({ actorId: 'admin-1' }),
    );
    expect(result).toEqual({ currentReport: { id: 'report-1' } });
  });

  it('should call saveReportDraft service for admin', async () => {
    serviceMock.saveReportDraft.mockResolvedValue({ currentReport: { id: 'report-1' } });

    const result = await controller.saveReportDraft(
      {
        user: {
          type: 'ADMIN',
          userId: 'admin-1',
          userNo: 'US0001',
          role: 'ADMIN',
        },
      },
      'case-1',
      {
        factsSummary: 'facts',
      },
    );

    expect(serviceMock.saveReportDraft).toHaveBeenCalledWith(
      'case-1',
      { factsSummary: 'facts' },
      expect.objectContaining({ actorId: 'admin-1' }),
    );
    expect(result).toEqual({ currentReport: { id: 'report-1' } });
  });
});
