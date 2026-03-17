import { ForbiddenException } from '@nestjs/common';
import { RiskDecisionRecordsAdminController } from './risk-decision-records-admin.controller';
import { RiskDecisionRecordsService } from './risk-decision-records.service';

describe('RiskDecisionRecordsAdminController', () => {
  const serviceMock = {
    listDecisionRecords: jest.fn(),
    getDecisionRecordDetail: jest.fn(),
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
});

