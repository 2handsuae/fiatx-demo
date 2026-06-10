import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { FxEodService, EodAccountingReport } from './fx-eod.service';

/** Deterministic fake TB account id from (code, ledger) for mock resolution. */
const acct = (code: number, ledger: number) => BigInt(code) * 100n + BigInt(ledger);

const AED = 1;
const USDT = 2;

describe('FxEodService', () => {
  let service: FxEodService;
  let balances: Map<bigint, { debitsPosted: bigint; creditsPosted: bigint }>;
  let prisma: {
    asset: { findMany: jest.Mock; findFirst: jest.Mock };
    outstanding: { findMany: jest.Mock };
    swapTransaction: { findMany: jest.Mock };
    tbTransferEvidence: { count: jest.Mock };
    tbAccountRegistry: { findMany: jest.Mock };
  };
  let accounting: {
    resolveTbAccountId: jest.Mock;
    lookupBalance: jest.Mock;
    executeTransfer: jest.Mock;
  };
  let rateProvider: { fetchRate: jest.Mock };

  const assets = [
    { id: 'a-usdt', currency: 'USDT', decimals: 6, type: 'CRYPTO' },
    { id: 'a-aed', currency: 'AED', decimals: 2, type: 'FIAT' },
  ];

  const setBalance = (id: bigint, b: { debits?: bigint; credits?: bigint }) => {
    balances.set(id, { debitsPosted: b.debits ?? 0n, creditsPosted: b.credits ?? 0n });
  };

  const emptyReport = (): EodAccountingReport => ({ sweeps: [], revals: [], violations: [] });

  beforeEach(async () => {
    balances = new Map();
    prisma = {
      asset: {
        findMany: jest.fn().mockResolvedValue(assets),
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(assets.find((a) => a.currency === where.currency) ?? null),
        ),
      },
      outstanding: { findMany: jest.fn().mockResolvedValue([]) },
      swapTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      tbTransferEvidence: { count: jest.fn().mockResolvedValue(0) },
      tbAccountRegistry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    accounting = {
      resolveTbAccountId: jest.fn(({ code, ledger }: any) => Promise.resolve(acct(code, ledger))),
      lookupBalance: jest.fn((id: bigint) =>
        Promise.resolve({
          ...(balances.get(id) ?? { debitsPosted: 0n, creditsPosted: 0n }),
          debitsPending: 0n,
          creditsPending: 0n,
        }),
      ),
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
    };
    rateProvider = { fetchRate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxEodService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountingService, useValue: accounting },
        { provide: BinanceRateProvider, useValue: rateProvider },
      ],
    }).compile();

    service = module.get(FxEodService);
  });

  describe('sweepBridges', () => {
    it('bridge net CREDIT with no open swaps → sweeps OUT into FX_POSITION (code 60)', async () => {
      // USDT bridge: +1000 (decimals 6)
      setBalance(acct(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), { credits: 1000_000000n });

      const report = emptyReport();
      await service.sweepBridges('OSB-1', report);

      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: acct(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT),
          creditAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, USDT),
          amount: 1000_000000n,
          ledger: USDT,
          code: TB_TRANSFER_CODES.BRIDGE_SWEEP_OUT,
        }),
      );
      expect(report.sweeps).toEqual([
        { currency: 'USDT', amountUnits: '1000000000', direction: 'OUT' },
      ]);
    });

    it('bridge net DEBIT → sweeps IN from FX_POSITION (code 61)', async () => {
      // AED bridge: −3672.50 (decimals 2)
      setBalance(acct(TB_ACCOUNT_CODES.TRADE_CLEARING, AED), { debits: 367250n });

      const report = emptyReport();
      await service.sweepBridges('OSB-1', report);

      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
          creditAccountId: acct(TB_ACCOUNT_CODES.TRADE_CLEARING, AED),
          amount: 367250n,
          ledger: AED,
          code: TB_TRANSFER_CODES.BRIDGE_SWEEP_IN,
        }),
      );
      expect(report.sweeps).toEqual([
        { currency: 'AED', amountUnits: '367250', direction: 'IN' },
      ]);
    });

    it('deducts open swap bridge contributions — only the settled residue is swept', async () => {
      // USDT bridge +1500; one open swap contributes +500 (from-leg) / −1836.25 AED (to-leg)
      setBalance(acct(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), { credits: 1500_000000n });
      setBalance(acct(TB_ACCOUNT_CODES.TRADE_CLEARING, AED), { debits: 183625n });
      prisma.outstanding.findMany.mockResolvedValue([{ swapTransactionId: 's1' }]);
      prisma.swapTransaction.findMany.mockResolvedValue([
        {
          fromAmount: '500',
          toAmount: '1836.25',
          spreadAmount: '0',
          fromAsset: { currency: 'USDT', decimals: 6 },
          toAsset: { currency: 'AED', decimals: 2 },
        },
      ]);

      const report = emptyReport();
      await service.sweepBridges('OSB-1', report);

      // USDT: 1500 − 500 open = 1000 swept; AED: −183625 − (−183625) = 0 → skipped.
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: acct(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT),
          creditAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, USDT),
          amount: 1000_000000n,
          code: TB_TRANSFER_CODES.BRIDGE_SWEEP_OUT,
        }),
      );
    });
  });

  describe('revalueFxPositions', () => {
    it('marks a LOSS when fixing moved below position cost (delta > 0, code 62)', async () => {
      // FX long: USDT leg +1000, AED leg −3672.50; fixing 3.65 → target −3650 → delta +22.50
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, USDT), { credits: 1000_000000n });
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, AED), { debits: 367250n });
      rateProvider.fetchRate.mockResolvedValue({ rate: new Prisma.Decimal('3.65') });

      const report = emptyReport();
      await service.revalueFxPositions('OSB-1', report);

      expect(rateProvider.fetchRate).toHaveBeenCalledWith('USDT', 'AED');
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: acct(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED),
          creditAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
          amount: 2250n,
          ledger: AED,
          code: TB_TRANSFER_CODES.FX_REVAL_LOSS,
        }),
      );
      expect(report.revals).toEqual([
        { currency: 'USDT', fixing: '3.65', deltaUnits: '2250', direction: 'LOSS' },
      ]);
    });

    it('marks a GAIN when fixing moved above position cost (delta < 0, code 63)', async () => {
      // fixing 3.70 → target −3700 → delta = −370000 − (−367250) = −2750 → gain 27.50
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, USDT), { credits: 1000_000000n });
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, AED), { debits: 367250n });
      rateProvider.fetchRate.mockResolvedValue({ rate: new Prisma.Decimal('3.70') });

      const report = emptyReport();
      await service.revalueFxPositions('OSB-1', report);

      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debitAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
          creditAccountId: acct(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED),
          amount: 2750n,
          ledger: AED,
          code: TB_TRANSFER_CODES.FX_REVAL_GAIN,
        }),
      );
      expect(report.revals).toEqual([
        { currency: 'USDT', fixing: '3.7', deltaUnits: '2750', direction: 'GAIN' },
      ]);
    });

    it('posts nothing when all position legs are flat', async () => {
      const report = emptyReport();
      await service.revalueFxPositions('OSB-1', report);

      expect(rateProvider.fetchRate).not.toHaveBeenCalled();
      expect(accounting.executeTransfer).not.toHaveBeenCalled();
      expect(report.revals).toEqual([]);
    });
  });

  describe('realizeFxPosition', () => {
    it('fully closes a LONG position against the LP fill: 4 legs in order', async () => {
      // Long +1000 USDT, AED cost basis 3672.50 (net debit), unrealized loss 22.50, fill 3.62.
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, USDT), { credits: 1000_000000n });
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, AED), { debits: 367250n });
      setBalance(acct(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED), { debits: 2250n });

      await service.realizeFxPosition({
        currency: 'USDT',
        fillRate: new Prisma.Decimal('3.62'),
        operatorId: 'op-1',
      });

      expect(accounting.executeTransfer).toHaveBeenCalledTimes(4);
      const calls = accounting.executeTransfer.mock.calls.map((c) => c[0]);

      // ① currency leg: deliver 1000 USDT to LP → debit FX_POSITION(USDT) / credit FIRM_OPS(USDT)
      expect(calls[0]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, USDT),
        creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, USDT),
        amount: 1000_000000n,
        ledger: USDT,
        code: TB_TRANSFER_CODES.FX_REALIZE,
      });
      // ② proceeds 1000 × 3.62 = 3620.00 → debit FIRM_OPS(AED) / credit FX_POSITION(AED)
      expect(calls[1]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, AED),
        creditAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
        amount: 362000n,
        ledger: AED,
        code: TB_TRANSFER_CODES.FX_REALIZE,
      });
      // ③ residual 3672.50 − 3620.00 = 52.50 loss → debit FX_REALIZED / credit FX_POSITION(AED)
      expect(calls[2]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FX_REALIZED_PNL, AED),
        creditAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
        amount: 5250n,
        ledger: AED,
        code: TB_TRANSFER_CODES.FX_REALIZE,
      });
      // ④ rotate unrealized loss 22.50 → debit FX_REALIZED / credit FX_UNREALIZED
      expect(calls[3]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FX_REALIZED_PNL, AED),
        creditAccountId: acct(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED),
        amount: 2250n,
        ledger: AED,
        code: TB_TRANSFER_CODES.FX_REALIZE,
      });
    });

    it('fully closes a SHORT position with a realized GAIN (bought back cheaper)', async () => {
      // Short −1000 USDT, AED leg +3672.50 (net credit, received when sold), fill 3.62
      // → pays 3620.00 to buy back → gain 52.50 → debit FX_POSITION(AED) / credit FX_REALIZED.
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, USDT), { debits: 1000_000000n });
      setBalance(acct(TB_ACCOUNT_CODES.FX_POSITION, AED), { credits: 367250n });

      await service.realizeFxPosition({
        currency: 'USDT',
        fillRate: new Prisma.Decimal('3.62'),
        operatorId: 'op-1',
      });

      expect(accounting.executeTransfer).toHaveBeenCalledTimes(3);
      const calls = accounting.executeTransfer.mock.calls.map((c) => c[0]);

      // ① receive 1000 USDT from LP → debit FIRM_OPS(USDT) / credit FX_POSITION(USDT)
      expect(calls[0]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, USDT),
        creditAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, USDT),
        amount: 1000_000000n,
        ledger: USDT,
      });
      // ② pay 3620.00 AED to LP → debit FX_POSITION(AED) / credit FIRM_OPS(AED)
      expect(calls[1]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
        creditAccountId: acct(TB_ACCOUNT_CODES.FIRM_OPS, AED),
        amount: 362000n,
        ledger: AED,
      });
      // ③ residual +52.50 still credit on AED leg → gain
      expect(calls[2]).toMatchObject({
        debitAccountId: acct(TB_ACCOUNT_CODES.FX_POSITION, AED),
        creditAccountId: acct(TB_ACCOUNT_CODES.FX_REALIZED_PNL, AED),
        amount: 5250n,
        ledger: AED,
      });
    });
  });

  describe('checkInvariants', () => {
    it('I1: client pool ≠ Σ client claims → violation reported', async () => {
      // USDT pool holds 1000, but claims only total 900.
      setBalance(acct(TB_ACCOUNT_CODES.CLIENT_CUSTODY, USDT), { debits: 1000_000000n });
      prisma.tbAccountRegistry.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.ledger === USDT ? [{ tbAccountId: 'aa' }] : []),
      );
      setBalance(0xaan, { credits: 900_000000n });

      const report = emptyReport();
      await service.checkInvariants(report);

      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]).toMatchObject({ invariant: 'I1', currency: 'USDT' });
    });

    it('I2: bridge residue ≠ open swap contributions → violation reported', async () => {
      // USDT bridge holds 500 but no open swaps remain → unswept residue.
      setBalance(acct(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), { credits: 500n });

      const report = emptyReport();
      await service.checkInvariants(report);

      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]).toMatchObject({ invariant: 'I2', currency: 'USDT' });
    });

    it('balanced books → no violations', async () => {
      const report = emptyReport();
      await service.checkInvariants(report);
      expect(report.violations).toEqual([]);
    });
  });

  describe('runEodAccounting', () => {
    it('runs sweep → reval → invariants and returns the report', async () => {
      const report = await service.runEodAccounting('OSB-9');
      expect(report).toEqual({ sweeps: [], revals: [], violations: [] });
      expect(accounting.executeTransfer).not.toHaveBeenCalled();
    });
  });
});
