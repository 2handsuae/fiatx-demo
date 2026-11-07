import { Prisma } from '@prisma/client';
import { WalletBalanceCheckerService } from './wallet-balance-checker.service';
import { AccountingService } from '../../../../accounting/tigerbeetle/accounting.service';
import { TbAccountRegistryService } from '../../../../accounting/tigerbeetle/tb-account-registry.service';

// ---- Helpers ----------------------------------------------------------------

// 戊波一 T11：余额检查器改读「钱包自己的现金户」。
//   钱包 → ownerType 定码（CUSTOMER → 1 / PLATFORM → 50）、network 定账本（AED_ZAND → 1 / TRON → 2）
//   → 注册表 (code, ledger, 'WALLET', walletRef) 得现金户 → 该户 POSTED、≤ cutoff 的流水 IN 加 OUT 减。
// 调账单落的行（sourceType = RECON_ADJUSTMENT）**计入**余额——它们只是不进匹配。
//
// 戊波二 T9a：
//   ① 现金户经 AccountingService.resolveCashAccountId 取（与记账侧同一个解析器，对账读端不再自查注册表）——
//      本 spec 用**真实的** AccountingService + TbAccountRegistryService（只替掉 Prisma 与 TB 底层），
//      所以「检查器取错码 / 错账本就落空」是被行为验到的，不是读自己写的 mock。
//   ② 客户钱包另算对内差额：(现金 1·钱包 + 短缺待补 2·钱包) − (应付 100·客户·本账本 + 暂扣 101·客户·本账本)，
//      四个户用同一个 effectiveCutoffFilter；公司钱包 internalDelta = null。

// 真实形状：注册表 tbAccountId 恒 32 位补零十六进制。
const CASH_CUST_AED = 'c0de0000000000000000000000000001';
const SHORT_CUST_AED = 'c0de0000000000000000000000000002';
const PAY_CUST_AED = 'beef0000000000000000000000000100';
const SUSP_CUST_AED = 'beef0000000000000000000000000101';
const CASH_FIRM_AED = 'c0de0000000000000000000000000050';
const CASH_CUST_USDT = 'c0de0000000000000000000000000011';
const SHORT_CUST_USDT = 'c0de0000000000000000000000000012';
const PAY_CUST_USDT = 'beef0000000000000000000000000200';
const SUSP_CUST_USDT = 'beef0000000000000000000000000201';
const OTHER_ACCT = 'beef0000000000000000000000000999'; // 同钱包标签之外的别的户（别的客户的应付等）

interface RegistryRow {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  status?: string;
}

