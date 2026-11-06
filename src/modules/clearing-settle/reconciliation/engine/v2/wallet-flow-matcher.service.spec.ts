// Phase B / T7: WalletFlowMatcherService unit tests (TDD).
//
// Matches the per-wallet internal source-of-truth (account_flows rows on the
// wallet's own cash account) against external statement lines for the same
// wallet, using ref-equality first and amount/time-window fuzzy fallback.
// 戊波一 T11：纳入 = 钱包现金户上 POSTED 的行，**排除 sourceType = RECON_ADJUSTMENT**
// （调账行只进余额不进匹配）；不再按 walletRef 标签 / 注册表码集过滤。

import { Prisma } from '@prisma/client';
import { WalletFlowMatcherService } from './wallet-flow-matcher.service';

const D = (n: string | number) => new Prisma.Decimal(n);

// 真实形状：现金户号 32 位补零十六进制。夹具不写 tbAccountId 时默认落在 CASH（本钱包的现金户）；
// OTHER 代表同一钱包标签之外的别的户（应付 / 别的钱包的现金户）。
const CASH = 'cafe0000000000000000000000000001';
const OTHER = 'beef0000000000000000000000000002';

function makePrismaMock(flows: any[]) {
  return {
    accountFlow: {
      findMany: jest.fn(async ({ where }: any) => {
        return flows.filter((f) => {
          // 按户取：必须按现金户号查，不是按 walletRef 标签。
          if ((f.tbAccountId ?? CASH) !== where.tbAccountId) return false;
          if (where.transferType && (f.transferType ?? 'POSTED') !== where.transferType) return false;
          if (where.sourceType?.not !== undefined && (f.sourceType ?? 'DEPOSIT') === where.sourceType.not) return false;
          const eff = (x: any) => x.effectiveDate ?? x.createdAt.toISOString().slice(0, 10);
          if (where.OR) {
            // 忠实复刻 effectiveCutoffFilter 的三支（同 wallet-balance-checker 那份）。
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
        }));
      }),
    },
  };
}

// Local test factory for external statement lines (Pass 3 fixtures).
function extLine(direction: 'IN' | 'OUT', amount: number, externalRef: string | null, datetime = new Date('2026-06-26T10:00:00Z')) {
  return { id: `ext-${externalRef ?? amount}-${datetime.getTime()}`, direction, amount: D(amount), externalRef, datetime };
}

// Default FundsOrderService stub for pre-Pass-3 tests: no non-terminal
// orders on the wallet, so leftover external lines stay orphanExternal —
// matches those tests' original (pre-Round-3) expectations.
const noOrdersFundsOrderService: any = {
  findNonTerminalByWallet: jest.fn().mockResolvedValue([]),
};

