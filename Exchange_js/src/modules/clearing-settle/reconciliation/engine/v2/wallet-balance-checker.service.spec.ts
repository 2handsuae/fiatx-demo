import { Prisma } from '@prisma/client';
import { WalletBalanceCheckerService } from './wallet-balance-checker.service';

// ---- Helpers ----------------------------------------------------------------

const D = (n: string | number) => new Prisma.Decimal(n);

// Customer wallet's three account legs:
//   acct-pay   = code 100 (CLIENT_PAYABLE) owned by CUSTOMER c-001
//   acct-susp  = code 101 (DEPOSIT_SUSPENSE) owned by CUSTOMER c-001
//   acct-asset = code 1   (CLIENT_ASSET) aggregate, owned by SYSTEM
// All three are tagged with the same walletRef when DEPOSIT_ASSET_TO_SUSPENSE
// fires (see T2a in deposit-workflow.service), so a walletRef query brings
// back the SYSTEM-owned aggregate leg too — we must filter it out.
const REG_CUSTOMER = {
  'acct-pay':   { tbAccountId: 'acct-pay',   code: 100, ownerType: 'CUSTOMER', ownerNo: 'c-001', assetCode: 'USDT' },
  'acct-susp':  { tbAccountId: 'acct-susp',  code: 101, ownerType: 'CUSTOMER', ownerNo: 'c-001', assetCode: 'USDT' },
  'acct-asset': { tbAccountId: 'acct-asset', code: 1,   ownerType: 'SYSTEM',   ownerNo: null,    assetCode: 'USDT' },
};

// Firm wallet's account leg:
//   acct-ops = code 200 (FIRM_OPS) owned by SYSTEM (firm equity is SYSTEM-owned)
const REG_FIRM = {
  'acct-ops':   { tbAccountId: 'acct-ops',   code: 200, ownerType: 'SYSTEM', ownerNo: 'FIRM_OPS_USDT', assetCode: 'USDT' },
  // Aggregate firm asset leg that may also share walletRef
  'acct-fasset':{ tbAccountId: 'acct-fasset',code: 50,  ownerType: 'SYSTEM', ownerNo: null,           assetCode: 'USDT' },
};

function makePrismaMock(opts: {
  flows: Array<{
    tbAccountId: string;
    direction: 'IN' | 'OUT';
    amount: string | number;
    walletRef: string;
    createdAt: Date;
    transferType?: string;
  }>;
  registry: Record<string, any>;
}) {
  return {
    accountFlow: {
      findMany: jest.fn(async ({ where }: any) => {
        return opts.flows.filter((f) => {
          if (where.walletRef && f.walletRef !== where.walletRef) return false;
          if (where.transferType && (f.transferType ?? 'POSTED') !== where.transferType) return false;
          if (where.createdAt?.lte && f.createdAt > where.createdAt.lte) return false;
          return true;
        }).map((f) => ({
          ...f,
          amount: new Prisma.Decimal(f.amount),
          transferType: f.transferType ?? 'POSTED',
        }));
      }),
    },
    tbAccountRegistry: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.tbAccountId?.in ?? [];
        return ids.map((id) => opts.registry[id]).filter(Boolean);
      }),
    },
  };
}

// ---- Tests ------------------------------------------------------------------

