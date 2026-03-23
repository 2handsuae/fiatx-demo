import { BadRequestException } from '@nestjs/common';
import { AccountingEventExecutionService } from './accounting-event-execution.service';

describe('AccountingEventExecutionService', () => {
  const mockPrisma: any = {
    acctEvent: {
      findFirst: jest.fn(),
    },
    journal: {
      findFirst: jest.fn(),
    },
    clearing: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
  };

  const mockJournalsService = {
    executeResolvedEvent: jest.fn(),
  };

  const mockClearingsService = {
    executeResolvedEvent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should execute clearing and journal for approved withdrawal event', async () => {
    mockPrisma.acctEvent.findFirst.mockResolvedValue({
      eventCode: 'EVT_WITHDRAWAL_APPROVED__FIAT',
      postingMode: 'TEMPLATE',
      clearingMode: 'TEMPLATE',
      clearingTemplateCode: 'WITHDRAWAL_STANDARD_V1',
    });
    mockPrisma.journal.findFirst.mockResolvedValue(null);
    mockPrisma.clearing.findFirst.mockResolvedValue(null);
    mockClearingsService.executeResolvedEvent.mockResolvedValue({ id: 'CL_1' });
    mockJournalsService.executeResolvedEvent.mockResolvedValue({ id: 'JO_1' });

    const service = new AccountingEventExecutionService(
      mockPrisma,
      mockJournalsService as any,
      mockClearingsService as any,
    );

    const result = await service.execute({
      entityType: 'WITHDRAW',
      triggerKey: 'status',
      toStatus: 'PAYOUT_PENDING',
      assetType: 'FIAT',
      sourceId: 'WD_1',
      frozenContext: { src: { amount: '100', feeAmount: '2', netAmount: '98' } },
      journalSourceType: 'WITHDRAW',
      clearingSourceType: 'WITHDRAWAL',
    });

    expect(mockClearingsService.executeResolvedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'WITHDRAWAL',
        sourceId: 'WD_1',
      }),
      mockPrisma,
    );
    expect(mockJournalsService.executeResolvedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'WITHDRAW',
        sourceId: 'WD_1',
      }),
      mockPrisma,
    );
    expect(result.eventCode).toBe('EVT_WITHDRAWAL_APPROVED__FIAT');
    expect(result.clearingResult).toEqual({ id: 'CL_1' });
    expect(result.journalResult).toEqual({ id: 'JO_1' });
  });

  it('should block partial execution for dual-sided events', async () => {
    mockPrisma.acctEvent.findFirst.mockResolvedValue({
      eventCode: 'EVT_WITHDRAWAL_APPROVED__CRYPTO',
      postingMode: 'TEMPLATE',
      clearingMode: 'TEMPLATE',
      clearingTemplateCode: 'WITHDRAWAL_STANDARD_V1',
    });
    mockPrisma.journal.findFirst.mockResolvedValue({ id: 'JO_EXISTING' });
    mockPrisma.clearing.findFirst.mockResolvedValue(null);

    const service = new AccountingEventExecutionService(
      mockPrisma,
      mockJournalsService as any,
      mockClearingsService as any,
    );

    await expect(
      service.execute({
        entityType: 'WITHDRAW',
        triggerKey: 'status',
        toStatus: 'PAYOUT_PENDING',
        assetType: 'CRYPTO',
        sourceId: 'WD_2',
        frozenContext: { src: { amount: '1' } },
        journalSourceType: 'WITHDRAW',
        clearingSourceType: 'WITHDRAWAL',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockClearingsService.executeResolvedEvent).not.toHaveBeenCalled();
    expect(mockJournalsService.executeResolvedEvent).not.toHaveBeenCalled();
  });

  it('should return existing dual-sided execution without replaying side effects', async () => {
    mockPrisma.acctEvent.findFirst.mockResolvedValue({
      eventCode: 'EVT_WITHDRAWAL_APPROVED__FIAT',
      postingMode: 'TEMPLATE',
      clearingMode: 'TEMPLATE',
      clearingTemplateCode: 'WITHDRAWAL_STANDARD_V1',
    });
    mockPrisma.journal.findFirst.mockResolvedValue({ id: 'JO_EXISTING' });
    mockPrisma.clearing.findFirst.mockResolvedValue({ id: 'CL_EXISTING' });

    const service = new AccountingEventExecutionService(
      mockPrisma,
      mockJournalsService as any,
      mockClearingsService as any,
    );

    const result = await service.execute({
      entityType: 'WITHDRAW',
      triggerKey: 'status',
      toStatus: 'PAYOUT_PENDING',
      assetType: 'FIAT',
      sourceId: 'WD_3',
      frozenContext: { src: { amount: '100' } },
      journalSourceType: 'WITHDRAW',
      clearingSourceType: 'WITHDRAWAL',
    });

    expect(mockClearingsService.executeResolvedEvent).not.toHaveBeenCalled();
    expect(mockJournalsService.executeResolvedEvent).not.toHaveBeenCalled();
    expect(result.clearingResult).toEqual({ id: 'CL_EXISTING' });
    expect(result.journalResult).toEqual({ id: 'JO_EXISTING' });
  });

  it('should route single-sided withdrawal failure to journal execution only', async () => {
    mockPrisma.acctEvent.findFirst.mockResolvedValue({
      eventCode: 'EVT_WITHDRAWAL_FAILED',
      postingMode: 'BULK_REVERSAL_BY_SOURCE',
      clearingMode: 'NONE',
      clearingTemplateCode: null,
    });
    mockJournalsService.executeResolvedEvent.mockResolvedValue([{ id: 'REV_1' }]);

    const service = new AccountingEventExecutionService(
      mockPrisma,
      mockJournalsService as any,
      mockClearingsService as any,
    );

    const result = await service.execute({
      entityType: 'WITHDRAW',
      triggerKey: 'status',
      toStatus: 'FAILED',
      assetType: 'FIAT',
      sourceId: 'WD_4',
      frozenContext: { src: { amount: '100' } },
      journalSourceType: 'WITHDRAW',
      clearingSourceType: 'WITHDRAWAL',
    });

    expect(mockJournalsService.executeResolvedEvent).toHaveBeenCalled();
    expect(mockClearingsService.executeResolvedEvent).not.toHaveBeenCalled();
    expect(result.journalResult).toEqual([{ id: 'REV_1' }]);
    expect(result.clearingResult).toBeNull();
  });
});
