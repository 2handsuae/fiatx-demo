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
    effectiveDate?: string;
  }>;
  registry: Record<string, any>;
}) {
  return {
    accountFlow: {
      findMany: jest.fn(async ({ where }: any) => {
        return opts.flows.filter((f) => {
          if (where.walletRef && f.walletRef !== where.walletRef) return false;
          if (where.transferType && (f.transferType ?? 'POSTED') !== where.transferType) return false;
          const eff = (x: any) => x.effectiveDate ?? x.createdAt.toISOString().slice(0, 10);
          if (where.OR) {
            // 忠实复刻 effectiveCutoffFilter 的三支：更早业务日全进 / 同日按物理
            // 时刻卡 / 同日回填（写入时刻越过该业务日日终）全进。
            const pass = where.OR.some((cond: any) => {
              if (cond.effectiveDate?.lt !== undefined) return eff(f) < cond.effectiveDate.lt;
              if (eff(f) !== cond.effectiveDate) return false;
              if (cond.createdAt?.lte) return f.createdAt <= cond.createdAt.lte;
              if (cond.createdAt?.gt) return f.createdAt > cond.createdAt.gt;
              return true;
            });
            if (!pass) return false;
          }
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
        // 保真：真实 `tb_account_registry.tbAccountId` **恒为 32 位**补零十六进制，
        // 而上面这些可读假名（'acct-pay' 等）只有几个字符。服务层查进来的是补零
        // 后的键，所以这里也按补零后的形式建索引——否则 mock 与真库的连接键格式
        // 不一致，测试会为一个真实世界不存在的形状红/绿。
        // （2026-09-02：这份 mock 此前直接按假名索引，于是「未补零 join 落空」这个
        //  真实缺陷在单测里根本无从复现——8 条用例全绿了几个月，bug 一直在。）
        const byPadded: Record<string, any> = {};
        for (const r of Object.values(opts.registry) as any[]) {
          byPadded[r.tbAccountId.length < 32 ? r.tbAccountId.padStart(32, '0') : r.tbAccountId] = r;
        }
        return ids.map((id) => byPadded[id]).filter(Boolean);
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

  it('back-valued flow (effectiveDate < cutoff day) is included even when createdAt is after cutoff', async () => {
    const prisma = makePrismaMock({
      flows: [
        { tbAccountId: 'acct-pay', direction: 'IN', amount: 500, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        // 平账回填：物理写入晚于截止时刻，但生效日在截止日之前 → 必须被吸收
        { tbAccountId: 'acct-pay', direction: 'IN', amount: 300, walletRef: 'c-vault-1', createdAt: new Date('2026-06-27T09:00:00Z'), effectiveDate: '2026-06-25' },
      ],
      registry: REG_CUSTOMER,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'c-vault-1', externalClosing: 800n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.internal.payable).toBe(800n);
  });

  // 2026-09-02 回归锁（Task 12）：账户号首位为 0 时，两张表的 tbAccountId 差一位。
  //   `account_flows.tbAccountId` 来自上游 `bigint.toString(16)`（**未** padStart），
  //   `tb_account_registry.tbAccountId` 恒 32 位。不补零 join 就落空，服务里那句
  //   `if (!reg) continue` 会把这笔分录**从余额里静默丢掉**——客户户往往只有这一条
  //   PAYABLE，于是内部余额算成 0、差额变成外部收盘全额：凭空造破口。
  //   命中率约 1/16，且账户号每次重铺重生成，所以它表现为「按种子随机发作」。
  //   实测过的真实形状：2026-09-02 重铺后 demo_carol 的 AED 客户应付户就是
  //   `0d1f22c2...`，两份 recon e2e 当场各红一条。
  const PAY_32 = '0d1f22c2b330c2b293bf95ca6a7f2339';  // 注册表里的样子（32 位）
  const PAY_31 = PAY_32.slice(1);                      // account_flows 里的样子（31 位，前导零被吃掉）

  it('前导零账户号：account_flows 存 31 位、注册表存 32 位 → 该分录必须仍被算进余额（不许静默丢弃）', async () => {
    expect(PAY_32).toHaveLength(32);
    expect(PAY_31).toHaveLength(31);   // 前提：两侧确实不同，否则这条测试测的是空气

    const prisma = makePrismaMock({
      flows: [
        { tbAccountId: PAY_31, direction: 'IN', amount: 87500, walletRef: 'c-vault-9', createdAt: new Date('2026-06-26T01:00:00Z') },
      ],
      registry: {
        [PAY_32]: { tbAccountId: PAY_32, code: 100, ownerType: 'CUSTOMER', ownerNo: 'c-009', assetCode: 'AED' },
      },
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'c-vault-9', externalClosing: 87500n, cutoff });

    // 修之前这三条全错：分录被丢 → kind=UNKNOWN、payable=0、delta=87500（凭空的破口）。
    expect(result.walletKind).toBe('CUSTOMER');
    expect(result.internal.payable).toBe(87500n);
    expect(result.internal.total).toBe(87500n);
    expect(result.delta).toBe(0n);
    expect(result.pass).toBe(true);
    expect(result.ownerNo).toBe('c-009');
  });
});
