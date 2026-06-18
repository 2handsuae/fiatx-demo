import { Prisma } from '@prisma/client';
import { BalanceSnapshotService } from './balance-snapshot.service';

describe('BalanceSnapshotService', () => {
  let prisma: any;
  let svc: BalanceSnapshotService;

  beforeEach(() => {
    prisma = { tbTransferEvidence: { findMany: jest.fn() } };
    svc = new BalanceSnapshotService(prisma);
  });

  it('reconstructs asset balance as debit_net, filtered POSTED + before cutoff', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal(100), assetCode: 'USDT' },
      { debitCode: 'L.CLIENT_PAYABLE', creditCode: 'A.CLIENT_CUSTODY', amount: new Prisma.Decimal(30), assetCode: 'USDT' },
    ]);
    const bal = await svc.balancesAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    // CLIENT_CUSTODY debit_net = 100 - 30 = 70（asset → balance = debit_net = 70）
    expect(bal['A.CLIENT_CUSTODY'].toString()).toBe('70');
    // CLIENT_PAYABLE on debit side: debit_net = +30 → balance(L) = -debit_net = -30
    expect(bal['L.CLIENT_PAYABLE'].toString()).toBe('-30');
    // DEPOSIT_SUSPENSE on credit side: debit_net = -100 → balance(L) = -debit_net = 100
    expect(bal['L.DEPOSIT_SUSPENSE'].toString()).toBe('100');
  });
});
