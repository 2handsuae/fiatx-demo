import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SwapSettlementService } from './swap-settlement.service';
import { FundsFlowService } from '../../funds-layer/domain/funds-flow.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { SwapTransactionsService } from './swap-transactions.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InternalFundAction, InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

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

const mockAuditLogs = {
  recordSystem: jest.fn(),
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
  ownerType: 'CUSTOMER',
  ownerNo: null,
  traceId: null,
  fromAssetId: FROM_ASSET_ID,
  toAssetId: TO_ASSET_ID,
  fromAmount: new Prisma.Decimal('100'),
  toAmount: new Prisma.Decimal('368'),
  feeAmount: new Prisma.Decimal('1'),
  fromAsset: { decimals: 6, currency: 'USDT', type: 'CRYPTO' },
  toAsset: { decimals: 2, currency: 'AED', type: 'FIAT' },
};

// -------------- helper: build module with given legs --------------

async function buildModule(legs: any[]) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SwapSettlementService,
      { provide: PrismaService, useValue: makeMockPrisma(legs) },
      { provide: FundsFlowService, useValue: mockFundsFlow },
      { provide: AccountingService, useValue: mockAccounting },
      { provide: SystemWalletResolver, useValue: mockWallets },
      { provide: SwapTransactionsService, useValue: mockSwaps },
      { provide: AuditLogsService, useValue: mockAuditLogs },
      { provide: EventEmitter2, useValue: mockEventEmitter },
    ],
  }).compile();
  return module.get<SwapSettlementService>(SwapSettlementService);
}

// -------------- tests --------------