describe('WalletBalanceCheckerService', () => {
  const cutoff = new Date('2026-06-26T12:00:00Z');

  it('customer wallet: external == PAYABLE + SUSPENSE → pass=true, delta=0', async () => {
    const prisma = makePrismaMock({
      // PAYABLE=800 (1000 in − 200 out), SUSPENSE=200 (200 in)
      flows: [
        { tbAccountId: 'acct-susp',  direction: 'IN',  amount: 1000, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        { tbAccountId: 'acct-susp',  direction: 'OUT', amount: 800,  walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T02:00:00Z') },
        { tbAccountId: 'acct-pay',   direction: 'IN',  amount: 1000, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T02:00:00Z') },
        { tbAccountId: 'acct-pay',   direction: 'OUT', amount: 200,  walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T03:00:00Z') },
        // aggregate leg shares walletRef but is SYSTEM-owned → filtered out
        { tbAccountId: 'acct-asset', direction: 'IN',  amount: 1000, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
      ],
      registry: REG_CUSTOMER,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'c-vault-1',
      externalClosing: 1000n,   // PAYABLE 800 + SUSPENSE 200 = 1000
      cutoff,
    });
    expect(result.pass).toBe(true);
    expect(result.walletKind).toBe('CUSTOMER');
    expect(result.coaCode).toBe('L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE');
    expect(result.ownerNo).toBe('c-001');
    expect(result.internal.payable).toBe(800n);
    expect(result.internal.suspense).toBe(200n);
    expect(result.internal.total).toBe(1000n);
    expect(result.external).toBe(1000n);
    expect(result.delta).toBe(0n);
  });

  it('customer wallet: external == PAYABLE but SUSPENSE > 0 → pass=false, delta=-SUSPENSE (no layered fallback)', async () => {
    const prisma = makePrismaMock({
      // PAYABLE=800, SUSPENSE=200
      flows: [
        { tbAccountId: 'acct-susp',  direction: 'IN',  amount: 200,  walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        { tbAccountId: 'acct-pay',   direction: 'IN',  amount: 800,  walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T02:00:00Z') },
      ],
      registry: REG_CUSTOMER,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'c-vault-1',
      externalClosing: 800n,   // matches PAYABLE alone — but spec says ONE equality, no fallback
      cutoff,
    });
    expect(result.pass).toBe(false);
    expect(result.walletKind).toBe('CUSTOMER');
    expect(result.internal.payable).toBe(800n);
    expect(result.internal.suspense).toBe(200n);
    expect(result.internal.total).toBe(1000n);
    expect(result.external).toBe(800n);
    expect(result.delta).toBe(-200n);   // 800 − 1000
  });

  it('customer wallet: external != PAYABLE + SUSPENSE → pass=false, delta = external − total', async () => {
    const prisma = makePrismaMock({
      flows: [
        { tbAccountId: 'acct-susp',  direction: 'IN',  amount: 300,  walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        { tbAccountId: 'acct-pay',   direction: 'IN',  amount: 700,  walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T02:00:00Z') },
      ],
      registry: REG_CUSTOMER,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'c-vault-1',
      externalClosing: 1050n,   // external is 50 more than internal total 1000
      cutoff,
    });
    expect(result.pass).toBe(false);
    expect(result.internal.total).toBe(1000n);
    expect(result.delta).toBe(50n);
  });

  it('firm wallet: external == FIRM_OPS balance → pass=true', async () => {
    const prisma = makePrismaMock({
      // FIRM_OPS gains 5000 in two postings
      flows: [
        { tbAccountId: 'acct-ops',    direction: 'IN',  amount: 3000, walletRef: 'firm-ops-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        { tbAccountId: 'acct-ops',    direction: 'IN',  amount: 2000, walletRef: 'firm-ops-1', createdAt: new Date('2026-06-26T02:00:00Z') },
        // aggregate FIRM_ASSET leg shares walletRef → filtered out
        { tbAccountId: 'acct-fasset', direction: 'IN',  amount: 5000, walletRef: 'firm-ops-1', createdAt: new Date('2026-06-26T01:00:00Z') },
      ],
      registry: REG_FIRM,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'firm-ops-1',
      externalClosing: 5000n,
      cutoff,
    });
    expect(result.pass).toBe(true);
    expect(result.walletKind).toBe('FIRM');
    expect(result.coaCode).toBe('E.FIRM_OPS');
    expect(result.ownerNo).toBe('FIRM_OPS_USDT');
    expect(result.internal.firmEquity).toBe(5000n);
    expect(result.internal.total).toBe(5000n);
    expect(result.external).toBe(5000n);
    expect(result.delta).toBe(0n);
  });

  it('firm wallet: external != FIRM_OPS → pass=false with delta', async () => {
    const prisma = makePrismaMock({
      flows: [
        { tbAccountId: 'acct-ops', direction: 'IN', amount: 5000, walletRef: 'firm-ops-1', createdAt: new Date('2026-06-26T01:00:00Z') },
      ],
      registry: REG_FIRM,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'firm-ops-1',
      externalClosing: 4800n,
      cutoff,
    });
    expect(result.pass).toBe(false);
    expect(result.walletKind).toBe('FIRM');
    expect(result.internal.total).toBe(5000n);
    expect(result.delta).toBe(-200n);   // 4800 − 5000
  });

  it('unknown wallet (no recognized codes hit) → walletKind=UNKNOWN', async () => {
    const prisma = makePrismaMock({
      // Only the aggregate CLIENT_ASSET leg exists at this walletRef — caller is
      // querying the aggregate audit row's walletRef, not a real customer's wallet.
      flows: [
        { tbAccountId: 'acct-asset', direction: 'IN', amount: 1000, walletRef: 'aggr-only', createdAt: new Date('2026-06-26T01:00:00Z') },
      ],
      registry: { 'acct-asset': REG_CUSTOMER['acct-asset'] },
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'aggr-only',
      externalClosing: 1000n,
      cutoff,
    });
    expect(result.walletKind).toBe('UNKNOWN');
    expect(result.internal.total).toBe(0n);
    expect(result.coaCode).toBe('');
    expect(result.ownerNo).toBeNull();
  });

  it('cutoff is honored: flows after cutoff are excluded', async () => {
    const prisma = makePrismaMock({
      flows: [
        { tbAccountId: 'acct-pay', direction: 'IN', amount: 500, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        // After cutoff — must not count
        { tbAccountId: 'acct-pay', direction: 'IN', amount: 300, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T13:00:00Z') },
      ],
      registry: REG_CUSTOMER,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({
      walletRef: 'c-vault-1',
      externalClosing: 500n,
      cutoff,
    });
    expect(result.pass).toBe(true);
    expect(result.internal.payable).toBe(500n);
  });
});
