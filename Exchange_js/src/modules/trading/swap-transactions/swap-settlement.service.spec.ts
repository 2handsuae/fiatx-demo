import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SwapSettlementService } from './swap-settlement.service';
import { FundsFlowService } from '../../funds-layer/domain/funds-flow.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { SwapTransactionsService } from './swap-transactions.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InternalFundAction, InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';

// -------------- mock helpers --------------

const mockFundsFlow = {
  createSwapLeg: jest.fn(),
  transitionSwapLeg: jest.fn(),
};

const mockAccounting = {
  executePendingTransfer: jest.fn(),
  postPendingTransfer: jest.fn(),
  voidPendingTransfer: jest.fn(),
  resolveTbAccountId: jest.fn(),
};

const mockWallets = {
  resolve: jest.fn(),
  resolveCustomer: jest.fn(),
};

const mockSwaps = {
  findByNoInternal: jest.fn(),
  markStatus: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

// A mock prisma that captures $transaction calls
const makeMockPrisma = (legs: any[]) => {
  const client = {
    internalFund: {
      findMany: jest.fn().mockResolvedValue(legs),
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const found = legs.find(
          (l) => l.swapTransactionId === where?.swapTransactionId && l.legSeq === where?.legSeq,
        );
        return Promise.resolve(found ?? null);
      }),
    },
  };
  return {
    $transaction: jest.fn().mockImplementation((fn: (c: any) => any) => fn(client)),
    internalFund: client.internalFund,
  };
};

// -------------- fixtures --------------

const SWAP_ID = 'swap-uuid-1';
const SWAP_NO = 'SWP000001';
const OWNER_ID = 'owner-uuid-1';
const FROM_ASSET_ID = 'usdt-asset-id';
const TO_ASSET_ID = 'aed-asset-id';

// crypto→fiat (USDT→AED): fromIsFiat=false
const cryptoToFiatCtx = {
  swapId: SWAP_ID,
  swapNo: SWAP_NO,
  ownerId: OWNER_ID,
  fromIsFiat: false,
  fromAssetId: FROM_ASSET_ID,
  toAssetId: TO_ASSET_ID,
  fromLedger: 2, // USDT
  toLedger: 1,   // AED
  fromCurrency: 'USDT',
  toCurrency: 'AED',
  fromAmount: new Prisma.Decimal('100'),
  grossToAmount: new Prisma.Decimal('368'),
  feeAmount: new Prisma.Decimal('1'),
  fromDecimals: 6,
  toDecimals: 2,
};

// leg rows for the mock prisma (SETTLING swap / all CREATED except where set)
const makeLegRow = (legSeq: number, status: string = 'CREATED', assetType = 'CRYPTO') => ({
  id: `leg-${legSeq}-id`,
  legSeq,
  swapTransactionId: SWAP_ID,
  status,
  internalFundNo: `IFD-000${legSeq}`,
  asset: { id: legSeq <= 2 ? FROM_ASSET_ID : TO_ASSET_ID, type: assetType },
});

const swapRow = {
  id: SWAP_ID,
  swapNo: SWAP_NO,
  status: 'SETTLING',
  ownerId: OWNER_ID,
  fromAssetId: FROM_ASSET_ID,
  toAssetId: TO_ASSET_ID,
  fromAmount: new Prisma.Decimal('100'),
  toAmount: new Prisma.Decimal('368'),
  feeAmount: new Prisma.Decimal('1'),
  fromAsset: { decimals: 6, currency: 'USDT', type: 'CRYPTO' },
  toAsset: { decimals: 2, currency: 'AED', type: 'FIAT' },
};

// -------------- tests --------------

