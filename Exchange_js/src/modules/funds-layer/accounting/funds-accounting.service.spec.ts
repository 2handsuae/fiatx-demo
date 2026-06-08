import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { FundsAccountingService } from './funds-accounting.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { AccountingClass } from '../constants/internal-transfer-paths.constant';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

const TRADE_CLEARING_ID = 1111n;
const CUSTODY_ID = 2222n;
const FEE_RECEIVABLE_ID = 3333n;
const BANK_ID = 4444n;

const resolveById = ({ code }: { code: number }) => {
  if (code === TB_ACCOUNT_CODES.TRADE_CLEARING) return Promise.resolve(TRADE_CLEARING_ID);
  if (code === TB_ACCOUNT_CODES.FEE_RECEIVABLE) return Promise.resolve(FEE_RECEIVABLE_ID);
  if (code === TB_ACCOUNT_CODES.BANK) return Promise.resolve(BANK_ID);
  return Promise.resolve(CUSTODY_ID);
};

describe('FundsAccountingService', () => {
  let service: FundsAccountingService;
  let prisma: any;
  let accounting: any;

  const transfer = (overrides: Record<string, any> = {}) => ({
    id: 'it-1',
    internalTxNo: 'IT0001',
    pathLabel: 'INTERNAL_OUT',
    accountingClass: 'B',
    assetId: 'asset-1',
    traceId: 'SETTLE:BATCH1',
    asset: { currency: 'AED', decimals: 2, type: 'CRYPTO' },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      internalTransaction: {
        findUnique: jest.fn(),
      },
    };
    accounting = {
      resolveTbAccountId: jest.fn(resolveById),
      lookupBalance: jest.fn(),
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FundsAccountingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountingService, useValue: accounting },
      ],
    }).compile();

    service = moduleRef.get(FundsAccountingService);
    jest.clearAllMocks();
    accounting.resolveTbAccountId.mockImplementation(resolveById);
    accounting.executeTransfer.mockResolvedValue({ tbTransferId: 1n });
  });

  it('A-class returns tbApplied:false and never touches TB', async () => {
    const result = await service.applyAccounting({
      accountingClass: AccountingClass.A,
      internalTransferId: 'it-a',
    });
    expect(result).toEqual({ tbApplied: false });
    expect(accounting.executeTransfer).not.toHaveBeenCalled();
    expect(accounting.lookupBalance).not.toHaveBeenCalled();
  });

  it('B-class INTERNAL_OUT with TRADE_CLEARING net CREDIT drains OUT (debit TRADE_CLEARING → credit CUSTODY)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(transfer({ pathLabel: 'INTERNAL_OUT' }));
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 200n,
      creditsPosted: 500n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    const result = await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
    });

    expect(accounting.lookupBalance).toHaveBeenCalledWith(TRADE_CLEARING_ID);
    expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
    const call = accounting.executeTransfer.mock.calls[0][0];
    expect(call.debitAccountId).toBe(TRADE_CLEARING_ID);
    expect(call.creditAccountId).toBe(CUSTODY_ID);
    expect(call.amount).toBe(300n);
    expect(call.ledger).toBe(TB_LEDGERS.AED);
    expect(call.code).toBe(TB_TRANSFER_CODES.EOD_DRAIN_OUT);
    expect(result).toEqual({ tbApplied: true, tbTransferId: 1n });
  });

  it('B-class INTERNAL_IN with TRADE_CLEARING net DEBIT drains IN (debit CUSTODY → credit TRADE_CLEARING)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(transfer({ pathLabel: 'INTERNAL_IN' }));
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 500n,
      creditsPosted: 200n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    const result = await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
    });

    expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
    const call = accounting.executeTransfer.mock.calls[0][0];
    expect(call.debitAccountId).toBe(CUSTODY_ID);
    expect(call.creditAccountId).toBe(TRADE_CLEARING_ID);
    expect(call.amount).toBe(300n);
    expect(call.code).toBe(TB_TRANSFER_CODES.EOD_DRAIN_IN);
    expect(result).toEqual({ tbApplied: true, tbTransferId: 1n });
  });

  it('B-class with net-zero TRADE_CLEARING balance does NOT drain', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(transfer({ pathLabel: 'INTERNAL_OUT' }));
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 400n,
      creditsPosted: 400n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    const result = await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
    });

    expect(accounting.executeTransfer).not.toHaveBeenCalled();
    expect(result).toEqual({ tbApplied: false });
  });

  it('B-class FEE_COLLECT (FEE_RECEIVABLE net CREDIT) drains OUT (debit FEE_RECEIVABLE → credit CUSTODY) with FEE_DRAIN code', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(transfer({ pathLabel: 'FEE_COLLECT' }));
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 0n,
      creditsPosted: 500n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    const result = await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
    });

    expect(accounting.lookupBalance).toHaveBeenCalledWith(FEE_RECEIVABLE_ID);
    expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
    const call = accounting.executeTransfer.mock.calls[0][0];
    expect(call.debitAccountId).toBe(FEE_RECEIVABLE_ID);
    expect(call.creditAccountId).toBe(CUSTODY_ID);
    expect(call.amount).toBe(500n);
    expect(call.ledger).toBe(TB_LEDGERS.AED);
    expect(call.code).toBe(TB_TRANSFER_CODES.FEE_DRAIN);
    expect(call.evidence.sourceType).toBe('FEE_COLLECTION');
    expect(result).toEqual({ tbApplied: true, tbTransferId: 1n });
  });

  it('B-class FEE_COLLECT with net-zero FEE_RECEIVABLE balance does NOT drain', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(transfer({ pathLabel: 'FEE_COLLECT' }));
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 0n,
      creditsPosted: 0n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    const result = await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
    });

    expect(accounting.executeTransfer).not.toHaveBeenCalled();
    expect(result).toEqual({ tbApplied: false });
  });

  it('reads the transfer via the passed tx client (not outer prisma) and threads tx into executeTransfer', async () => {
    const tx = {
      internalTransaction: {
        findUnique: jest.fn().mockResolvedValue(transfer({ pathLabel: 'INTERNAL_OUT' })),
      },
    } as any;
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 0n,
      creditsPosted: 300n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    const result = await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
      tx,
    });

    // the just-created (uncommitted) row is read through tx, not outer prisma
    expect(tx.internalTransaction.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.internalTransaction.findUnique).not.toHaveBeenCalled();
    // executeTransfer must run inside the same atomic tx
    expect(accounting.executeTransfer.mock.calls[0][0].tx).toBe(tx);
    expect(result).toEqual({ tbApplied: true, tbTransferId: 1n });
  });

  it('FIAT B-class drain resolves the counterparty as BANK, not CUSTODY', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        pathLabel: 'FIAT_SETTLE_OUT',
        sourceType: 'FIAT_SETTLEMENT',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 0n,
      creditsPosted: 600n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    await service.applyAccounting({ accountingClass: AccountingClass.B, internalTransferId: 't-fiat' });

    const resolvedCodes = accounting.resolveTbAccountId.mock.calls.map((c: any) => c[0].code);
    expect(resolvedCodes).toContain(TB_ACCOUNT_CODES.BANK);
    expect(resolvedCodes).not.toContain(TB_ACCOUNT_CODES.CUSTODY);

    const call = accounting.executeTransfer.mock.calls[0][0];
    expect(call.creditAccountId).toBe(BANK_ID);
    expect(call.debitAccountId).toBe(TRADE_CLEARING_ID);
    expect(call.amount).toBe(600n);
    // TB evidence attributes the drain to fiat settlement, not EOD
    expect(call.evidence.sourceType).toBe('FIAT_SETTLEMENT');
  });

  it('passes EOD evidence (sourceNo=internalTxNo, traceId, SYSTEM actor)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(transfer({ pathLabel: 'INTERNAL_OUT' }));
    accounting.lookupBalance.mockResolvedValue({
      debitsPosted: 0n,
      creditsPosted: 100n,
      debitsPending: 0n,
      creditsPending: 0n,
    });

    await service.applyAccounting({
      accountingClass: AccountingClass.B,
      internalTransferId: 'it-1',
    });

    const evidence = accounting.executeTransfer.mock.calls[0][0].evidence;
    expect(evidence).toEqual(
      expect.objectContaining({
        sourceType: 'EOD_SETTLEMENT',
        sourceNo: 'IT0001',
        eventCode: 'EOD_DRAIN_OUT',
        traceId: 'SETTLE:BATCH1',
        assetCurrency: 'AED',
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
      }),
    );
  });

  it('drainFeeReceivableAmount posts FEE_RECEIVABLE->BANK for the given amount (FIAT)', async () => {
    // Arrange: a transfer 't-fee' with asset { type:'FIAT', currency:'AED', decimals:2 }, amount irrelevant.
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        id: 't-fee',
        internalTxNo: 'IT0099',
        traceId: 'FEE:IT0099',
        sourceType: 'FIAT_FEE_COLLECTION',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );

    await service.drainFeeReceivableAmount({ internalTransferId: 't-fee', amount: new Prisma.Decimal('0.18') });

    const codes = accounting.resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toContain(TB_ACCOUNT_CODES.FEE_RECEIVABLE);
    expect(codes).toContain(TB_ACCOUNT_CODES.BANK);
    const xfer = accounting.executeTransfer.mock.calls[0][0];
    expect(xfer.amount).toBe(18n); // 0.18 AED at 2 decimals
    // evidence sourceType must come from the transfer, not be hardcoded
    expect(xfer.evidence.sourceType).toBe('FIAT_FEE_COLLECTION');
    expect(xfer.evidence.memo).toBe('FIAT_FEE_COLLECTION FEE_RECEIVABLE drain');
  });

  it('drainFeeReceivableAmount TRUNCATES sub-cent precision (0.36725 AED @ 2dp → 36n, not 37n)', async () => {
    // Reproduces the over-drain bug: 0.36725 rounds to 0.37 (37 units) but was
    // accrued as 0.36 (36 units, truncated). The fix must give 36n.
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        id: 't-fee-trunc',
        internalTxNo: 'IT0100',
        traceId: 'FEE:IT0100',
        sourceType: 'FIAT_FEE_COLLECTION',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );

    await service.drainFeeReceivableAmount({
      internalTransferId: 't-fee-trunc',
      amount: new Prisma.Decimal('0.36725'),
    });

    const xfer = accounting.executeTransfer.mock.calls[0][0];
    expect(xfer.amount).toBe(36n); // truncated, NOT rounded to 37n
  });
});
