import { ForbiddenException } from '@nestjs/common';
import { RiskDecisionRecordsAdminController } from './risk-decision-records-admin.controller';
import { RiskDecisionRecordsService } from './risk-decision-records.service';

describe('RiskDecisionRecordsAdminController', () => {
  const serviceMock = {
    listDecisionRecords: jest.fn(),
    getDecisionRecordDetail: jest.fn(),
    simulateDecisionRecord: jest.fn(),
  };

  let controller: RiskDecisionRecordsAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RiskDecisionRecordsAdminController(
      serviceMock as unknown as RiskDecisionRecordsService,
    );
  });

  it('should reject customer token for list', async () => {
    expect(() =>
      controller.findAll({ user: { type: 'CUSTOMER' } }, {}),
    ).toThrow(ForbiddenException);
  });

  it('should delegate list query for admin token', async () => {
    serviceMock.listDecisionRecords.mockResolvedValue({ total: 0, items: [] });

    const result = await controller.findAll(
      { user: { type: 'ADMIN' } },
      { ownerId: 'c1', status: 'COMPLETED' } as any,
    );

    expect(serviceMock.listDecisionRecords).toHaveBeenCalledWith({
      ownerId: 'c1',
      status: 'COMPLETED',
    });
    expect(result.total).toBe(0);
  });

  it('should delegate detail query for admin token', async () => {
    serviceMock.getDecisionRecordDetail.mockResolvedValue({ id: 'dr-1' });

    const result = await controller.findOne({ user: { type: 'ADMIN' } }, 'dr-1');

    expect(serviceMock.getDecisionRecordDetail).toHaveBeenCalledWith('dr-1');
    expect(result).toEqual({ id: 'dr-1' });
  });

  it('should delegate manual simulation for admin token', async () => {
    serviceMock.simulateDecisionRecord.mockResolvedValue({ id: 'dr-2', status: 'COMPLETED' });

    const result = await controller.simulate(
      { user: { type: 'ADMIN', userId: 'admin-1', userNo: 'ADM-1', role: 'MLRO' } },
      'dr-2',
      { riskLevel: 'HIGH', reasonCode: 'CDD_SANCTIONS_HIT' } as any,
    );

    expect(serviceMock.simulateDecisionRecord).toHaveBeenCalledWith(
      'dr-2',
      { riskLevel: 'HIGH', reasonCode: 'CDD_SANCTIONS_HIT' },
      expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin-1',
        actorNo: 'ADM-1',
        actorRole: 'MLRO',
      }),
    );
    expect(result).toEqual({ id: 'dr-2', status: 'COMPLETED' });
  });
});