const REGISTRY: RegistryRow[] = [
  // AED 账本（ledger 1）
  { tbAccountId: CASH_CUST_AED, code: 1, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-cust-aed' },
  { tbAccountId: SHORT_CUST_AED, code: 2, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-cust-aed' },
  { tbAccountId: PAY_CUST_AED, code: 100, ledger: 1, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
  { tbAccountId: SUSP_CUST_AED, code: 101, ledger: 1, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
  { tbAccountId: CASH_FIRM_AED, code: 50, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-firm-aed' },
  // USDT 账本（ledger 2）
  { tbAccountId: CASH_CUST_USDT, code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-cust-usdt' },
  { tbAccountId: SHORT_CUST_USDT, code: 2, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-cust-usdt' },
  { tbAccountId: PAY_CUST_USDT, code: 100, ledger: 2, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
  { tbAccountId: SUSP_CUST_USDT, code: 101, ledger: 2, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
];

const WALLETS: Record<string, { ownerType: string; ownerNo: string; ownerId: string | null; network: string }> = {
  'w-cust-aed': { ownerType: 'CUSTOMER', ownerNo: 'CU2601010001', ownerId: 'cust-1', network: 'AED_ZAND' },
  'w-firm-aed': { ownerType: 'PLATFORM', ownerNo: 'PLATFORM', ownerId: null, network: 'AED_ZAND' },
  'w-cust-usdt': { ownerType: 'CUSTOMER', ownerNo: 'CU2601010001', ownerId: 'cust-1', network: 'TRON' },
  // 钱包在、但没开现金户（没到 ACTIVE）
  'w-no-cash': { ownerType: 'CUSTOMER', ownerNo: 'CU2601010002', ownerId: 'cust-2', network: 'AED_ZAND' },
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
          // 按户取：服务必须按账户的 tbAccountId 查，不是按 walletRef 标签（码 2 的流水没有 walletRef）。
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

/** 真实 AccountingService（只替掉 Prisma / TB 底层）——检查器经它取户，断言才是行为不是 mock 自证。 */
function makeSvc(flows: FlowFixture[], registry: RegistryRow[] = REGISTRY) {
  const prisma = makePrismaMock(flows, registry);
  const registryService = new TbAccountRegistryService(prisma as any, {} as any);
  const accounting = new AccountingService({} as any, registryService, {} as any, prisma as any);
  const svc = new WalletBalanceCheckerService(prisma as any, accounting);
  return { svc, prisma, accounting };
}

// ---- Tests ------------------------------------------------------------------

describe('WalletBalanceCheckerService', () => {
  const cutoff = new Date('2026-06-26T12:00:00Z');

  it('internal.total sums IN minus OUT on the wallet\'s cash account only', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_CUST_AED, direction: 'IN',  amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 200,  createdAt: new Date('2026-06-26T02:00:00Z') },
      // 别的户上的行（别人的应付 / 别的钱包的现金户）——不属于这个钱包的现金户，不得计入
      { tbAccountId: OTHER_ACCT,    direction: 'IN',  amount: 5000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_FIRM_AED, direction: 'IN',  amount: 7000, createdAt: new Date('2026-06-26T01:00:00Z') },
      // 本客户应付上也记了 800（现金 800 对应付 800 = 对内平）
      { tbAccountId: PAY_CUST_AED,  direction: 'IN',  amount: 800,  createdAt: new Date('2026-06-26T01:30:00Z') },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 800n, cutoff });

    expect(result.pass).toBe(true);
    expect(result.walletKind).toBe('CUSTOMER');
    expect(result.coaCode).toBe('A.CLIENT_CASH');
    expect(result.ownerNo).toBe('CU2601010001');
    expect(result.cashTbAccountId).toBe(CASH_CUST_AED);
    expect(result.internal).toEqual({ total: 800n });
    expect(result.external).toBe(800n);
    expect(result.delta).toBe(0n);
    expect(result.internalDelta).toBe(0n);
    // 不再有旧的拆分字段
    expect(result.internal).not.toHaveProperty('payable');
    expect(result.internal).not.toHaveProperty('suspense');
    expect(result.internal).not.toHaveProperty('firmEquity');
  });

  it('external != internal → pass=false, delta = external − internal.total', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z') },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 1050n, cutoff });
    expect(result.pass).toBe(false);
    expect(result.internal.total).toBe(1000n);
    expect(result.delta).toBe(50n);
  });

  it('company wallet → code 50: walletKind=FIRM, coaCode=A.FIRM_CASH, no customer owner', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_FIRM_AED, direction: 'IN', amount: 3000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_FIRM_AED, direction: 'IN', amount: 2000, createdAt: new Date('2026-06-26T02:00:00Z') },
      { tbAccountId: CASH_FIRM_AED, direction: 'OUT', amount: 500, createdAt: new Date('2026-06-26T03:00:00Z') },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-firm-aed', externalClosing: 4500n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.walletKind).toBe('FIRM');
    expect(result.coaCode).toBe('A.FIRM_CASH');
    expect(result.ownerNo).toBeNull();
    expect(result.cashTbAccountId).toBe(CASH_FIRM_AED);
    expect(result.internal.total).toBe(4500n);
  });

  it('ledger follows the wallet network: a TRON wallet resolves its USDT-ledger cash account', async () => {
    const { svc, prisma } = makeSvc([
      { tbAccountId: CASH_CUST_USDT, direction: 'IN', amount: 12345, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: PAY_CUST_USDT, direction: 'IN', amount: 12345, createdAt: new Date('2026-06-26T01:00:00Z') },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-usdt', externalClosing: 12345n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.cashTbAccountId).toBe(CASH_CUST_USDT);
    expect(result.internalDelta).toBe(0n);
    expect(prisma.tbAccountRegistry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-cust-usdt' }) }),
    );
  });

  it('adjustment rows are included in the balance (they only stay out of matching)', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_CUST_AED, direction: 'IN',  amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z'), sourceType: 'DEPOSIT' },
      // 调账单把现金户调低 300：行在现金户上、sourceType = RECON_ADJUSTMENT，余额必须算进去
      { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 300,  createdAt: new Date('2026-06-26T02:00:00Z'), sourceType: 'RECON_ADJUSTMENT' },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 700n, cutoff });
    expect(result.internal.total).toBe(700n);
    expect(result.pass).toBe(true);
  });

  it('PENDING transfers are not on any statement yet → excluded from the balance', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: new Date('2026-06-26T01:00:00Z') },
      { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 400, createdAt: new Date('2026-06-26T02:00:00Z'), transferType: 'PENDING' },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 1000n, cutoff });
    expect(result.internal.total).toBe(1000n);
  });

  it('cutoff is honored: flows after cutoff are excluded', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 500, createdAt: new Date('2026-06-26T01:00:00Z') },
      // After cutoff — must not count
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 300, createdAt: new Date('2026-06-26T13:00:00Z') },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 500n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.internal.total).toBe(500n);
  });

  it('back-valued flow (effectiveDate < cutoff day) is included even when createdAt is after cutoff', async () => {
    const { svc } = makeSvc([
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 500, createdAt: new Date('2026-06-26T01:00:00Z') },
      // 平账回填：物理写入晚于截止时刻，但生效日在截止日之前 → 必须被吸收
      { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 300, createdAt: new Date('2026-06-27T09:00:00Z'), effectiveDate: '2026-06-25' },
    ]);
    const result = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 800n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.internal.total).toBe(800n);
  });

  // 前导零账户号的补零：写侧已全线定长 32 位（§A，2026-09-13），新库里注册表与 account_flows 都是 32 位；
  // 检查器取户时仍把户号补零到 32 位再等值查流水（同款历史坑：首位 0 的户号某一侧少一位，
  // 等值查询会静默查空——客户户往往只有一条，余额算成 0、差额变成外部收盘全额，凭空造破口）。
  // 这条用「注册表 31 位 / 流水 32 位」的错位夹具钉住这一步：去掉补零，该户的行就查不到。
  it('前导零账户号：注册表里少一位的户号补零成 32 位后才查流水，该户的行必须算进余额（不许静默查空）', async () => {
    const CASH_LEAD0 = '0d1f22c2b330c2b293bf95ca6a7f2339';      // account_flows 侧：定长 32 位
    const REG_UNPADDED = CASH_LEAD0.slice(1);                   // 注册表侧：首位 0 被吃掉的 31 位
    expect(CASH_LEAD0).toHaveLength(32);
    expect(REG_UNPADDED).toHaveLength(31);
    const { svc, prisma } = makeSvc(
      [
        { tbAccountId: CASH_LEAD0, direction: 'IN', amount: 87500, createdAt: new Date('2026-06-26T01:00:00Z') },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 87500, createdAt: new Date('2026-06-26T01:00:00Z') },
      ],
      [
        { tbAccountId: REG_UNPADDED, code: 1, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-cust-aed' },
        { tbAccountId: SHORT_CUST_AED, code: 2, ledger: 1, ownerType: 'WALLET', ownerUuid: 'w-cust-aed' },
        { tbAccountId: PAY_CUST_AED, code: 100, ledger: 1, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
        { tbAccountId: SUSP_CUST_AED, code: 101, ledger: 1, ownerType: 'CUSTOMER', ownerUuid: 'cust-1' },
      ],
    );
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
    const { svc } = makeSvc([]);
    await expect(svc.checkBalance({ walletRef: 'w-ghost', externalClosing: 0n, cutoff })).rejects.toThrow(/w-ghost/);
  });

  it('wallet exists but its cash account was never opened → fails loudly with the same code as before the resolver merge', async () => {
    const { svc } = makeSvc([]);
    const err: any = await svc.checkBalance({ walletRef: 'w-no-cash', externalClosing: 0n, cutoff }).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'WALLET_CASH_ACCOUNT_NOT_FOUND' });
    expect(err.message).toMatch(/w-no-cash/);
  });

  describe('internalDelta —— 客户钱包的两本账（戊波二 T9a，spec §4.5）', () => {
    // 符号约定：四个户的流水方向都按「该户余额增加 = IN」投影（借方户的借 = IN，贷方户的贷 = IN），
    // 所以每户净额 = Σ IN − Σ OUT；internalDelta = (现金 + 短缺) − (应付 + 暂扣)。
    const t = (h: number) => new Date(`2026-06-26T0${h}:00:00Z`);

    it('四户求和：现金 + 短缺待补 对 应付 + 暂扣，平则为 0', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: SHORT_CUST_AED, direction: 'IN', amount: 300, createdAt: t(2) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 1100, createdAt: t(3) },
        { tbAccountId: SUSP_CUST_AED, direction: 'IN', amount: 200, createdAt: t(4) },
      ]);
      const r = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 1000n, cutoff });
      expect(r.internalDelta).toBe(0n);
      // 对外差额只看现金户：短缺待补不进 internal.total
      expect(r.internal.total).toBe(1000n);
      expect(r.delta).toBe(0n);
    });

    it('现金多于账面：正数；应付多于现金：负数；OUT 行减', async () => {
      const over = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 900, createdAt: t(1) },
        { tbAccountId: SUSP_CUST_AED, direction: 'IN', amount: 50, createdAt: t(1) },
      ]);
      expect((await over.svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 1000n, cutoff })).internalDelta).toBe(50n);

      const under = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 100, createdAt: t(2) },
        { tbAccountId: SHORT_CUST_AED, direction: 'IN', amount: 100, createdAt: t(2) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: SUSP_CUST_AED, direction: 'IN', amount: 40, createdAt: t(1) },
        { tbAccountId: SUSP_CUST_AED, direction: 'OUT', amount: 10, createdAt: t(3) },
      ]);
      // (1000−100) + 100 − (1000 + 40−10) = 1000 − 1030 = −30
      expect((await under.svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 900n, cutoff })).internalDelta).toBe(-30n);
    });

    it('短缺待补进算式：认损那一笔（借 2 / 贷 1）后 现金 − X、短缺 + X，对内仍平', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        // 码 91：借 2·钱包 / 贷 1·钱包
        { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 400, createdAt: t(2) },
        { tbAccountId: SHORT_CUST_AED, direction: 'IN', amount: 400, createdAt: t(2) },
      ]);
      const r = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 600n, cutoff });
      expect(r.internal.total).toBe(600n);
      expect(r.internalDelta).toBe(0n);
      // 去掉短缺这一项，天平会差 −400——证明它真的进了算式
      expect(r.internal.total - 1000n).toBe(-400n);
    });

    it('四个户共用同一个截止口径：晚于 cutoff 的行不计、回填行计、PENDING 不计', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 500, createdAt: t(1) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 500, createdAt: t(1) },
        // 截止点之后的应付（不计）——若应付误用了别的口径，这里会出差额
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 300, createdAt: new Date('2026-06-26T13:00:00Z') },
        // 回填：写入晚于截止，生效日更早 → 计入（现金侧与应付侧各一笔，仍平）
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 70, createdAt: new Date('2026-06-27T09:00:00Z'), effectiveDate: '2026-06-25' },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 70, createdAt: new Date('2026-06-27T09:00:00Z'), effectiveDate: '2026-06-25' },
        // PENDING 的暂扣不在任何对账单上，也不计入
        { tbAccountId: SUSP_CUST_AED, direction: 'IN', amount: 999, createdAt: t(2), transferType: 'PENDING' },
      ]);
      const r = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 570n, cutoff });
      expect(r.internal.total).toBe(570n);
      expect(r.internalDelta).toBe(0n);
    });

    it('只按户汇总、不按 walletRef 标签：别的客户的应付、别的户的行不进来', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 100, createdAt: t(1) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 100, createdAt: t(1) },
        { tbAccountId: OTHER_ACCT, direction: 'IN', amount: 77777, createdAt: t(1) },
        { tbAccountId: CASH_CUST_USDT, direction: 'IN', amount: 55555, createdAt: t(1) },
        { tbAccountId: PAY_CUST_USDT, direction: 'IN', amount: 33333, createdAt: t(1) },
      ]);
      expect((await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 100n, cutoff })).internalDelta).toBe(0n);
    });

    it('账本跟钱包网络走：TRON 钱包对的是 USDT 账本的应付 / 暂扣，不是 AED 的', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_USDT, direction: 'IN', amount: 900, createdAt: t(1) },
        { tbAccountId: PAY_CUST_USDT, direction: 'IN', amount: 600, createdAt: t(1) },
        { tbAccountId: SUSP_CUST_USDT, direction: 'IN', amount: 300, createdAt: t(1) },
        // AED 账本上的应付与此无关
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 12345, createdAt: t(1) },
      ]);
      const r = await svc.checkBalance({ walletRef: 'w-cust-usdt', externalClosing: 900n, cutoff });
      expect(r.internalDelta).toBe(0n);
    });

    it('公司钱包：internalDelta = null，且不去查 2 / 100 / 101（公司本没有逐钱包恒等式）', async () => {
      const { svc, accounting } = makeSvc([
        { tbAccountId: CASH_FIRM_AED, direction: 'IN', amount: 3000, createdAt: t(1) },
      ]);
      const spy = jest.spyOn(accounting, 'resolveTbAccountId');
      const r = await svc.checkBalance({ walletRef: 'w-firm-aed', externalClosing: 3000n, cutoff });
      expect(r.internalDelta).toBeNull();
      // 只有现金户那一次（resolveCashAccountId 内部走 resolveTbAccountId），没有 2 / 100 / 101
      expect(spy.mock.calls.map(([p]) => p.code)).toEqual([50]);
    });

    it('客户钱包的短缺待补户没开：同样大声失败（不当 0 兜底）', async () => {
      const noShortfall = REGISTRY.filter((r) => !(r.code === 2 && r.ownerUuid === 'w-cust-aed'));
      const { svc } = makeSvc([], noShortfall);
      const err: any = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 0n, cutoff }).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'TB_ACCOUNT_REGISTRY_NOT_FOUND' });
      expect(err.message).toMatch(/code=2 /);
    });
  });

  describe('internalBreakdown —— 案件页副行的四户净额（戊波二 T10）', () => {
    const t = (h: number) => new Date(`2026-06-26T0${h}:00:00Z`);

    it('四个户各自的净额 + delta，delta 与 checkBalance 的 internalDelta 是同一个数', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: CASH_CUST_AED, direction: 'OUT', amount: 100, createdAt: t(2) },
        { tbAccountId: SHORT_CUST_AED, direction: 'IN', amount: 100, createdAt: t(2) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 1000, createdAt: t(1) },
        { tbAccountId: SUSP_CUST_AED, direction: 'IN', amount: 40, createdAt: t(1) },
        { tbAccountId: SUSP_CUST_AED, direction: 'OUT', amount: 10, createdAt: t(3) },
      ]);
      const b = await svc.internalBreakdown('w-cust-aed', cutoff);
      expect(b).toEqual({ cash: 900n, shortfall: 100n, payable: 1000n, suspense: 30n, delta: -30n });
      const r = await svc.checkBalance({ walletRef: 'w-cust-aed', externalClosing: 900n, cutoff });
      expect(r.internalDelta).toBe(b!.delta);
    });

    it('同一个截止口径：晚于 cutoff 的行不计', async () => {
      const { svc } = makeSvc([
        { tbAccountId: CASH_CUST_AED, direction: 'IN', amount: 500, createdAt: t(1) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 500, createdAt: t(1) },
        { tbAccountId: PAY_CUST_AED, direction: 'IN', amount: 300, createdAt: new Date('2026-06-26T13:00:00Z') },
      ]);
      expect(await svc.internalBreakdown('w-cust-aed', cutoff)).toEqual({ cash: 500n, shortfall: 0n, payable: 500n, suspense: 0n, delta: 0n });
    });

    it('公司钱包 → null；不是钱包的 walletRef（未归属外部账户）→ null', async () => {
      const { svc } = makeSvc([{ tbAccountId: CASH_FIRM_AED, direction: 'IN', amount: 3000, createdAt: t(1) }]);
      await expect(svc.internalBreakdown('w-firm-aed', cutoff)).resolves.toBeNull();
      await expect(svc.internalBreakdown('EXT-ACCT-1', cutoff)).resolves.toBeNull();
    });
  });

  describe('resolveCashAccount (shared with the case-page flow comparison)', () => {
    it('returns the padded cash account id + kind for a real wallet', async () => {
      const { svc } = makeSvc([]);
      await expect(svc.resolveCashAccount('w-firm-aed')).resolves.toEqual({
        walletKind: 'FIRM', coaCode: 'A.FIRM_CASH', ownerNo: null, tbAccountId: CASH_FIRM_AED,
      });
    });

    it('returns null when walletRef is not a wallet (unattributed external account refs)', async () => {
      const { svc } = makeSvc([]);
      await expect(svc.resolveCashAccount('EXT-ACCT-1')).resolves.toBeNull();
    });

    it('取户经 AccountingService.resolveCashAccountId（单一解析器），账本由钱包网络给', async () => {
      const { svc, accounting } = makeSvc([]);
      const spy = jest.spyOn(accounting, 'resolveCashAccountId');
      await svc.resolveCashAccount('w-cust-usdt');
      expect(spy).toHaveBeenCalledWith('w-cust-usdt', 2);
      await svc.resolveCashAccount('w-firm-aed');
      expect(spy).toHaveBeenCalledWith('w-firm-aed', 1);
    });
  });
});
