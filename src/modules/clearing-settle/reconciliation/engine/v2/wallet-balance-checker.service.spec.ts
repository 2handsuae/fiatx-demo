import { Prisma } from '@prisma/client';
import { WalletBalanceCheckerService } from './wallet-balance-checker.service';

// ---- Helpers ----------------------------------------------------------------

// 戊波一 T11：余额检查器改读「钱包自己的现金户」。
//   钱包 → ownerType 定码（CUSTOMER → 1 / PLATFORM → 50）、network 定账本（AED_ZAND → 1 / TRON → 2）
//   → 注册表 (code, ledger, 'WALLET', walletRef) 得现金户 → 该户 POSTED、≤ cutoff 的流水 IN 加 OUT 减。
// 调账单落的行（sourceType = RECON_ADJUSTMENT）**计入**余额——它们只是不进匹配。

// 真实形状：注册表 tbAccountId 恒 32 位补零十六进制。
const CASH_CUST_AED = 'c0de0000000000000000000000000001';
const CASH_FIRM_AED = 'c0de0000000000000000000000000050';
const CASH_CUST_USDT = 'c0de0000000000000000000000000002';
const OTHER_ACCT = 'beef0000000000000000000000000100'; // 同钱包标签之外的别的户（应付等）

interface RegistryRow {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  status?: string;
}

