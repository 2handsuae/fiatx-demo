import { Test, TestingModule } from '@nestjs/testing';
import { FundsAccountingService } from './funds-accounting.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

const TRADE_CLEARING_ID = 1111n;
const CUSTODY_ID = 2222n;
const BANK_ID = 4444n;
const FIRM_OPS_ID = 5555n;

const resolveById = ({ code }: { code: number }) => {
  if (code === TB_ACCOUNT_CODES.TRADE_CLEARING) return Promise.resolve(TRADE_CLEARING_ID);
  if (code === TB_ACCOUNT_CODES.CLIENT_BANK) return Promise.resolve(BANK_ID);
  if (code === TB_ACCOUNT_CODES.FIRM_TREASURY) return Promise.resolve(FIRM_OPS_ID);
  return Promise.resolve(CUSTODY_ID);
};

describe('mirrorPhysicalTransfer', () => {
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
    sourceType: 'EOD_SETTLEMENT',
    amount: '1000',
    asset: { currency: 'AED', decimals: 6, type: 'CRYPTO' },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      internalTransaction: {
        findUnique: jest.fn(),
      },
      // Default: no funds (non-route paths won't query this; route-path tests override)
      internalFund: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    accounting = {
      resolveTbAccountId: jest.fn(resolveById),
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 9n }),
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
    accounting.executeTransfer.mockResolvedValue({ tbTransferId: 9n });
    // Reset internalFund mock after clearAllMocks
    prisma.internalFund.findMany.mockResolvedValue([]);
  });

  it('INTERNAL_OUT (CRYPTO, decimals=6, amount=1000) → SETTLE_POOL_TO_FIRM: debit FIRM_TREASURY, credit CLIENT_CUSTODY', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({ pathLabel: 'INTERNAL_OUT', amount: '1000', asset: { currency: 'AED', decimals: 6, type: 'CRYPTO' } }),
    );

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: true, tbTransferId: 9n });
    expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
    const call = accounting.executeTransfer.mock.calls[0][0];
    // POOL_TO_FIRM: debit FIRM_TREASURY, credit pool (CLIENT_CUSTODY for CRYPTO)
    expect(call.debitAccountId).toBe(FIRM_OPS_ID);
    expect(call.creditAccountId).toBe(CUSTODY_ID);
    expect(call.amount).toBe(1000_000000n); // 1000 * 10^6
    expect(call.code).toBe(TB_TRANSFER_CODES.SETTLE_POOL_TO_FIRM);
    expect(call.evidence.eventCode).toBe('SETTLE_POOL_TO_FIRM');
  });

  it('FIAT_SETTLE_IN (FIAT, decimals=2) → SETTLE_FIRM_TO_POOL: debit CLIENT_BANK, credit FIRM_TREASURY', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        pathLabel: 'FIAT_SETTLE_IN',
        sourceType: 'FIAT_SETTLEMENT',
        amount: '50.25',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );
    // FIAT_SETTLE_IN has a route → all hops must be CLEAR to proceed
    prisma.internalFund.findMany.mockResolvedValue([
      { status: 'CLEAR' },
      { status: 'CLEAR' },
    ]);

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: true, tbTransferId: 9n });
    const call = accounting.executeTransfer.mock.calls[0][0];
    // FIRM_TO_POOL: debit pool (CLIENT_BANK for FIAT), credit FIRM_TREASURY
    expect(call.debitAccountId).toBe(BANK_ID);
    expect(call.creditAccountId).toBe(FIRM_OPS_ID);
    expect(call.amount).toBe(5025n); // 50.25 * 10^2
    expect(call.code).toBe(TB_TRANSFER_CODES.SETTLE_FIRM_TO_POOL);
    expect(call.evidence.eventCode).toBe('SETTLE_FIRM_TO_POOL');
  });

  it('FEE_COLLECT → FEE_DECOMMINGLE code, direction POOL_TO_FIRM', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        pathLabel: 'FEE_COLLECT',
        sourceType: 'FEE_COLLECTION',
        amount: '5',
        asset: { currency: 'AED', decimals: 6, type: 'CRYPTO' },
      }),
    );

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: true, tbTransferId: 9n });
    const call = accounting.executeTransfer.mock.calls[0][0];
    expect(call.debitAccountId).toBe(FIRM_OPS_ID);
    expect(call.creditAccountId).toBe(CUSTODY_ID);
    expect(call.code).toBe(TB_TRANSFER_CODES.FEE_DECOMMINGLE);
    expect(call.evidence.eventCode).toBe('FEE_DECOMMINGLE');
  });

  it('FIAT_SPREAD_COLLECT (no mirror) → tbApplied:false, executeTransfer never called', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        pathLabel: 'FIAT_SPREAD_COLLECT',
        sourceType: 'FIAT_FEE_COLLECTION',
        amount: '2',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: false });
    expect(accounting.executeTransfer).not.toHaveBeenCalled();
  });

  it('amount=0 → tbApplied:false, executeTransfer never called', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({ pathLabel: 'INTERNAL_OUT', amount: '0', asset: { currency: 'AED', decimals: 6, type: 'CRYPTO' } }),
    );

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: false });
    expect(accounting.executeTransfer).not.toHaveBeenCalled();
  });

  it('FIAT_SETTLE_IN (2-hop route) with mixed statuses [CLEAR, CREATED] → tbApplied:false, executeTransfer not called', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        pathLabel: 'FIAT_SETTLE_IN',
        sourceType: 'FIAT_SETTLEMENT',
        amount: '50.25',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );
    // The prisma mock must support internalFund.findMany on the same object
    prisma.internalFund = {
      findMany: jest.fn().mockResolvedValue([
        { status: 'CLEAR' },
        { status: 'CREATED' },
      ]),
    };

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: false });
    expect(accounting.executeTransfer).not.toHaveBeenCalled();
  });

  it('FIAT_SETTLE_IN (2-hop route) with all hops CLEAR [CLEAR, CLEAR] → mirrors normally', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(
      transfer({
        pathLabel: 'FIAT_SETTLE_IN',
        sourceType: 'FIAT_SETTLEMENT',
        amount: '50.25',
        asset: { currency: 'AED', decimals: 2, type: 'FIAT' },
      }),
    );
    prisma.internalFund = {
      findMany: jest.fn().mockResolvedValue([
        { status: 'CLEAR' },
        { status: 'CLEAR' },
      ]),
    };

    const result = await service.mirrorPhysicalTransfer({ internalTransferId: 'it-1' });

    expect(result).toEqual({ tbApplied: true, tbTransferId: 9n });
    expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
    const call = accounting.executeTransfer.mock.calls[0][0];
    expect(call.debitAccountId).toBe(BANK_ID);
    expect(call.creditAccountId).toBe(FIRM_OPS_ID);
    expect(call.amount).toBe(5025n);
  });
});