describe('WalletFlowMatcherService', () => {
  const cutoff = new Date('2026-06-26T23:59:59Z');

  it('matches via externalRef equality (ref-match)', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-1',
        direction: 'IN',
        amount: 1000,
        externalRef: '0xabc',
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        { id: 'ext-1', direction: 'IN', amount: D(1000), externalRef: '0xabc', datetime: new Date('2026-06-26T10:00:30Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toEqual({ internalFlowId: 'flow-1', externalLineId: 'ext-1', via: 'ref' });
    expect(result.orphanInternal).toHaveLength(0);
    expect(result.orphanExternal).toHaveLength(0);
    expect(result.mismatch).toHaveLength(0);
  });

  it('internal flow with externalRef + no matching external line → orphan_internal', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-2',
        direction: 'IN',
        amount: 500,
        externalRef: '0xdef',
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T11:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [],
      cutoff,
      decimals: 0,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.orphanInternal).toHaveLength(1);
    expect(result.orphanInternal[0]).toMatchObject({
      internalFlowId: 'flow-2',
      eventCode: 'DEPOSIT_CONFIRMED',
      amount: '500',
      direction: 'IN',
      externalRef: '0xdef',
    });
  });

  it('no internal + external line → orphan_external', async () => {
    const prisma = makePrismaMock([]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        { id: 'ext-2', direction: 'IN', amount: D(2000), externalRef: '0xzzz', datetime: new Date('2026-06-26T12:00:00Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(result.orphanExternal).toHaveLength(1);
    expect(result.orphanExternal[0]).toMatchObject({
      externalLineId: 'ext-2',
      amount: '2000',
      direction: 'IN',
      externalRef: '0xzzz',
    });
  });

  it('same ref but different amount → mismatch', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-3',
        direction: 'IN',
        amount: 100,
        externalRef: '0xsame',
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        { id: 'ext-3', direction: 'IN', amount: D(101), externalRef: '0xsame', datetime: new Date('2026-06-26T10:00:30Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.mismatch).toHaveLength(1);
    expect(result.mismatch[0]).toEqual({
      internalFlowId: 'flow-3',
      externalLineId: 'ext-3',
      internalAmount: '100',
      externalAmount: '101',
      ref: '0xsame',
    });
  });

  it('no ref but same amount + direction + within window → fuzzy match', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-4',
        direction: 'IN',
        amount: 750,
        externalRef: null,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        { id: 'ext-4', direction: 'IN', amount: D(750), externalRef: null, datetime: new Date('2026-06-26T10:30:00Z') },
      ],
      cutoff,
      decimals: 0,
      timeWindowMinutes: 60,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toEqual({ internalFlowId: 'flow-4', externalLineId: 'ext-4', via: 'fuzzy' });
  });

  it('fuzzy candidate outside time window → orphan on both sides', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-5',
        direction: 'IN',
        amount: 750,
        externalRef: null,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        // 2 hours later → outside default 60-min window
        { id: 'ext-5', direction: 'IN', amount: D(750), externalRef: null, datetime: new Date('2026-06-26T12:00:00Z') },
      ],
      cutoff,
      decimals: 0,
      timeWindowMinutes: 60,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.orphanInternal).toHaveLength(1);
    expect(result.orphanExternal).toHaveLength(1);
  });

  it('a cash-account deposit row with direction IN matches an external IN line', async () => {
    // 戊波一：现金户上的行方向 = 钱进这个户。充值落地 = 现金户借方行 = IN，
    // 与托管对账单上的 IN 行同向，直接配上。
    const prisma = makePrismaMock([
      {
        id: 'flow-dep',
        direction: 'IN',
        amount: 2500,
        externalRef: '0xdeposit',
        eventCode: 'DEPOSIT_CONFIRMED',
        sourceType: 'DEPOSIT',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        { id: 'ext-dep', direction: 'IN', amount: D(2500), externalRef: '0xdeposit', datetime: new Date('2026-06-26T10:00:20Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(result.matched).toEqual([{ internalFlowId: 'flow-dep', externalLineId: 'ext-dep', via: 'ref' }]);
    expect(result.orphanInternal).toHaveLength(0);
    expect(result.orphanExternal).toHaveLength(0);
  });

  it('only rows on the wallet cash account are candidates — rows on any other account are ignored', async () => {
    // 应付 / 暂挂 / 别的钱包的现金户上的行，托管对账单不认识，不得变成孤儿。
    const prisma = makePrismaMock([
      { id: 'flow-payable', direction: 'IN', amount: 1000, externalRef: '0xp', eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'), tbAccountId: OTHER },
      { id: 'flow-cash', direction: 'IN', amount: 1000, externalRef: '0xp', eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z') },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [],
      cutoff,
      decimals: 0,
    });
    expect(result.orphanInternal.map((o) => o.internalFlowId)).toEqual(['flow-cash']);
  });

  it('rows with sourceType RECON_ADJUSTMENT are excluded from candidates (they count in the balance, not in matching)', async () => {
    const prisma = makePrismaMock([
      { id: 'flow-adj', direction: 'OUT', amount: 300, externalRef: null, eventCode: 'RECON_ADJUSTMENT_POSTED',
        sourceType: 'RECON_ADJUSTMENT', createdAt: new Date('2026-06-26T11:00:00Z') },
      // 同一户上的普通行照常进池——排除的是调账行，不是整户
      { id: 'flow-normal', direction: 'IN', amount: 900, externalRef: '0xn', eventCode: 'DEPOSIT_CONFIRMED',
        sourceType: 'DEPOSIT', createdAt: new Date('2026-06-26T10:00:00Z') },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [],
      cutoff,
      decimals: 0,
    });
    expect(result.orphanInternal.map((o) => o.internalFlowId)).toEqual(['flow-normal']);
    expect(result.matched).toHaveLength(0);
  });

  it('an adjustment row is never fuzzy-matched onto a same-amount external line', async () => {
    // 调账行若进池，会按"金额+方向+时窗"误配到同额的外部行上，把真差异抹平。
    const prisma = makePrismaMock([
      { id: 'flow-adj2', direction: 'OUT', amount: 300, externalRef: null, eventCode: 'RECON_ADJUSTMENT_POSTED',
        sourceType: 'RECON_ADJUSTMENT', createdAt: new Date('2026-06-26T10:00:00Z') },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      cashTbAccountId: CASH,
      externalLines: [
        { id: 'ext-300', direction: 'OUT', amount: D(300), externalRef: null, datetime: new Date('2026-06-26T10:00:10Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.orphanExternal).toHaveLength(1);
  });

  it('PENDING transfers are not on any statement yet → not candidates', async () => {
    const prisma = makePrismaMock([
      { id: 'flow-pending', direction: 'OUT', amount: 100, externalRef: null, eventCode: 'WITHDRAW_LOCK',
        transferType: 'PENDING', createdAt: new Date('2026-06-26T10:00:00Z') },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust', cashTbAccountId: CASH, externalLines: [], cutoff, decimals: 0,
    });
    expect(result.orphanInternal).toHaveLength(0);
  });

  it('no cash account (walletRef is not a wallet — unattributed external account) → no internal side, lines stay orphans', async () => {
    const prisma = makePrismaMock([
      { id: 'flow-x', direction: 'IN', amount: 100, externalRef: '0xx', eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z') },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'EXT-ACCT-1',
      cashTbAccountId: null,
      externalLines: [
        { id: 'ext-x', direction: 'IN', amount: D(100), externalRef: '0xx', datetime: new Date('2026-06-26T10:00:10Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(prisma.accountFlow.findMany).not.toHaveBeenCalled();
    expect(result.orphanInternal).toHaveLength(0);
    expect(result.orphanExternal).toHaveLength(1);
  });

  it('back-valued internal flow (effectiveDate < cutoff day) enters the candidate pool', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-bv',
        direction: 'IN',
        amount: 700,
        externalRef: '0xbv',
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-27T09:00:00Z'), // 物理写入在 cutoff 之后
        effectiveDate: '2026-06-25',                  // 生效日回填到截止日之前 → 必须进池
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({ walletRef: 'w-cust', cashTbAccountId: CASH, externalLines: [], cutoff, decimals: 0 });
    expect(result.orphanInternal).toHaveLength(1);
  });

  // ── Pass 3: in-transit matching (orphan external ↔ non-terminal funds order) ──
  describe('third pass: in-transit matching', () => {
    const now = new Date('2026-06-26T10:00:00Z');

    function makeMatcherWithFundsOrders(fundsOrderService: any) {
      const prisma = makePrismaMock([]); // no internal flows → external lines fall straight to leftovers
      return new WalletFlowMatcherService(prisma as any, fundsOrderService);
    }

    it('third pass: unmatched external line pairs with non-terminal funds order → inTransit', async () => {
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo1', fundsOrderNo: 'FO-9', status: 'CONFIRMING', direction: 'IN',
            amount: D(100), netAmount: D(100),
            txHash: '0xabc', referenceNo: null, providerTxnId: null, createdAt: now,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, externalLines: [extLine('IN', 100, '0xabc')], cutoff: now, decimals: 0 });
      expect(res.inTransit).toHaveLength(1);
      expect(res.inTransit[0].fundsOrderNo).toBe('FO-9');
      expect(res.orphanExternal).toHaveLength(0);
    });

    it('third pass: no candidate → stays orphanExternal', async () => {
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, externalLines: [extLine('IN', 100, '0xabc')], cutoff: now, decimals: 0 });
      expect(res.orphanExternal).toHaveLength(1);
      expect(res.inTransit).toHaveLength(0);
    });

    it('third pass: ref conflict blocks fallback — 双方都有单号但不一致时禁止兜底配对', async () => {
      // External line carries '0xabc' but the only candidate carries '0xdef'.
      // Same amount + direction + within 72h — sub-pass B must still refuse:
      // when BOTH sides carry refs and they disagree, pairing them would
      // cross-wire two different real-world transfers.
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-conflict', fundsOrderNo: 'FO-CONFLICT', status: 'CONFIRMING', direction: 'IN',
            amount: D(100), netAmount: D(100),
            txHash: '0xdef', referenceNo: null, providerTxnId: null, createdAt: now,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, externalLines: [extLine('IN', 100, '0xabc', now)], cutoff: now, decimals: 0 });
      expect(res.inTransit).toHaveLength(0);
      expect(res.orphanExternal).toHaveLength(1);
    });

    it('third pass: sub-pass A beats earlier refless candidate — 单号精确优先于 createdAt 顺序', async () => {
      // Earlier candidate has no refs at all; later candidate's txHash exactly
      // matches the external line's ref. Sub-pass A (ref-exact) runs before
      // sub-pass B (fallback), so the later ref-exact candidate must win even
      // though the refless one sorts first by createdAt.
      const earlier = new Date('2026-06-26T08:00:00Z');
      const later = new Date('2026-06-26T09:00:00Z');
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-refless', fundsOrderNo: 'FO-REFLESS', status: 'CONFIRMING', direction: 'IN',
            amount: D(300), netAmount: D(300),
            txHash: null, referenceNo: null, providerTxnId: null, createdAt: earlier,
          },
          {
            id: 'fo-refhit', fundsOrderNo: 'FO-REFHIT', status: 'CONFIRMING', direction: 'IN',
            amount: D(300), netAmount: D(300),
            txHash: '0xhit', referenceNo: null, providerTxnId: null, createdAt: later,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, externalLines: [extLine('IN', 300, '0xhit', now)], cutoff: now, decimals: 0 });
      expect(res.inTransit).toHaveLength(1);
      expect(res.inTransit[0].fundsOrderNo).toBe('FO-REFHIT');
    });

    it('third pass determinism: 两张同额无单号候选单，按 createdAt 升序取第一', async () => {
      const earlier = new Date('2026-06-26T08:00:00Z');
      const later = new Date('2026-06-26T09:00:00Z');
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-later', fundsOrderNo: 'FO-LATER', status: 'CONFIRMING', direction: 'IN',
            amount: D(200), netAmount: D(200),
            txHash: null, referenceNo: null, providerTxnId: null, createdAt: later,
          },
          {
            id: 'fo-earlier', fundsOrderNo: 'FO-EARLIER', status: 'CONFIRMING', direction: 'IN',
            amount: D(200), netAmount: D(200),
            txHash: null, referenceNo: null, providerTxnId: null, createdAt: earlier,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({
        walletRef: 'W1',
        cashTbAccountId: CASH,
        externalLines: [extLine('IN', 200, null, now)],
        cutoff: now,
        decimals: 0,
      });
      expect(res.inTransit).toHaveLength(1);
      expect(res.inTransit[0].fundsOrderNo).toBe('FO-EARLIER');
    });

    // ── canonical-minor (T1): external line is ALREADY minor (分); ONLY the
    //    funds-order (元) needs 元→分. The matcher must NOT re-scale the
    //    external line. Regression guard for the Task A bug that套了两次 toMinor. ──

    // 用例 A：AED decimals=2，外部行 49800(分) OUT，钱包有一张非终态 funds_order
    // netAmount=498(元) 同方向 → 认领为在途，且 inTransit[0].amount === '49800'（分）。
    // 旧写法(ext 再套 toMinor)会把 49800 ×100 = 4980000，amountOk 直接不成立 → 认领失败，此断言红。
    it('用例A: ext 已是分(49800) + funds_order 498元 decimals=2 → 认领在途，amount==="49800"', async () => {
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-minor', fundsOrderNo: 'FO-MINOR', status: 'CONFIRMING', direction: 'OUT',
            amount: D(498), netAmount: D(498), // 元
            txHash: '0xr', referenceNo: null, providerTxnId: null, createdAt: now,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const result = await matcher.matchFlows({
        walletRef: 'w',
        cashTbAccountId: CASH,
        externalLines: [extLine('OUT', 49800, '0xr')], // 分
        cutoff, decimals: 2,
      } as any);
      expect(result.inTransit).toHaveLength(1);
      expect(result.inTransit[0].fundsOrderNo).toBe('FO-MINOR');
      expect(result.inTransit[0].amount).toBe('49800');
    });

    // 用例 B：USDT decimals=6，外部行 3000000(分) + funds_order amount=3(元)
    // → 认领成功，amount==='3000000'（分）。旧写法会把 ext ×10^6 → 认领失败。
    it('用例B: ext 已是分(3000000) + funds_order 3元 decimals=6(USDT) → 认领在途，amount==="3000000"', async () => {
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-usdt', fundsOrderNo: 'FO-USDT', status: 'CONFIRMING', direction: 'IN',
            amount: D(3), netAmount: D(3), // 元
            txHash: '0xu', referenceNo: null, providerTxnId: null, createdAt: now,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const result = await matcher.matchFlows({
        walletRef: 'w',
        cashTbAccountId: CASH,
        externalLines: [extLine('IN', 3000000, '0xu')], // 分
        cutoff, decimals: 6,
      } as any);
      expect(result.inTransit).toHaveLength(1);
      expect(result.inTransit[0].fundsOrderNo).toBe('FO-USDT');
      expect(result.inTransit[0].amount).toBe('3000000');
    });

    // funds_order 元含小数(AED 4380.56)→分(438056) 走 Prisma.Decimal 不炸 BigInt；
    // 外部行同额已是分(438056)。只换 funds_order 一侧。
    it('funds_order 元含小数 4380.56 → 分 438056(不炸 BigInt)，ext 438056(分)直用', async () => {
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-frac', fundsOrderNo: 'FO-FRAC', status: 'CONFIRMING', direction: 'OUT',
            amount: D(4380.56), netAmount: D(4380.56), // 元
            txHash: '0xr', referenceNo: null, providerTxnId: null, createdAt: now,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const result = await matcher.matchFlows({
        walletRef: 'w',
        cashTbAccountId: CASH,
        externalLines: [extLine('OUT', 438056, '0xr')], // 分
        cutoff, decimals: 2,
      } as any);
      expect(result.inTransit).toHaveLength(1);
      expect(result.inTransit[0].amount).toBe('438056');
    });

    it('third pass: in-transit entry carries the external line timestamp (红3甲·防线上半)', async () => {
      const at = new Date('2026-06-25T16:00:00Z');
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([
          {
            id: 'fo-ts', fundsOrderNo: 'FO-TS', status: 'CONFIRMING', direction: 'IN',
            amount: D(100), netAmount: D(100),
            txHash: '0xts', referenceNo: null, providerTxnId: null, createdAt: at,
          },
        ]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, externalLines: [extLine('IN', 100, '0xts', at)], cutoff: now, decimals: 0 });
      expect(res.inTransit).toHaveLength(1);
      expect(res.inTransit[0].externalTimestamp).toEqual(at);
    });
  });
});
