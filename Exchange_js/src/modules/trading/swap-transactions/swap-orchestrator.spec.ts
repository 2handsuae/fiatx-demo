import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalsService } from '../../accounting/journals/journals.service';
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';
import { PricingCenterService } from '../pricing-center/pricing-center.service';
import { SwapEvents } from './constants/swap-events.constant';
import {
  SwapTransactionAction,
  SwapTransactionStatus,
} from './dto/swap-transaction.dto';
import { SwapTransactionsService } from './swap-transactions.service';
import {
  SwapTransactionWorkflowService,
} from './swap-transaction-workflow.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';

describe('SwapWorkflowOrchestrator', () => {
  let orchestrator: SwapWorkflowOrchestrator;

  const mockPrisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    swapTransaction: {
      create: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
    },
    customerMain: {
      findUnique: jest.fn(),
    },
  };

  const mockSwapService = {
    getExecutableRate: jest.fn(),
    findOne: jest.fn(),
  };

  const mockJournalsService = {
    getCustomerLiabilityBalance: jest.fn(),
    triggerEvent: jest.fn(),
  };

  const mockPricingCenterService = {
    getActiveSwapQuoteOrThrow: jest.fn(),
    consumeSwapQuoteForSwap: jest.fn(),
    assertSwapProductAllowedForOwner: jest.fn(),
  };

  const mockTransactionComplianceService = {
    evaluateSwapFinalReview: jest.fn(),
  };

  const mockSwapWorkflowService = {
    execute: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapWorkflowOrchestrator,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SwapTransactionsService, useValue: mockSwapService },
        { provide: JournalsService, useValue: mockJournalsService },
        { provide: PricingCenterService, useValue: mockPricingCenterService },
        {
          provide: TransactionComplianceService,
          useValue: mockTransactionComplianceService,
        },
        {
          provide: SwapTransactionWorkflowService,
          useValue: mockSwapWorkflowService,
        },
      ],
    }).compile();

    orchestrator = module.get<SwapWorkflowOrchestrator>(SwapWorkflowOrchestrator);

    jest.clearAllMocks();
    jest
      .spyOn((orchestrator as any).auditLogsService, 'recordByActor')
      .mockResolvedValue({ id: 'audit-by-actor-1' });
    jest
      .spyOn((orchestrator as any).auditLogsService, 'recordSystem')
      .mockResolvedValue({ id: 'audit-system-1' });
  });

  it('creates swap from quote, posts created accounting, and auto-clears low-risk swaps', async () => {
    const quote = {
      id: 'quote-1',
      quoteNo: 'QUO_0001',
      ownerNo: 'CU_0001',
      fromAssetId: 'asset-btc',
      fromAssetCode: 'BTC',
      toAssetId: 'asset-usdt',
      toAssetCode: 'USDT',
      amountIn: new Prisma.Decimal('1'),
      amountOut: new Prisma.Decimal('100000'),
      rateAllIn: new Prisma.Decimal('100000'),
      feeTotal: new Prisma.Decimal('0'),
      feeCurrency: 'USDT',
      feeBreakdown: '[]',
      totalsJson: JSON.stringify({
        amountOutNet: '100000',
      }),
    };
    const createdSwap = {
      id: 'swap-1',
      swapNo: 'SWP_0001',
      quoteId: 'quote-1',
      quoteNo: 'QUO_0001',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      status: SwapTransactionStatus.PENDING_COMPLIANCE,
      fromAssetId: 'asset-btc',
      fromAssetCode: 'BTC',
      fromAmount: new Prisma.Decimal('1'),
      toAssetId: 'asset-usdt',
      toAssetCode: 'USDT',
      toAmount: new Prisma.Decimal('100000'),
      netToAmount: new Prisma.Decimal('100000'),
      feeAmount: new Prisma.Decimal('0'),
      feeCurrency: 'USDT',
      exchangeRate: new Prisma.Decimal('100000'),
    };
    const finalSwap = {
      ...createdSwap,
      status: SwapTransactionStatus.SUCCESS,
      completedAt: new Date('2026-03-26T12:00:00.000Z'),
    };

    mockPricingCenterService.getActiveSwapQuoteOrThrow.mockResolvedValue(quote);
    mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal('10'),
    });
    mockPrisma.swapTransaction.create.mockResolvedValue(createdSwap);
    mockTransactionComplianceService.evaluateSwapFinalReview.mockResolvedValue({
      skipped: false,
      decision: 'APPROVE',
    });
    mockSwapService.findOne.mockResolvedValue(finalSwap);

    const result = await orchestrator.createSwapFromQuote(
      'customer-1',
      'quote-1',
    );

    expect(mockPricingCenterService.assertSwapProductAllowedForOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        fromAssetId: 'asset-btc',
        toAssetId: 'asset-usdt',
      }),
    );
    expect(mockPricingCenterService.consumeSwapQuoteForSwap).toHaveBeenCalledWith(
      mockPrisma,
      'quote-1',
      'CUSTOMER',
      'customer-1',
      expect.any(Date),
    );
    expect(mockJournalsService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        fromStatus: null,
        toStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        sourceId: 'swap-1',
      }),
      mockPrisma,
    );
    expect(mockJournalsService.triggerEvent).toHaveBeenCalledTimes(1);
    expect(mockTransactionComplianceService.evaluateSwapFinalReview).toHaveBeenCalledWith(
      'swap-1',
    );
    expect((orchestrator as any).auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'swap-1',
        entityNo: 'SWP_0001',
        traceId: 'SWAP:swap-1',
        workflowType: 'SWAP',
        workflowId: 'swap-1',
        workflowNo: 'SWP_0001',
        metadata: expect.objectContaining({
          quoteId: 'quote-1',
          quoteNo: 'QUO_0001',
        }),
      }),
      expect.any(Object),
      mockPrisma,
    );
    expect(result.swap_status_after).toBe(SwapTransactionStatus.SUCCESS);
    expect(result.emitted_events).toContain(SwapEvents.EVT_SWAP_SUCCESS);
    expect(result.transaction).toEqual(finalSwap);
  });

  it('marks swap as failed when post-create compliance evaluation throws', async () => {
    const quote = {
      id: 'quote-2',
      quoteNo: 'QUO_0002',
      ownerNo: 'CU_0001',
      fromAssetId: 'asset-btc',
      fromAssetCode: 'BTC',
      toAssetId: 'asset-usdt',
      toAssetCode: 'USDT',
      amountIn: new Prisma.Decimal('1'),
      amountOut: new Prisma.Decimal('100000'),
      rateAllIn: new Prisma.Decimal('100000'),
      feeTotal: new Prisma.Decimal('0'),
      feeCurrency: 'USDT',
      feeBreakdown: '[]',
      totalsJson: JSON.stringify({
        amountOutNet: '100000',
      }),
    };
    const createdSwap = {
      id: 'swap-2',
      swapNo: 'SWP_0002',
      quoteId: 'quote-2',
      quoteNo: 'QUO_0002',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      status: SwapTransactionStatus.PENDING_COMPLIANCE,
      fromAssetId: 'asset-btc',
      fromAssetCode: 'BTC',
      fromAmount: new Prisma.Decimal('1'),
      toAssetId: 'asset-usdt',
      toAssetCode: 'USDT',
      toAmount: new Prisma.Decimal('100000'),
      netToAmount: new Prisma.Decimal('100000'),
      feeAmount: new Prisma.Decimal('0'),
      feeCurrency: 'USDT',
      exchangeRate: new Prisma.Decimal('100000'),
    };
    const failedSwap = {
      ...createdSwap,
      status: SwapTransactionStatus.FAILED,
      failureCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
    };

    mockPricingCenterService.getActiveSwapQuoteOrThrow.mockResolvedValue(quote);
    mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal('10'),
    });
    mockPrisma.swapTransaction.create.mockResolvedValue(createdSwap);
    mockTransactionComplianceService.evaluateSwapFinalReview.mockRejectedValue(
      new Error('bridge failed'),
    );
    mockSwapWorkflowService.execute.mockResolvedValue({
      applied: true,
      swapId: 'swap-2',
      swapStatusBefore: SwapTransactionStatus.PENDING_COMPLIANCE,
      swapStatusAfter: SwapTransactionStatus.FAILED,
      transitionCode: 'TX_SWAP_FAIL_TO_FAILED',
    });
    mockSwapService.findOne.mockResolvedValue(failedSwap);

    const result = await orchestrator.createSwapFromQuote(
      'customer-1',
      'quote-2',
    );

    expect(mockSwapWorkflowService.execute).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        swapId: 'swap-2',
        workflowAction: 'FAIL',
        failureCode: 'TX_SWAP_FINAL_EVALUATION_FAILED',
      }),
    );
    expect(result.swap_status_after).toBe(SwapTransactionStatus.FAILED);
    expect(result.emitted_events).toContain(SwapEvents.EVT_SWAP_FAILED);
  });

  it('blocks quote consumption when available balance is insufficient', async () => {
    mockPricingCenterService.getActiveSwapQuoteOrThrow.mockResolvedValue({
      id: 'quote-3',
      quoteNo: 'QUO_0003',
      ownerNo: 'CU_0001',
      fromAssetId: 'asset-btc',
      fromAssetCode: 'BTC',
      toAssetId: 'asset-usdt',
      toAssetCode: 'USDT',
      amountIn: new Prisma.Decimal('2'),
      amountOut: new Prisma.Decimal('200000'),
      rateAllIn: new Prisma.Decimal('100000'),
      feeTotal: new Prisma.Decimal('0'),
      feeCurrency: 'USDT',
      feeBreakdown: '[]',
      totalsJson: JSON.stringify({
        amountOutNet: '200000',
      }),
    });
    mockJournalsService.getCustomerLiabilityBalance.mockResolvedValue({
      availableBalance: new Prisma.Decimal('1'),
    });

    await expect(
      orchestrator.createSwapFromQuote('customer-1', 'quote-3'),
    ).rejects.toThrow(BadRequestException);

    expect(mockPricingCenterService.consumeSwapQuoteForSwap).not.toHaveBeenCalled();
    expect(mockPrisma.swapTransaction.create).not.toHaveBeenCalled();
  });

  it.each([
    ['PAIR_DISABLED'],
    ['CHANNEL_ONLINE_DISABLED'],
    ['TIER_DISABLED'],
  ])(
    'blocks swap creation from quote when restriction re-check returns %s',
    async (restrictionCode) => {
      mockPricingCenterService.getActiveSwapQuoteOrThrow.mockResolvedValue({
        id: 'quote-restricted',
        quoteNo: 'QUO_9001',
        ownerNo: 'CU_0001',
        fromAssetId: 'asset-btc',
        fromAssetCode: 'BTC',
        toAssetId: 'asset-usdt',
        toAssetCode: 'USDT',
        amountIn: new Prisma.Decimal('1'),
        amountOut: new Prisma.Decimal('100000'),
        rateAllIn: new Prisma.Decimal('100000'),
        feeTotal: new Prisma.Decimal('0'),
        feeCurrency: 'USDT',
        feeBreakdown: '[]',
        totalsJson: JSON.stringify({
          amountOutNet: '100000',
        }),
      });
      mockPricingCenterService.assertSwapProductAllowedForOwner.mockRejectedValue(
        new ForbiddenException({
          code: 'SWAP_PRODUCT_RESTRICTED',
          restrictionCode,
          message: `${restrictionCode} blocked`,
        }),
      );

      await expect(
        orchestrator.createSwapFromQuote('customer-1', 'quote-restricted'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SWAP_PRODUCT_RESTRICTED',
          restrictionCode,
        }),
      });

      expect(mockPricingCenterService.consumeSwapQuoteForSwap).not.toHaveBeenCalled();
      expect(mockJournalsService.getCustomerLiabilityBalance).not.toHaveBeenCalled();
      expect(mockPrisma.swapTransaction.create).not.toHaveBeenCalled();
      expect(mockJournalsService.triggerEvent).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      SwapTransactionAction.SUCCESS,
      'CLEAR',
      SwapTransactionStatus.SUCCESS,
      'TX_SWAP_CLEAR_TO_SUCCESS',
      SwapEvents.EVT_SWAP_SUCCESS,
      'Cleared by admin',
    ],
    [
      SwapTransactionAction.REJECT,
      'REJECT',
      SwapTransactionStatus.REJECTED,
      'TX_SWAP_REJECT_TO_REJECTED',
      SwapEvents.EVT_SWAP_REJECTED,
      'Confirmed issue',
    ],
    [
      SwapTransactionAction.FAIL,
      'FAIL',
      SwapTransactionStatus.FAILED,
      'TX_SWAP_FAIL_TO_FAILED',
      SwapEvents.EVT_SWAP_FAILED,
      'Operator compensation failure',
    ],
  ])(
    'delegates admin %s transition to swap workflow service',
    async (
      action,
      workflowAction,
      swapStatusAfter,
      transitionCode,
      emittedEvent,
      reason,
    ) => {
      mockSwapWorkflowService.execute.mockResolvedValue({
        applied: true,
        swapId: 'swap-4',
        swapStatusBefore: SwapTransactionStatus.UNDER_REVIEW,
        swapStatusAfter,
        transitionCode,
      });
      mockSwapService.findOne.mockResolvedValue({
        id: 'swap-4',
        swapNo: 'SWP_0004',
        status: swapStatusAfter,
      });

      const result = await orchestrator.handleStatusTransition(
        'swap-4',
        {
          action,
          reason,
        },
        'admin-1',
      );

      expect(mockSwapWorkflowService.execute).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          swapId: 'swap-4',
          workflowAction,
          reason,
        }),
      );
      expect(result.swap_status_after).toBe(swapStatusAfter);
      expect(result.emitted_events).toContain(emittedEvent);
    },
  );
});