describe('SwapSettlementService', () => {
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
    mockAuditLogs.recordSystem.mockResolvedValue(undefined);
    mockEventEmitter.emit.mockReturnValue(true);
  });

  // ────────────────── start ──────────────────

  describe('start', () => {
    it('creates 4 legs and initiates leg1 only (2 executePendingTransfer + 1 transition for crypto SIGN)', async () => {
      const svc = await buildModule([]);
      const fakeTx = {} as any;
      await svc.start(cryptoToFiatCtx, fakeTx);

      // 4 createSwapLeg calls
      expect(mockFundsFlow.createSwapLeg).toHaveBeenCalledTimes(4);

      // leg1 has 2 accounting entries (SWAP_SELL_CLIENT + SWAP_SELL_FIRM) on from-ledger
      expect(mockAccounting.executePendingTransfer).toHaveBeenCalledTimes(2);

      // Only leg1 is transitioned — legs 2-4 remain CREATED
      expect(mockFundsFlow.transitionSwapLeg).toHaveBeenCalledTimes(1);
      expect(mockFundsFlow.transitionSwapLeg).toHaveBeenCalledWith(
        expect.any(String),
        InternalFundAction.SIGN,
        'SYSTEM',
        fakeTx,
      );
    });

    it('initiates leg1 with SUBMIT for fiat→crypto direction', async () => {
      const svc = await buildModule([]);
      // fiat→crypto: fromIsFiat=true, leg1 side='from'(FIAT) → SUBMIT
      const fiatCtx = { ...cryptoToFiatCtx, fromIsFiat: true };
      const fakeTx = {} as any;
      await svc.start(fiatCtx, fakeTx);

      expect(mockFundsFlow.transitionSwapLeg).toHaveBeenCalledWith(
        expect.any(String),
        InternalFundAction.SUBMIT,
        'SYSTEM',
        fakeTx,
      );
    });

    it('skips pending transfers for zero-amount entries (fee=0 leg)', async () => {
      const svc = await buildModule([]);
      const zeroFeeCtx = { ...cryptoToFiatCtx, feeAmount: new Prisma.Decimal('0') };
      const fakeTx = {} as any;
      await svc.start(zeroFeeCtx, fakeTx);
      // leg1 still has 2 entries; fee-leg entries are on leg4 which is not initiated here
      expect(mockFundsFlow.createSwapLeg).toHaveBeenCalledTimes(4);
    });

    it('calls executePendingTransfer with expected code and ledger for leg1 CLIENT_PAYABLE entry', async () => {
      const svc = await buildModule([]);
      const fakeTx = {} as any;
      await svc.start(cryptoToFiatCtx, fakeTx);

      // Leg1 first entry = SWAP_SELL_CLIENT: debit=CLIENT_PAYABLE (customer), credit=CLIENT_ASSET
      // resolveTbAccountId is called for debit (CLIENT_PAYABLE, fromLedger) and credit
      expect(mockAccounting.resolveTbAccountId).toHaveBeenCalledWith(
        expect.objectContaining({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: cryptoToFiatCtx.fromLedger }),
      );
      // executePendingTransfer called with expected ledger
      expect(mockAccounting.executePendingTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ ledger: cryptoToFiatCtx.fromLedger }),
      );
    });
  });

  // ────────────────── advanceLeg: first advance of leg2 (CREATED→CONFIRMING) ──────────────────

  describe('advanceLeg — first advance of leg2 (CREATED state)', () => {
    it('books leg2 pending THEN transitions — executePendingTransfer before transitionSwapLeg', async () => {
      // legs: leg1=CLEAR (sequence guard passes), leg2=CREATED, legs 3-4 CREATED
      const legs = [
        makeLegRow(1, 'CLEAR', 'CRYPTO'),
        makeLegRow(2, 'CREATED', 'FIAT'),
        makeLegRow(3, 'CREATED', 'FIAT'),
        makeLegRow(4, 'CREATED', 'FIAT'),
      ];

      // leg2 fiat → SUBMIT → CONFIRMING
      mockFundsFlow.transitionSwapLeg.mockResolvedValue({
        leg: { id: 'leg-2-id' },
        prevStatus: 'CREATED',
        nextStatus: InternalFundStatus.CONFIRMING,
      });

      const svc = await buildModule(legs);
      const callOrder: string[] = [];
      mockAccounting.executePendingTransfer.mockImplementation(() => {
        callOrder.push('executePending');
        return Promise.resolve({ tbTransferId: 1n });
      });
      mockFundsFlow.transitionSwapLeg.mockImplementation((id: string) => {
        callOrder.push('transition');
        return Promise.resolve({ leg: { id }, prevStatus: 'CREATED', nextStatus: InternalFundStatus.CONFIRMING });
      });

      await svc.advanceLeg(SWAP_NO, 2, InternalFundAction.SUBMIT, 'admin-1');

      // pending must be booked before the transition
      const pendingIdx = callOrder.indexOf('executePending');
      const transitionIdx = callOrder.indexOf('transition');
      expect(pendingIdx).toBeGreaterThanOrEqual(0);
      expect(pendingIdx).toBeLessThan(transitionIdx);

      // Intermediate status → no post/void, no markStatus
      expect(mockAccounting.postPendingTransfer).not.toHaveBeenCalled();
      expect(mockAccounting.voidPendingTransfer).not.toHaveBeenCalled();
      expect(mockSwaps.markStatus).not.toHaveBeenCalled();
    });
  });

  // ────────────────── advanceLeg: CLEAR on non-last leg ──────────────────

  describe('advanceLeg — CLEAR non-last leg', () => {
    it('posts leg1 pending; does NOT initiate leg2 (no executePendingTransfer, no markStatus)', async () => {
      // legs: leg1=SIGNING (about to go CLEAR), legs 2-4 CREATED
      const legs = [
        makeLegRow(1, 'SIGNING', 'CRYPTO'),
        makeLegRow(2, 'CREATED', 'FIAT'),
        makeLegRow(3, 'CREATED', 'FIAT'),
        makeLegRow(4, 'CREATED', 'FIAT'),
      ];

      // leg1 → CLEAR (leg1 is SIGNING, not CREATED, so no initiateLegPending)
      mockFundsFlow.transitionSwapLeg.mockResolvedValue({
        leg: { id: 'leg-1-id' },
        prevStatus: 'SIGNING',
        nextStatus: InternalFundStatus.CLEAR,
      });

      const svc = await buildModule(legs);
      await svc.advanceLeg(SWAP_NO, 1, InternalFundAction.CLEAR, 'admin-1');

      // leg1 has 2 accounting entries → 2 postPendingTransfer calls
      expect(mockAccounting.postPendingTransfer).toHaveBeenCalledTimes(2);
      // leg2 NOT initiated (no executePendingTransfer for the next leg)
      expect(mockAccounting.executePendingTransfer).not.toHaveBeenCalled();
      // swap NOT marked success yet
      expect(mockSwaps.markStatus).not.toHaveBeenCalled();
      // no audit for terminal status yet
      expect(mockAuditLogs.recordSystem).not.toHaveBeenCalled();
    });
  });

  // ────────────────── advanceLeg: CLEAR on last leg ──────────────────

  describe('advanceLeg — CLEAR last leg (leg4)', () => {
    it('marks swap SUCCESS, writes SWAP_SUCCEEDED audit, emits event after leg4 CLEAR', async () => {
      // legs 1-3 CLEAR, leg4 CONFIRMED (not CREATED, so no pending booking)
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

      const svc = await buildModule(legs);
      await svc.advanceLeg(SWAP_NO, 4, InternalFundAction.CLEAR, 'admin-1');

      expect(mockSwaps.markStatus).toHaveBeenCalledWith(SWAP_ID, 'SUCCESS', expect.anything());
      expect(mockAuditLogs.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.SWAP_SUCCEEDED,
          entityId: SWAP_ID,
          entityNo: SWAP_NO,
        }),
        expect.anything(),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'swap.succeeded',
        expect.objectContaining({ swapId: SWAP_ID, swapNo: SWAP_NO }),
      );
    });
  });

  // ────────────────── advanceLeg: FAIL ──────────────────

  describe('advanceLeg — FAIL', () => {
    it('voids leg pending, marks swap FAILED, writes SWAP_FAILED audit, no event emitted', async () => {
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

      const svc = await buildModule(legs);
      await svc.advanceLeg(SWAP_NO, 1, InternalFundAction.FAIL, 'admin-1');

      // leg1 has 2 entries → 2 voidPendingTransfer calls
      expect(mockAccounting.voidPendingTransfer).toHaveBeenCalledTimes(2);
      expect(mockSwaps.markStatus).toHaveBeenCalledWith(SWAP_ID, 'FAILED', expect.anything());
      expect(mockAuditLogs.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.SWAP_FAILED,
          entityId: SWAP_ID,
          entityNo: SWAP_NO,
        }),
        expect.anything(),
      );
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ────────────────── advanceLeg: intermediate hop (Fix C) ──────────────────

  describe('advanceLeg — intermediate hop', () => {
    it('advancing a non-CREATED leg to an intermediate status calls neither postPendingTransfer nor voidPendingTransfer nor markStatus', async () => {
      // leg1=SIGNING, advancing via BROADCAST → BROADCASTED (intermediate)
      const legs = [
        makeLegRow(1, 'SIGNING', 'CRYPTO'),
        makeLegRow(2, 'CREATED', 'FIAT'),
        makeLegRow(3, 'CREATED', 'FIAT'),
        makeLegRow(4, 'CREATED', 'FIAT'),
      ];

      mockFundsFlow.transitionSwapLeg.mockResolvedValue({
        leg: { id: 'leg-1-id' },
        prevStatus: 'SIGNING',
        nextStatus: InternalFundStatus.BROADCASTED,
      });

      const svc = await buildModule(legs);
      const result = await svc.advanceLeg(SWAP_NO, 1, InternalFundAction.BROADCAST, 'admin-1');

      // No accounting — just the status advance
      expect(mockAccounting.postPendingTransfer).not.toHaveBeenCalled();
      expect(mockAccounting.voidPendingTransfer).not.toHaveBeenCalled();
      expect(mockAccounting.executePendingTransfer).not.toHaveBeenCalled();
      expect(mockSwaps.markStatus).not.toHaveBeenCalled();
      expect(result).toBeDefined();
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

      const svc = await buildModule(legs);
      await expect(
        svc.advanceLeg(SWAP_NO, 2, InternalFundAction.CONFIRM, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when swap status is not SETTLING', async () => {
      mockSwaps.findByNoInternal.mockResolvedValue({ ...swapRow, status: 'SUCCESS' });

      const legs = [makeLegRow(1, 'CLEAR'), makeLegRow(2, 'CREATED'), makeLegRow(3, 'CREATED'), makeLegRow(4, 'CREATED')];
      const svc = await buildModule(legs);

      await expect(
        svc.advanceLeg(SWAP_NO, 1, InternalFundAction.SIGN, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
