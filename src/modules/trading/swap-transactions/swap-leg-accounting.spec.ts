import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SwapLegAccounting, SwapSettleCtx } from './swap-leg-accounting';
import { buildSwapLegPlan } from '../../funds-layer/constants/swap-leg-plan.constant';
import { TB_ACCOUNT_CODES as C } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

/**
 * 戊波一·兑换四腿接线:每条分录解析到的账户 = 附录 B 指定的「钱包现金户 / 应付 / 权益 / 收入」。
 * 桩只做「身份映射」(同一输入 → 同一整数、不同输入 → 不同整数),所以断言读的是被调用时真正传入的账户,
 * 不是桩的内部状态。
 */
describe('SwapLegAccounting — 四腿现金户接线(戊波一)', () => {
  const AED = 1;
  const USDT = 2;

  // 账户 id 的可读标签(整数 → 标签),让断言直接写成「谁的什么户」
  const labels = new Map<bigint, string>();
  const ids = new Map<string, bigint>();
  const idOf = (label: string): bigint => {
    let id = ids.get(label);
    if (id === undefined) {
      id = BigInt(ids.size + 1);
      ids.set(label, id);
      labels.set(id, label);
    }
    return id;
  };

  const customerWallet = (role: string, assetId: string) => `W[${role}/${assetId}]`;

  function build(opts?: { missingRole?: string }) {
    const pending: Array<{ code: number; debit: string; credit: string; ledger: number; evidence: any }> = [];
    const accounting = {
      resolveCashAccountId: jest.fn(async (walletId: string, ledger: number) => idOf(`cash:${walletId}@${ledger}`)),
      resolveTbAccountId: jest.fn(async (p: { code: number; ledger: number; ownerType: string; ownerUuid?: string }) =>
        idOf(`${p.ownerType}:${p.code}@${p.ledger}${p.ownerUuid ? `:${p.ownerUuid}` : ''}`)),
      executePendingTransfer: jest.fn(async (p: any) => {
        pending.push({
          code: p.code,
          debit: labels.get(p.debitAccountId)!,
          credit: labels.get(p.creditAccountId)!,
          ledger: p.ledger,
          evidence: p.evidence,
        });
        return { tbTransferId: 1n };
      }),
      postPendingTransfer: jest.fn(async () => undefined),
    };
    const wallets = {
      // 平台角色按资产解析
      resolve: jest.fn(async (assetId: string, role: string) => {
        if (role === opts?.missingRole) throw new Error('SYSTEM_WALLET_NOT_FOUND');
        return { id: `W[${role}/${assetId}]` };
      }),
      // 客户角色按 ownerId + 资产解析
      resolveCustomer: jest.fn(async (assetId: string, role: string, ownerId: string) => {
        if (role === opts?.missingRole) throw new Error('CUSTOMER_WALLET_NOT_FOUND');
        return { id: `W[${role}/${assetId}/${ownerId}]` };
      }),
    };
    const tbEvidence = { enrichForPost: jest.fn(async () => undefined) };
    const svc = new SwapLegAccounting(accounting as any, wallets as any, tbEvidence as any);
    return { svc, accounting, wallets, tbEvidence, pending };
  }

  const ctx = (fromIsFiat: boolean): SwapSettleCtx => ({
    swapId: 'swap-uuid',
    swapNo: 'SWP-T4',
    ownerId: 'cust-1',
    fromIsFiat,
    fromAssetId: fromIsFiat ? 'AED' : 'USDT',
    toAssetId: fromIsFiat ? 'USDT' : 'AED',
    fromLedger: fromIsFiat ? AED : USDT,
    toLedger: fromIsFiat ? USDT : AED,
    fromCurrency: fromIsFiat ? 'AED' : 'USDT',
    toCurrency: fromIsFiat ? 'USDT' : 'AED',
    fromAmount: new Prisma.Decimal('1000'),
    grossToAmount: new Prisma.Decimal('272'),
    feeAmount: new Prisma.Decimal('1'),
    fromDecimals: fromIsFiat ? 2 : 6,
    toDecimals: fromIsFiat ? 6 : 2,
    attempt: 1,
  });

  /** 逐腿跑 initiateLegPending,按分录顺序收集 [码, 借方户, 贷方户, 账本]。 */
  async function runPlan(fromIsFiat: boolean) {
    const h = build();
    const c = ctx(fromIsFiat);
    const out: Array<[number, string, string, number]> = [];
    for (const spec of buildSwapLegPlan({ fromIsFiat })) {
      const before = h.pending.length;
      await h.svc.initiateLegPending(c, spec, {});
      for (const p of h.pending.slice(before)) out.push([p.code, p.debit, p.credit, p.ledger]);
    }
    return { ...h, out };
  }

  it('USDT→AED(客户卖币):四腿 7 笔分录各落在附录 B 指定的现金户 / 权益 / 收入', async () => {
    const { out } = await runPlan(false);
    expect(out).toEqual([
      // 腿 1:客户地址 → 运营地址(USDT)
      [30, `CUSTOMER:${C.CLIENT_PAYABLE}@${USDT}:cust-1`, `cash:W[C_DEP/USDT/cust-1]@${USDT}`, USDT],
      [31, `cash:W[F_OPS/USDT]@${USDT}`, `SYSTEM:${C.FIRM_EQUITY}@${USDT}`, USDT],
      // 腿 2:运营户 → 结算户(AED)
      [32, `cash:W[F_SET/AED]@${AED}`, `cash:W[F_OPS/AED]@${AED}`, AED],
      // 腿 3:结算户 → 客户 vIBAN(AED)
      [33, `SYSTEM:${C.FIRM_EQUITY}@${AED}`, `cash:W[F_SET/AED]@${AED}`, AED],
      [34, `cash:W[C_VIBAN/AED/cust-1]@${AED}`, `CUSTOMER:${C.CLIENT_PAYABLE}@${AED}:cust-1`, AED],
      // 腿 4:客户 vIBAN → 手续费钱包(AED)
      [35, `CUSTOMER:${C.CLIENT_PAYABLE}@${AED}:cust-1`, `cash:W[C_VIBAN/AED/cust-1]@${AED}`, AED],
      [36, `cash:W[F_FEE/AED]@${AED}`, `SYSTEM:${C.INCOME_SWAP_FEE}@${AED}`, AED],
    ]);
  });

  it('AED→USDT(客户买币):四腿 7 笔分录各落在附录 B 指定的现金户 / 权益 / 收入', async () => {
    const { out } = await runPlan(true);
    expect(out).toEqual([
      // 腿 1:客户 vIBAN → 结算户(AED)
      [30, `CUSTOMER:${C.CLIENT_PAYABLE}@${AED}:cust-1`, `cash:W[C_VIBAN/AED/cust-1]@${AED}`, AED],
      [31, `cash:W[F_SET/AED]@${AED}`, `SYSTEM:${C.FIRM_EQUITY}@${AED}`, AED],
      // 腿 2:结算户 → 运营户(AED)
      [37, `cash:W[F_OPS/AED]@${AED}`, `cash:W[F_SET/AED]@${AED}`, AED],
      // 腿 3:运营地址 → 客户地址(USDT)
      [38, `SYSTEM:${C.FIRM_EQUITY}@${USDT}`, `cash:W[F_OPS/USDT]@${USDT}`, USDT],
      [34, `cash:W[C_DEP/USDT/cust-1]@${USDT}`, `CUSTOMER:${C.CLIENT_PAYABLE}@${USDT}:cust-1`, USDT],
      // 腿 4:客户地址 → 手续费钱包(USDT)
      [35, `CUSTOMER:${C.CLIENT_PAYABLE}@${USDT}:cust-1`, `cash:W[C_DEP/USDT/cust-1]@${USDT}`, USDT],
      [36, `cash:W[F_FEE/USDT]@${USDT}`, `SYSTEM:${C.INCOME_SWAP_FEE}@${USDT}`, USDT],
    ]);
  });

  it('现金户只经 resolveCashAccountId 取;不再有按币种聚合的现金户(没有任何 SYSTEM 1 / 50 查询)', async () => {
    for (const fromIsFiat of [false, true]) {
      const { accounting } = await runPlan(fromIsFiat);
      const systemLookups = accounting.resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
      expect(systemLookups).not.toContain(C.CLIENT_CASH);
      expect(systemLookups).not.toContain(C.FIRM_CASH);
      expect(systemLookups).not.toContain(201);
      expect(accounting.resolveCashAccountId).toHaveBeenCalled();
    }
  });

  it('证据行只带助记科目 + 来源', async () => {
    const { pending } = await runPlan(false);
    const first = pending[0].evidence;
    expect(first).toMatchObject({
      sourceType: 'SWAP',
      sourceNo: 'SWP-T4',
      eventCode: 'SWAP_SELL_CLIENT',
      debitCode: 'L.CLIENT_PAYABLE',
      creditCode: 'A.CLIENT_CASH',
    });
    // 31 的借方是公司现金、贷方是公司权益(不是已退役的结算户)
    const sellFirm = pending.find((p) => p.evidence.eventCode === 'SWAP_SELL_FIRM')!;
    expect([sellFirm.evidence.debitCode, sellFirm.evidence.creditCode]).toEqual(['A.FIRM_CASH', 'E.FIRM_EQUITY']);
  });

  it('落账时 enrichForPost 只补 externalRef', async () => {
    const h = build();
    const c = ctx(false);
    const spec = buildSwapLegPlan({ fromIsFiat: false })[0];
    await h.svc.postLeg(c, spec, {}, '0xabc');
    expect(h.tbEvidence.enrichForPost).toHaveBeenCalledTimes(spec.accounting.length);
    for (const call of h.tbEvidence.enrichForPost.mock.calls as any[][]) {
      expect(call[1]).toEqual({ externalRef: '0xabc' });
    }
  });

  it('该腿的现金钱包解析不到 → 记账失败(抛 SWAP_CASH_WALLET_NOT_FOUND),不回落到任何别的户', async () => {
    const h = build({ missingRole: 'F_OPS' });
    const spec = buildSwapLegPlan({ fromIsFiat: false })[0]; // 腿 1:31 的现金借方 = F_OPS
    await expect(h.svc.initiateLegPending(ctx(false), spec, {})).rejects.toThrow(NotFoundException);
    expect(h.accounting.executePendingTransfer).toHaveBeenCalledTimes(1); // 30 已提交、31 在解析时就抛了,没有写出半笔 31
  });
});