const REGISTRY: RegistryRow[] = [
  { tbAccountId: CASH_CUST_AED, code: 1, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-cust-aed' },
  { tbAccountId: CASH_FIRM_AED, code: 50, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-firm-aed' },
  { tbAccountId: CASH_CUST_USDT, code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-cust-usdt' },
];

const WALLETS: Record<string, { ownerType: string; ownerNo: string; network: string }> = {
  'w-cust-aed': { ownerType: 'CUSTOMER', ownerNo: 'CU2601010001', network: 'AED_ZAND' },
  'w-firm-aed': { ownerType: 'PLATFORM', ownerNo: 'PLATFORM', network: 'AED_ZAND' },
  'w-cust-usdt': { ownerType: 'CUSTOMER', ownerNo: 'CU2601010001', network: 'TRON' },
  // 钱包在、但没开现金户（没到 ACTIVE）
  'w-no-cash': { ownerType: 'CUSTOMER', ownerNo: 'CU2601010002', network: 'AED_ZAND' },
};

interface FlowFixture {
  tbAccountId: string;
  direction: 'IN' | 'OUT';
  amount: string | number;
  createdAt: Date;
  sourceType?: string;
  transferType?: string;
  effectiveDate?: string;
}

function makePrismaMock(flows: FlowFixture[], registry: RegistryRow[] = REGISTRY) {
  return {
    wallet: {
      findUnique: jest.fn(async ({ where }: any) => WALLETS[where.id] ?? null),
    },
    // 保真：按 (code, ledger, ownerType, ownerUuid) 过滤，服务取错码 / 错账本就落空。
    tbAccountRegistry: {
      findFirst: jest.fn(async ({ where }: any) =>
        registry.find((r) =>
          r.code === where.code && r.ledger === where.ledger && r.ownerType === where.ownerType
          && r.ownerUuid === where.ownerUuid && (where.status === undefined || (r.status ?? 'ACTIVE') === where.status),
        ) ?? null),
    },
    accountFlow: {
      findMany: jest.fn(async ({ where }: any) => {
        return flows.filter((f) => {
          // 按户取：服务必须按现金户的 tbAccountId 查，不是按 walletRef 标签。
          if (where.tbAccountId !== f.tbAccountId) return false;
          if (where.transferType && (f.transferType ?? 'POSTED') !== where.transferType) return false;
          // 检查器不得排除任何 sourceType（调账行计入余额）；若服务传了排除条件就按它过滤，使"误排除"可被测出。
          if (where.sourceType?.not !== undefined && f.sourceType === where.sourceType.not) return false;
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
  };
}

// ---- Tests ------------------------------------------------------------------

describe('WalletBalanceCheckerService', () => {
  const cutoff = new Date('2026-06-26T12:00:00Z');

  it('internal.total sums IN minus OUT on the wallet\'s cash account only', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_AED, direction: 'IN',  amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 200,  createdAt: new Date('2026-06-26T02:00:00Z') },
      // 别的户上的行（应付 / 别的钱包的现金户）——不属于这个钱包的现金户，不得计入
      { tbAccountId: OTHER_ACCT,    direction: 'IN',  amount: 5000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_FIRM_AED, direction: 'IN',  amount: 7000, createdAt: new Date('2026-06-26T01:00:00Z') },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 800n, cutoff });

    expect(result.pass).toBe(true);
    expect(result.walletKind).toBe('CUSTOMER');
    expect(result.coaCode).toBe('A.CLIENT_CASH');
    expect(result.ownerNo).toBe('CU2601010001');
    expect(result.cashTbAccountId).toBe(CASH_CUST_AED);
    expect(result.internal).toEqual({ total: 800n });
    expect(result.external).toBe(800n);
    expect(result.delta).toBe(0n);
    // 不再有旧的拆分字段
    expect(result.internal).not.toHaveProperty('payable');
    expect(result.internal).not.toHaveProperty('suspense');
    expect(result.internal).not.toHaveProperty('firmEquity');
  });

  it('external != internal → pass=false, delta = external − internal.total', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z') },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 1050n, cutoff });
    expect(result.pass).toBe(false);
    expect(result.internal.total).toBe(1000n);
    expect(result.delta).toBe(50n);
  });

  it('company wallet → code 50: walletKind=FIRM, coaCode=A.FIRM_CASH, no customer owner', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_FIRM_AED, direction: 'IN', amount: 3000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_FIRM_AED, direction: 'IN', amount: 2000, createdAt: new Date('2026-06-26T02:00:00Z') },
      { tbAccountId: CASH_FIRM_AED, direction: 'OUT', amount: 500, createdAt: new Date('2026-06-26T03:00:00Z') },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-firm-aed', externalClosing: 4500n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.walletKind).toBe('FIRM');
    expect(result.coaCode).toBe('A.FIRM_CASH');
    expect(result.ownerNo).toBeNull();
    expect(result.cashTbAccountId).toBe(CASH_FIRM_AED);
    expect(result.internal.total).toBe(4500n);
  });

  it('ledger follows the wallet network: a TRON wallet resolves its USDT-ledger cash account', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_USDT, direction: 'IN', amount: 12345, createdAt: new Date('2026-06-26T01:00:00Z') },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-usdt', externalClosing: 12345n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.cashTbAccountId).toBe(CASH_CUST_USDT);
    expect(prisma.tbAccountRegistry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-cust-usdt' }) }),
    );
  });

  it('adjustment rows are included in the balance (they only stay out of matching)', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_AED, direction: 'IN',  amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z'), sourceType: 'DEPOSIT' },
      // 调账单把现金户调低 300：行在现金户上、sourceType = RECON_ADJUSTMENT，余额必须算进去
      { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 300,  createdAt: new Date('2026-06-26T02:00:00Z'), sourceType: 'RECON_ADJUSTMENT' },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 700n, cutoff });
    expect(result.internal.total).toBe(700n);
    expect(result.pass).toBe(true);
  });

  it('PENDING transfers are not on any statement yet → excluded from the balance', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 400, createdAt: new Date('2026-06-26T02:00:00Z'), transferType: 'PENDING' },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 1000n, cutoff });
    expect(result.internal.total).toBe(1000n);
  });

  it('cutoff is honored: flows after cutoff are excluded', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 500, createdAt: new Date('2026-06-26T01:00:00Z') },
      // After cutoff — must not count
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 300, createdAt: new Date('2026-06-26T13:00:00Z') },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 500n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.internal.total).toBe(500n);
  });

  it('back-valued flow (effectiveDate < cutoff day) is included even when createdAt is after cutoff', async () => {
    const prisma = makePrismaMock([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 500, createdAt: new Date('2026-06-26T01:00:00Z') },
      // 平账回填：物理写入晚于截止时刻，但生效日在截止日之前 → 必须被吸收
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 300, createdAt: new Date('2026-06-27T09:00:00Z'), effectiveDate: '2026-06-25' },
    ]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 800n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.internal.total).toBe(800n);
  });

  // 前导零账户号的补零：写侧已全线定长 32 位（§A，2026-09-13），新库里注册表与 account_flows 都是 32 位；
  // 检查器取户时仍把注册表户号补零到 32 位再等值查流水（同款历史坑：首位 0 的户号某一侧少一位，
  // 等值查询会静默查空——客户户往往只有一条，余额算成 0、差额变成外部收盘全额，凭空造破口）。
  // 这条用「注册表 31 位 / 流水 32 位」的错位夹具钉住这一步：去掉补零，该户的行就查不到。
  it('前导零账户号：注册表里少一位的户号补零成 32 位后才查流水，该户的行必须算进余额（不许静默查空）', async () => {
    const CASH_LEAD0 = '0d1f22c2b330c2b293bf95ca6a7f2339';      // account_flows 侧：定长 32 位
    const REG_UNPADDED = CASH_LEAD0.slice(1);                   // 注册表侧：首位 0 被吃掉的 31 位
    expect(CASH_LEAD0).toHaveLength(32);
    expect(REG_UNPADDED).toHaveLength(31);
    const prisma = makePrismaMock(
      [{ tbAccountId: CASH_LEAD0, direction: 'IN', amount: 87500, createdAt: new Date('2026-06-26T01:00:00Z') }],
      [{ tbAccountId: REG_UNPADDED, code: 1, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-cust-aed' }],
    );
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 87500n, cutoff });
    expect(result.cashTbAccountId).toBe(CASH_LEAD0);
    expect(result.internal.total).toBe(87500n);
    expect(result.delta).toBe(0n);
    expect(result.pass).toBe(true);
    expect(prisma.accountFlow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tbAccountId: CASH_LEAD0 }) }),
    );
  });

  it('wallet row does not exist → fails loudly (no UNKNOWN fallback)', async () => {
    const prisma = makePrismaMock([]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    await expect(svc.checkBalance({ walletRef: 'w-ghost', externalClosing: 0n, cutoff })).rejects.toThrow(/w-ghost/);
  });

  it('wallet exists but its cash account was never opened → fails loudly', async () => {
    const prisma = makePrismaMock([]);
    const svc = new WalletBalanceCheckerService(prisma as any);
    await expect(svc.checkBalance({ walletRef: 'w-no-cash', externalClosing: 0n, cutoff })).rejects.toThrow(/w-no-cash/);
  });

  describe('resolveCashAccount (shared with the case-page flow comparison)', () => {
    it('returns the padded cash account id + kind for a real wallet', async () => {
      const svc = new WalletBalanceCheckerService(makePrismaMock([]) as any);
      await expect(svc.resolveCashAccount('w-firm-aed')).resolves.toEqual({
        walletKind: 'FIRM', coaCode: 'A.FIRM_CASH', ownerNo: null, tbAccountId: CASH_FIRM_AED,
      });
    });

    it('returns null when walletRef is not a wallet (unattributed external account refs)', async () => {
      const svc = new WalletBalanceCheckerService(makePrismaMock([]) as any);
      await expect(svc.resolveCashAccount('EXT-ACCT-1')).resolves.toBeNull();
    });
  });
});