describe('SwapSettlementService', () => {
  let service: SwapSettlementService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mocks
    mockFundsFlow.createSwapLeg.mockResolvedValue({ id: 'leg-new' });
    mockFundsFlow.transitionSwapLeg.mockImplementation((id: string, action: string) => {
      const nextMap: Record<string, InternalFundStatus> = {
        [InternalFundAction.SIGN]: InternalFundStatus.SIGNING,
        [InternalFundAction.SUBMIT]: InternalFundStatus.CONFIRMING,
        [InternalFundAction.CLEAR]: InternalFundStatus.CLEAR,
        [InternalFundAction.FAIL]: InternalFundStatus.FAILED,
      };
      return Promise.resolve({ leg: { id }, prevStatus: 'CREATED', nextStatus: nextMap[action] ?? action });
    });
    mockAccounting.executePendingTransfer.mockResolvedValue({ tbTransferId: 1n });
    mockAccounting.postPendingTransfer.mockResolvedValue(undefined);
    mockAccounting.voidPendingTransfer.mockResolvedValue(undefined);
    mockAccounting.resolveTbAccountId.mockResolvedValue(100n);
    mockWallets.resolve.mockResolvedValue({ id: 'wallet-platform' });
    mockWallets.resolveCustomer.mockResolvedValue({ id: 'wallet-customer' });
    mockSwaps.findByNoInternal.mockResolvedValue(swapRow);
    mockSwaps.markStatus.mockResolvedValue(undefined);
    mockEventEmitter.emit.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapSettlementService,
        { provide: PrismaService, useValue: makeMockPrisma([]) },
        { provide: FundsFlowService, useValue: mockFundsFlow },
        { provide: AccountingService, useValue: mockAccounting },
        { provide: SystemWalletResolver, useValue: mockWallets },
        { provide: SwapTransactionsService, useValue: mockSwaps },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SwapSettlementService>(SwapSettlementService);
  });

  // ────────────────── start ──────────────────

  describe('start', () => {
    it('creates 4 legs and initiates leg1 (2 executePendingTransfer calls for crypto SIGN)', async () => {
      const fakeTx = {} as any;
      await service.start(cryptoToFiatCtx, fakeTx);

      // 4 createSwapLeg calls
      expect(mockFundsFlow.createSwapLeg).toHaveBeenCalledTimes(4);

      // leg1 has 2 accounting entries (SWAP_SELL_CLIENT + SWAP_SELL_FIRM) on from-ledger
      expect(mockAccounting.executePendingTransfer).toHaveBeenCalledTimes(2);

      // leg1 side='from' → fromIsFiat=false → crypto → SIGN action
      expect(mockFundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(1);
      expect(mockFundsFlow.transitionSwapLeg).toHaveBeenCalledWith(
        expect.any(String),
        InternalFundAction.SIGN,
        'SYSTEM',
        fakeTx,
      );
    });

    it('initiates leg1 with SUBMIT for fiat→crypto direction', async () => {
      // fiat→crypto: fromIsFiat=true, leg1 side='from'(FIAT) → SUBMIT
      const fiatCtx = { ...cryptoToFiatCtx, fromIsFiat: true };
      const fakeTx = {} as any;
      await service.start(fiatCtx, fakeTx);

      expect(mockFundsFlow.transitionSwapLeg).toHaveBeenCalledWith(
        expect.any(String),
        InternalFundAction.SUBMIT,
        'SYSTEM',
        fakeTx,
      );
    });

    it('skips pending transfers for zero-amount entries (fee=0 leg)', async () => {
      const zeroFeeCtx = { ...cryptoToFiatCtx, feeAmount: new Prisma.Decimal('0') };
      const fakeTx = {} as any;
      await service.start(zeroFeeCtx, fakeTx);
      // leg1 still has 2 entries; fee-leg entries are on leg4 which is not initiated here
      expect(mockFundsFlow.createSwapLeg).toHaveBeenCalledTimes(4);
    });
  });

  // ────────────────── advanceLeg: CLEAR on non-last leg ──────────────────

  describe('advanceLeg — CLEAR non-last leg', () => {
    it('posts leg1 pending and initiates leg2 on CLEAR', async () => {
      // legs: leg1=SIGNING (about to go CLEAR), legs 2-4 CREATED
      const legs = [
        makeLegRow(1, 'SIGNING', 'CRYPTO'),
        makeLegRow(2, 'CREATED', 'FIAT'),
        makeLegRow(3, 'CREATED', 'FIAT'),
        makeLegRow(4, 'CREATED', 'FIAT'),
      ];

      // Override transitionSwapLeg: leg1 → CLEAR, then leg2 initiation → CONFIRMING
      let callCount = 0;
      mockFundsFlow.transitionSwapLeg.mockImplementation((id: string, action: string) => {
        callCount++;
        if (callCount === 1) {
          // advance leg1 to CLEAR
          return Promise.resolve({ leg: { id }, prevStatus: 'SIGNING', nextStatus: InternalFundStatus.CLEAR });
        }
        // initiate leg2 (fiat → SUBMIT → CONFIRMING)
        return Promise.resolve({ leg: { id }, prevStatus: 'CREATED', nextStatus: InternalFundStatus.CONFIRMING });
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SwapSettlementService,
          { provide: PrismaService, useValue: makeMockPrisma(legs) },
          { provide: FundsFlowService, useValue: mockFundsFlow },
          { provide: AccountingService, useValue: mockAccounting },
          { provide: SystemWalletResolver, useValue: mockWallets },
          { provide: SwapTransactionsService, useValue: mockSwaps },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();
      const svc = module.get<SwapSettlementService>(SwapSettlementService);

      await svc.advanceLeg(SWAP_NO, 1, InternalFundAction.CLEAR, 'admin-1');

      // leg1 has 2 accounting entries → 2 postPendingTransfer calls
      expect(mockAccounting.postPendingTransfer).toHaveBeenCalledTimes(2);
      // leg2 has 1 accounting entry (SWAP_BUY_OPS_TO_SET) → 1 executePendingTransfer
      expect(mockAccounting.executePendingTransfer).toHaveBeenCalledTimes(1);
      // swap NOT marked success yet
      expect(mockSwaps.markStatus).not.toHaveBeenCalled();
    });
  });

  // ────────────────── advanceLeg: CLEAR on last leg ──────────────────

  describe('advanceLeg — CLEAR last leg (leg4)', () => {
    it('marks swap SUCCESS and emits SWAP_SUCCEEDED after leg4 CLEAR', async () => {
      // legs 1-3 CLEAR, leg4 CONFIRMED (about to CLEAR)
      const legs = [
        makeLegRow(1, 'CLEAR', 'CRYPTO'),
        makeLegRow(2, 'CLEAR', 'FIAT'),
        makeLegRow(3, 'CLEAR', 'FIAT'),
        makeLegRow(4, 'CONFIRMED', 'FIAT'),
      ];

      mockFundsFlow.transitionSwapLeg.mockResolvedValue({
        leg: { id: 'leg-4-id' },
        prevStatus: 'CONFIRMED',
        nextStatus: InternalFundStatus.CLEAR,
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SwapSettlementService,
          { provide: PrismaService, useValue: makeMockPrisma(legs) },
          { provide: FundsFlowService, useValue: mockFundsFlow },
          { provide: AccountingService, useValue: mockAccounting },
          { provide: SystemWalletResolver, useValue: mockWallets },
          { provide: SwapTransactionsService, useValue: mockSwaps },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();
      const svc = module.get<SwapSettlementService>(SwapSettlementService);

      await svc.advanceLeg(SWAP_NO, 4, InternalFundAction.CLEAR, 'admin-1');

      expect(mockSwaps.markStatus).toHaveBeenCalledWith(SWAP_ID, 'SUCCESS', expect.anything());
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'swap.succeeded',
        expect.objectContaining({ swapId: SWAP_ID, swapNo: SWAP_NO }),
      );
    });
  });

  // ────────────────── advanceLeg: FAIL ──────────────────

  describe('advanceLeg — FAIL', () => {
    it('voids leg pending and marks swap FAILED on FAIL action', async () => {
      const legs = [
        makeLegRow(1, 'SIGNING', 'CRYPTO'),
        makeLegRow(2, 'CREATED', 'FIAT'),
        makeLegRow(3, 'CREATED', 'FIAT'),
        makeLegRow(4, 'CREATED', 'FIAT'),
      ];

      mockFundsFlow.transitionSwapLeg.mockResolvedValue({
        leg: { id: 'leg-1-id' },
        prevStatus: 'SIGNING',
        nextStatus: InternalFundStatus.FAILED,
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SwapSettlementService,
          { provide: PrismaService, useValue: makeMockPrisma(legs) },
          { provide: FundsFlowService, useValue: mockFundsFlow },
          { provide: AccountingService, useValue: mockAccounting },
          { provide: SystemWalletResolver, useValue: mockWallets },
          { provide: SwapTransactionsService, useValue: mockSwaps },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();
      const svc = module.get<SwapSettlementService>(SwapSettlementService);

      await svc.advanceLeg(SWAP_NO, 1, InternalFundAction.FAIL, 'admin-1');

      // leg1 has 2 entries → 2 voidPendingTransfer calls
      expect(mockAccounting.voidPendingTransfer).toHaveBeenCalledTimes(2);
      expect(mockSwaps.markStatus).toHaveBeenCalledWith(SWAP_ID, 'FAILED', expect.anything());
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ────────────────── advanceLeg: sequence guard ──────────────────

  describe('advanceLeg — sequence guard', () => {
    it('rejects advancing leg2 while leg1 is not CLEAR', async () => {
      const legs = [
        makeLegRow(1, 'SIGNING', 'CRYPTO'), // not CLEAR
        makeLegRow(2, 'CREATED', 'FIAT'),
        makeLegRow(3, 'CREATED', 'FIAT'),
        makeLegRow(4, 'CREATED', 'FIAT'),
      ];

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SwapSettlementService,
          { provide: PrismaService, useValue: makeMockPrisma(legs) },
          { provide: FundsFlowService, useValue: mockFundsFlow },
          { provide: AccountingService, useValue: mockAccounting },
          { provide: SystemWalletResolver, useValue: mockWallets },
          { provide: SwapTransactionsService, useValue: mockSwaps },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();
      const svc = module.get<SwapSettlementService>(SwapSettlementService);

      await expect(
        svc.advanceLeg(SWAP_NO, 2, InternalFundAction.CONFIRM, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when swap status is not SETTLING', async () => {
      mockSwaps.findByNoInternal.mockResolvedValue({ ...swapRow, status: 'SUCCESS' });

      const legs = [makeLegRow(1, 'CLEAR'), makeLegRow(2, 'CREATED'), makeLegRow(3, 'CREATED'), makeLegRow(4, 'CREATED')];
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SwapSettlementService,
          { provide: PrismaService, useValue: makeMockPrisma(legs) },
          { provide: FundsFlowService, useValue: mockFundsFlow },
          { provide: AccountingService, useValue: mockAccounting },
          { provide: SystemWalletResolver, useValue: mockWallets },
          { provide: SwapTransactionsService, useValue: mockSwaps },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();
      const svc = module.get<SwapSettlementService>(SwapSettlementService);

      await expect(
        svc.advanceLeg(SWAP_NO, 1, InternalFundAction.SIGN, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
