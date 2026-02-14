import { ForbiddenException } from '@nestjs/common';
import { TransactionComplianceAdminController } from './transaction-compliance-admin.controller';
import { TransactionComplianceService } from './transaction-compliance.service';
import {
  KytScreeningStage,
  TxSourceType,
} from './types/tx-compliance.types';

describe('TransactionComplianceAdminController', () => {
  const serviceMock = {
    mockCompleteKytCase: jest.fn(),
    mockCompleteTravelRuleCase: jest.fn(),
    mockBackfill: jest.fn(),
    listKytCases: jest.fn(),
    listTravelRuleCases: jest.fn(),
  };

  let controller: TransactionComplianceAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TransactionComplianceAdminController(
      serviceMock as unknown as TransactionComplianceService,
    );
  });

  it('should reject customer token for mockCompleteKytCase', async () => {
    expect(() =>
      controller.mockCompleteKytCase(
        { user: { type: 'CUSTOMER' } },
        {
          sourceType: TxSourceType.DEPOSIT,
          sourceId: 'dep-1',
          screeningStage: KytScreeningStage.MAIN,
        },
      ),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin token for mockCompleteKytCase', async () => {
    serviceMock.mockCompleteKytCase.mockResolvedValue({ ok: true });

    const result = await controller.mockCompleteKytCase(
      { user: { type: 'ADMIN' } },
      {
        sourceType: TxSourceType.DEPOSIT,
        sourceId: 'dep-1',
        screeningStage: KytScreeningStage.MAIN,
      },
    );

    expect(serviceMock.mockCompleteKytCase).toHaveBeenCalledWith({
      sourceType: TxSourceType.DEPOSIT,
      sourceId: 'dep-1',
      screeningStage: KytScreeningStage.MAIN,
    });
    expect(result).toEqual({ ok: true });
  });

  it('should reject customer token for mock backfill', async () => {
    expect(() =>
      controller.mockBackfill({ user: { type: 'CUSTOMER' } }, {}),
    ).toThrow(ForbiddenException);
  });

  it('should allow admin to list travel rule cases', async () => {
    serviceMock.listTravelRuleCases.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.listTravelRuleCases(
      { user: { type: 'ADMIN' } },
      {
        sourceType: TxSourceType.WITHDRAW,
      },
    );

    expect(serviceMock.listTravelRuleCases).toHaveBeenCalledWith({
      sourceType: TxSourceType.WITHDRAW,
    });
    expect(result.total).toBe(0);
  });
});
