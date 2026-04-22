import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SwapTransactionStatus } from './dto/swap-transaction.dto';
import { SwapTransactionWorkflowService } from './swap-transaction-workflow.service';

describe('SwapTransactionWorkflowService', () => {
  const prismaMock: any = {
    $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    swapTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    outstanding: {
      deleteMany: jest.fn(),
    },
  };

  const journalsServiceMock: any = {
    triggerEvent: jest.fn(),
  };

  const outstandingsServiceMock: any = {
    createForSwapSuccess: jest.fn(),
  };

  let service: SwapTransactionWorkflowService;
  let recordSystemSpy: jest.SpiedFunction<typeof AuditLogsService.prototype.recordSystem>;

  const buildSwap = (status: string) => ({
    id: 'swap-1',
    swapNo: 'SWP_0001',
    quoteId: 'quote-1',
    quoteNo: 'QUO_0001',
    ownerType: 'CUSTOMER',
    ownerId: 'customer-1',
    ownerNo: 'CU_0001',
    status,
    fromAssetId: 'asset-btc',
    fromAssetCode: 'BTC',
    fromAmount: new Prisma.Decimal('1'),
    toAssetId: 'asset-usdt',
    toAssetCode: 'USDT',
    toAmount: new Prisma.Decimal('100000'),
    netToAmount: new Prisma.Decimal('99900'),
    feeAmount: new Prisma.Decimal('100'),
    feeCurrency: 'USDT',
    exchangeRate: new Prisma.Decimal('100000'),
    statusHistory: JSON.stringify([
      {
        status,
        timestamp: '2026-03-26T00:00:00.000Z',
        operator: 'SYSTEM',
        source: 'SYSTEM',
        note: 'seed',
      },
    ]),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(AuditLogsService.prototype, 'recordByActor')
      .mockResolvedValue({} as any);
    recordSystemSpy = jest
      .spyOn(AuditLogsService.prototype, 'recordSystem')
      .mockResolvedValue({} as any);
    service = new SwapTransactionWorkflowService(
      prismaMock as any,
      journalsServiceMock as any,
      outstandingsServiceMock as any,
      {} as any,
    );
  });

  it('flags swap into UNDER_REVIEW without posting accounting or outstandings', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
    );
    prismaMock.swapTransaction.update.mockResolvedValue({
      ...buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
      status: SwapTransactionStatus.UNDER_REVIEW,
    });

    const result = await service.execute(undefined, {
      swapId: 'swap-1',
      source: 'ALERT',
      sourceId: 'alert-1',
      workflowAction: 'FLAG',
      reasonCode: 'TX_SWAP_REVIEW_REQUIRED',
    });

    expect(prismaMock.swapTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'swap-1' },
        data: expect.objectContaining({
          status: SwapTransactionStatus.UNDER_REVIEW,
        }),
      }),
    );
    expect(journalsServiceMock.triggerEvent).not.toHaveBeenCalled();
    expect(outstandingsServiceMock.createForSwapSuccess).not.toHaveBeenCalled();
    expect(prismaMock.outstanding.deleteMany).not.toHaveBeenCalled();
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'STATE_TRANSITION',
        action: 'SWAP_PENDING_COMPLIANCE_TO_UNDER_REVIEW',
        workflowType: 'SWAP',
        statusFrom: SwapTransactionStatus.PENDING_COMPLIANCE,
        statusTo: SwapTransactionStatus.UNDER_REVIEW,
        metadata: expect.objectContaining({
          quoteId: 'quote-1',
          quoteNo: 'QUO_0001',
        }),
      }),
      prismaMock,
    );
    expect(result.applied).toBe(true);
    expect(result.transitionCode).toBe('TX_SWAP_FLAG_TO_UNDER_REVIEW');
    expect(result.swapStatusAfter).toBe(SwapTransactionStatus.UNDER_REVIEW);
  });

  it('clears swap to SUCCESS and creates dual outstandings', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
    );
    const updatedSwap = {
      ...buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
      status: SwapTransactionStatus.SUCCESS,
      completedAt: new Date('2026-03-26T12:00:00.000Z'),
    };
    prismaMock.swapTransaction.update.mockResolvedValue(updatedSwap);

    const result = await service.execute(undefined, {
      swapId: 'swap-1',
      source: 'SYSTEM',
      sourceId: 'SYSTEM',
      workflowAction: 'CLEAR',
      reasonCode: 'LOW_RISK_AUTO_CLEAR',
    });

    expect(journalsServiceMock.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        fromStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        toStatus: SwapTransactionStatus.SUCCESS,
        sourceId: 'swap-1',
      }),
      prismaMock,
    );
    expect(outstandingsServiceMock.createForSwapSuccess).toHaveBeenCalledWith(
      prismaMock,
      updatedSwap,
    );
    expect(prismaMock.outstanding.deleteMany).not.toHaveBeenCalled();
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'STATE_TRANSITION',
        action: 'SWAP_PENDING_COMPLIANCE_TO_SUCCESS',
        workflowType: 'SWAP',
        statusFrom: SwapTransactionStatus.PENDING_COMPLIANCE,
        statusTo: SwapTransactionStatus.SUCCESS,
        metadata: expect.objectContaining({
          quoteId: 'quote-1',
          quoteNo: 'QUO_0001',
        }),
      }),
      prismaMock,
    );
    expect(result.applied).toBe(true);
    expect(result.transitionCode).toBe('TX_SWAP_CLEAR_TO_SUCCESS');
    expect(result.swapStatusAfter).toBe(SwapTransactionStatus.SUCCESS);
  });

  it('rejects swap and removes outstanding rows after reversal posting', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
    );
    prismaMock.swapTransaction.update.mockResolvedValue({
      ...buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
      status: SwapTransactionStatus.REJECTED,
      completedAt: new Date('2026-03-26T12:00:00.000Z'),
    });

    const result = await service.execute(undefined, {
      swapId: 'swap-1',
      source: 'CASE',
      sourceId: 'case-1',
      workflowAction: 'REJECT',
      reasonCode: 'RISK_CONFIRMED',
    });

    expect(journalsServiceMock.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        fromStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        toStatus: SwapTransactionStatus.REJECTED,
        sourceId: 'swap-1',
      }),
      prismaMock,
    );
    expect(prismaMock.outstanding.deleteMany).toHaveBeenCalledWith({
      where: {
        sourceType: 'SWAP',
        sourceId: 'swap-1',
      },
    });
    expect(outstandingsServiceMock.createForSwapSuccess).not.toHaveBeenCalled();
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'STATE_TRANSITION',
        action: 'SWAP_PENDING_COMPLIANCE_TO_REJECTED',
        workflowType: 'SWAP',
        statusFrom: SwapTransactionStatus.PENDING_COMPLIANCE,
        statusTo: SwapTransactionStatus.REJECTED,
      }),
      prismaMock,
    );
    expect(result.applied).toBe(true);
    expect(result.transitionCode).toBe('TX_SWAP_REJECT_TO_REJECTED');
    expect(result.swapStatusAfter).toBe(SwapTransactionStatus.REJECTED);
  });

  it('fails swap, writes failure detail, and removes outstanding rows', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
    );
    prismaMock.swapTransaction.update.mockResolvedValue({
      ...buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
      status: SwapTransactionStatus.FAILED,
      failureCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
      failureReason: 'bridge failed',
      completedAt: new Date('2026-03-26T12:00:00.000Z'),
    });

    const result = await service.execute(undefined, {
      swapId: 'swap-1',
      source: 'SYSTEM',
      sourceId: 'SYSTEM',
      workflowAction: 'FAIL',
      reasonCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
      failureCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
      failureReason: 'bridge failed',
    });

    expect(prismaMock.swapTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'swap-1' },
        data: expect.objectContaining({
          status: SwapTransactionStatus.FAILED,
          failureCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
          failureReason: 'bridge failed',
        }),
      }),
    );
    expect(journalsServiceMock.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        fromStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        toStatus: SwapTransactionStatus.FAILED,
        sourceId: 'swap-1',
      }),
      prismaMock,
    );
    expect(prismaMock.outstanding.deleteMany).toHaveBeenCalledWith({
      where: {
        sourceType: 'SWAP',
        sourceId: 'swap-1',
      },
    });
    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'STATE_TRANSITION',
        action: 'SWAP_PENDING_COMPLIANCE_TO_FAILED',
        workflowType: 'SWAP',
        statusFrom: SwapTransactionStatus.PENDING_COMPLIANCE,
        statusTo: SwapTransactionStatus.FAILED,
      }),
      prismaMock,
    );
    expect(result.applied).toBe(true);
    expect(result.transitionCode).toBe('TX_SWAP_FAIL_TO_FAILED');
    expect(result.swapStatusAfter).toBe(SwapTransactionStatus.FAILED);
  });

  it('falls back to swapId instead of quoteNo when swapNo is missing', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue({
      ...buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
      swapNo: null,
    });
    prismaMock.swapTransaction.update.mockResolvedValue({
      ...buildSwap(SwapTransactionStatus.PENDING_COMPLIANCE),
      swapNo: null,
      status: SwapTransactionStatus.UNDER_REVIEW,
    });

    await service.execute(undefined, {
      swapId: 'swap-1',
      source: 'ALERT',
      sourceId: 'alert-1',
      workflowAction: 'FLAG',
      reasonCode: 'TX_SWAP_REVIEW_REQUIRED',
    });

    expect(recordSystemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'SWAP',
        metadata: expect.objectContaining({
          quoteNo: 'QUO_0001',
        }),
      }),
      prismaMock,
    );
  });

  it('returns NO_TRANSITION for repeated FLAG on UNDER_REVIEW', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap(SwapTransactionStatus.UNDER_REVIEW),
    );

    const result = await service.execute(undefined, {
      swapId: 'swap-1',
      source: 'ALERT',
      sourceId: 'alert-1',
      workflowAction: 'FLAG',
    });

    expect(prismaMock.swapTransaction.update).not.toHaveBeenCalled();
    expect(journalsServiceMock.triggerEvent).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.transitionCode).toBe('NO_TRANSITION');
    expect(result.swapStatusAfter).toBe(SwapTransactionStatus.UNDER_REVIEW);
  });

  it.each([
    [SwapTransactionStatus.SUCCESS],
    [SwapTransactionStatus.REJECTED],
    [SwapTransactionStatus.FAILED],
  ])(
    'returns NO_TRANSITION for repeated callback on terminal status %s',
    async (status) => {
      prismaMock.swapTransaction.findUnique.mockResolvedValue(buildSwap(status));

      const result = await service.execute(undefined, {
        swapId: 'swap-1',
        source: 'CASE',
        sourceId: 'case-1',
        workflowAction: 'REJECT',
      });

      expect(prismaMock.swapTransaction.update).not.toHaveBeenCalled();
      expect(journalsServiceMock.triggerEvent).not.toHaveBeenCalled();
      expect(result.applied).toBe(false);
      expect(result.transitionCode).toBe('NO_TRANSITION');
      expect(result.swapStatusAfter).toBe(status);
    },
  );

  it('rejects illegal workflow transition from non-canonical status', async () => {
    prismaMock.swapTransaction.findUnique.mockResolvedValue(
      buildSwap('CREATED'),
    );

    await expect(
      service.execute(undefined, {
        swapId: 'swap-1',
        source: 'SYSTEM',
        sourceId: 'SYSTEM',
        workflowAction: 'CLEAR',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prismaMock.swapTransaction.update).not.toHaveBeenCalled();
    expect(journalsServiceMock.triggerEvent).not.toHaveBeenCalled();
    expect(outstandingsServiceMock.createForSwapSuccess).not.toHaveBeenCalled();
  });
});
