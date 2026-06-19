import { Prisma } from '@prisma/client';
import { BalanceSnapshotService } from './balance-snapshot.service';

describe('BalanceSnapshotService', () => {
  let prisma: any;
  let svc: BalanceSnapshotService;

  beforeEach(() => {
    prisma = { tbTransferEvidence: { findMany: jest.fn() }, asset: { findFirst: jest.fn().mockResolvedValue({ decimals: 0 }) } };
    svc = new BalanceSnapshotService(prisma);
  });

  it('reconstructs asset balance as debit_net, filtered POSTED + before cutoff', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal(100), assetCode: 'USDT' },
      { debitCode: 'L.CLIENT_PAYABLE', creditCode: 'A.CLIENT_CUSTODY', amount: new Prisma.Decimal(30), assetCode: 'USDT' },
    ]);
    // decimals=0 → scale=1 → 数值不变
    const bal = await svc.balancesAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    // CLIENT_CUSTODY debit_net = 100 - 30 = 70（asset → balance = debit_net = 70）
    expect(bal['A.CLIENT_CUSTODY'].toString()).toBe('70');
    // CLIENT_PAYABLE on debit side: debit_net = +30 → balance(L) = -debit_net = -30
    expect(bal['L.CLIENT_PAYABLE'].toString()).toBe('-30');
    // DEPOSIT_SUSPENSE on credit side: debit_net = -100 → balance(L) = -debit_net = 100
    expect(bal['L.DEPOSIT_SUSPENSE'].toString()).toBe('100');
  });

  it('scales TigerBeetle smallest-unit amounts back to human-decimal by asset.decimals', async () => {
    // tb_transfer_evidence.amount 以最小单位存储（USDT ×10^6）。decimals=6 → 缩放回 human。
    prisma.asset.findFirst.mockResolvedValue({ decimals: 6 });
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal('1794150136'), assetCode: 'USDT' },
    ]);
    const bal = await svc.balancesAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    expect(bal['A.CLIENT_CUSTODY'].toString()).toBe('1794.150136');
    // DEPOSIT_SUSPENSE 在 credit 侧：debit_net = -1794150136 → balance(L) = +1794150136 → 缩放 +1794.150136
    expect(bal['L.DEPOSIT_SUSPENSE'].toString()).toBe('1794.150136');
  });
});
