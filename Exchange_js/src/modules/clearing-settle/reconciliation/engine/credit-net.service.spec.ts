import { Prisma } from '@prisma/client';
import { CreditNetService } from './credit-net.service';

describe('CreditNetService', () => {
  let prisma: any;
  let svc: CreditNetService;

  beforeEach(() => {
    prisma = {
      tbTransferEvidence: { findMany: jest.fn() },
      asset: { findFirst: jest.fn().mockResolvedValue({ decimals: 0 }) },
    };
    svc = new CreditNetService(prisma);
  });

  it('cn = Σcredit − Σdebit per code (credit-positive), POSTED + before cutoff', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      // 借 CLIENT_CUSTODY / 贷 DEPOSIT_SUSPENSE = 100
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal(100) },
      // 借 CLIENT_PAYABLE / 贷 CLIENT_CUSTODY = 30
      { debitCode: 'L.CLIENT_PAYABLE', creditCode: 'A.CLIENT_CUSTODY', amount: new Prisma.Decimal(30) },
    ]);
    const cn = await svc.creditNetAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    // CLIENT_CUSTODY: credit 30 − debit 100 = −70
    expect(cn['A.CLIENT_CUSTODY'].toString()).toBe('-70');
    // DEPOSIT_SUSPENSE: credit 100 − debit 0 = +100
    expect(cn['L.DEPOSIT_SUSPENSE'].toString()).toBe('100');
    // CLIENT_PAYABLE: credit 0 − debit 30 = −30
    expect(cn['L.CLIENT_PAYABLE'].toString()).toBe('-30');
  });

  it('same-currency cn over all accounts sums to 0 (double-entry → 式1 trivially holds)', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal(100) },
      { debitCode: 'L.CLIENT_PAYABLE', creditCode: 'A.CLIENT_CUSTODY', amount: new Prisma.Decimal(30) },
      { debitCode: 'A.FIRM_TREASURY', creditCode: 'R.FEE_INCOME', amount: new Prisma.Decimal(5) },
    ]);
    const cn = await svc.creditNetAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    const total = Object.values(cn).reduce((s, v) => s.plus(v), new Prisma.Decimal(0));
    expect(total.toString()).toBe('0');
  });

  it('scales TigerBeetle smallest-unit amounts back to human-decimal by asset.decimals', async () => {
    prisma.asset.findFirst.mockResolvedValue({ decimals: 6 });
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal('1794150136') },
    ]);
    const cn = await svc.creditNetAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    // CLIENT_CUSTODY debit → −1794150136 / 1e6 = −1794.150136
    expect(cn['A.CLIENT_CUSTODY'].toString()).toBe('-1794.150136');
    // DEPOSIT_SUSPENSE credit → +1794150136 / 1e6 = +1794.150136
    expect(cn['L.DEPOSIT_SUSPENSE'].toString()).toBe('1794.150136');
  });

  it('passes the POSTED + createdAt<cutoff filter into the query', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([]);
    const cutoff = new Date('2026-06-17T00:00:00Z');
    await svc.creditNetAtCutoff('AED', cutoff);
    const arg = prisma.tbTransferEvidence.findMany.mock.calls[0][0];
    expect(arg.where.assetCode).toBe('AED');
    expect(arg.where.transferType).toBe('POSTED');
    expect(arg.where.createdAt.lt).toBe(cutoff);
  });
});
