// Phase B / T7: WalletFlowMatcherService unit tests (TDD).
//
// Matches the per-wallet internal source-of-truth (account_flows rows on the
// wallet's own cash account) against external statement lines for the same
// wallet, using ref-equality first and amount/time-window fuzzy fallback.
// 戊波一 T11：纳入 = 钱包现金户上 POSTED 的行；不再按 walletRef 标签 / 注册表码集过滤。
// 戊波二 T9b：调账流水不再按 sourceType 整体排除——两锚皆空的调账流水不进池（只进余额），
// 有锚的进池由第 0 轮按锚配对（spec §4.5）；认损补缺单的记短缺流水（sourceType INTERNAL_TRANSFER）同走第 0 轮。

import { Prisma } from '@prisma/client';
import { WalletFlowMatcherService } from './wallet-flow-matcher.service';

const D = (n: string | number) => new Prisma.Decimal(n);

// 真实形状：现金户号 32 位补零十六进制。夹具不写 tbAccountId 时默认落在 CASH（本钱包的现金户）；
// OTHER 代表同一钱包标签之外的别的户（应付 / 别的钱包的现金户）。
const CASH = 'cafe0000000000000000000000000001';
const OTHER = 'beef0000000000000000000000000002';

function makePrismaMock(flows: any[]) {
  const eff = (x: any) => x.effectiveDate ?? x.createdAt.toISOString().slice(0, 10);
  // 忠实复刻 effectiveCutoffFilter 的三支（同 wallet-balance-checker 那份）。
  const cutoffBranch = (f: any, cond: any): boolean => {
    if (cond.effectiveDate?.lt !== undefined) return eff(f) < cond.effectiveDate.lt;
    if (eff(f) !== cond.effectiveDate) return false;
    if (cond.createdAt?.lte) return f.createdAt <= cond.createdAt.lte;
    if (cond.createdAt?.gt) return f.createdAt > cond.createdAt.gt;
    return true;
  };
  // 递归复刻 where：按户取 / POSTED / sourceType not / id in / AND / OR（OR 的分支要么是截止点三支，要么是普通条件）。
  const matches = (f: any, w: any): boolean => {
    if (w.tbAccountId !== undefined && (f.tbAccountId ?? CASH) !== w.tbAccountId) return false;
    if (w.transferType && (f.transferType ?? 'POSTED') !== w.transferType) return false;
    if (w.sourceType?.not !== undefined && (f.sourceType ?? 'DEPOSIT') === w.sourceType.not) return false;
    if (w.id?.in && !w.id.in.includes(f.id)) return false;
    if (w.AND && !w.AND.every((x: any) => matches(f, x))) return false;
    if (w.OR && !w.OR.some((c: any) => (c.effectiveDate !== undefined ? cutoffBranch(f, c) : matches(f, c)))) return false;
    return true;
  };
  return {
    accountFlow: {
      findMany: jest.fn(async ({ where }: any) => {
        return flows.filter((f) => matches(f, where)).map((f) => ({
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
      externalLines: [],
      cutoff,
      decimals: 0,
    });
    expect(result.orphanInternal.map((o) => o.internalFlowId)).toEqual(['flow-cash']);
  });

  it('anchorless RECON_ADJUSTMENT rows are excluded from candidates (they count in the balance, not in matching)', async () => {
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
      cashTbAccountId: CASH, explainedAnchors: [],
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
      cashTbAccountId: CASH, explainedAnchors: [],
      externalLines: [
        { id: 'ext-300', direction: 'OUT', amount: D(300), externalRef: null, datetime: new Date('2026-06-26T10:00:10Z') },
      ],
      cutoff,
      decimals: 0,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.orphanExternal).toHaveLength(1);
  });

  // ── Pass 0：锚配对（戊波二 T9b，spec §4.5）──────────────────────────────────
  describe('pass 0: anchor pairing of posted adjustments / recognized shortfalls', () => {
    const at = (h: number) => new Date(`2026-06-26T${String(h).padStart(2, '0')}:00:00Z`);
    const run = (flows: any[], externalLines: any[], explainedAnchors: any[]) => {
      const prisma = makePrismaMock(flows);
      const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
      return svc.matchFlows({ walletRef: 'w-cust', cashTbAccountId: CASH, externalLines, explainedAnchors, cutoff, decimals: 0 });
    };
    const ext = (id: string, direction: 'IN' | 'OUT', amount: number, externalRef: string | null = null) =>
      ({ id, direction, amount: D(amount), externalRef, datetime: at(10) });
    const deposit = (id: string, direction: 'IN' | 'OUT', amount: number, externalRef: string | null) =>
      ({ id, direction, amount, externalRef, eventCode: 'DEPOSIT_CONFIRMED', sourceType: 'DEPOSIT', createdAt: at(10) });
    const adj = (id: string, direction: 'IN' | 'OUT', amount: number) =>
      ({ id, direction, amount, externalRef: null, eventCode: 'RECON_ADJUSTMENT_POSTED', sourceType: 'RECON_ADJUSTMENT', createdAt: at(12) });

    it('external-line anchor + flow anchor, signed sum equals the external line → ONE matched pair, resolution = the adjustment no (scene 16 shape)', async () => {
      // 内部记 IN 3000，对账单只有 IN 2925（少 75）；调账 OUT 75，两个锚都记着。
      const r = await run(
        [deposit('f-orig', 'IN', 3000, '0xr'), adj('f-adj', 'OUT', 75)],
        [ext('e-1', 'IN', 2925, '0xr')],
        [{ flowId: 'f-adj', anchorFlowId: 'f-orig', anchorExternalLineId: 'e-1', byNo: 'ADJ1' }],
      );
      expect(r.matched).toEqual([{
        internalFlowId: 'f-orig', externalLineId: 'e-1', via: 'anchor', resolution: 'ADJ1', groupFlowIds: ['f-orig', 'f-adj'],
      }]);
      expect(r.mismatch).toHaveLength(0);
      expect(r.orphanInternal).toHaveLength(0);
      expect(r.orphanExternal).toHaveLength(0);
    });

    it('external-line anchor only (no flow anchor): the adjustment flow alone is compared with the external line', async () => {
      // 外部多出一笔 IN 500 的银行利息，内部没有；补记 IN 500，只锚外部行。
      const r = await run([adj('f-adj', 'IN', 500)], [ext('e-int', 'IN', 500)],
        [{ flowId: 'f-adj', anchorExternalLineId: 'e-int', byNo: 'ADJ2' }]);
      expect(r.matched).toEqual([{
        internalFlowId: 'f-adj', externalLineId: 'e-int', via: 'anchor', resolution: 'ADJ2', groupFlowIds: ['f-adj'],
      }]);
      expect(r.orphanInternal).toHaveLength(0);
      expect(r.orphanExternal).toHaveLength(0);
    });

    it('a shortfall-recognition flow (sourceType INTERNAL_TRANSFER, an OUT) pairs with its anchored external line just the same (ITR no)', async () => {
      // 事故路：托管里幽灵转出一笔 OUT 750；认损补缺单记短缺（码 91）OUT 750，锚 = 那条外部行。
      const r = await run(
        [{ id: 'f-91', direction: 'OUT', amount: 750, externalRef: null, eventCode: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', sourceType: 'INTERNAL_TRANSFER', createdAt: at(12) }],
        [ext('e-ghost', 'OUT', 750, 'GHOST')],
        [{ flowId: 'f-91', anchorExternalLineId: 'e-ghost', byNo: 'ITR1' }],
      );
      expect(r.matched).toEqual([{
        internalFlowId: 'f-91', externalLineId: 'e-ghost', via: 'anchor', resolution: 'ITR1', groupFlowIds: ['f-91'],
      }]);
      expect(r.orphanExternal).toHaveLength(0);
    });

    it('external-line anchor, signed sum differs from the external line → AMOUNT_MISMATCH carrying the group net (an under-corrected adjustment does not explain the row)', async () => {
      // 差 75，但调账只做了 OUT 50：组内净额 2950 ≠ 对账单 2925。
      const r = await run(
        [deposit('f-orig', 'IN', 3000, '0xr'), adj('f-adj', 'OUT', 50)],
        [ext('e-1', 'IN', 2925, '0xr')],
        [{ flowId: 'f-adj', anchorFlowId: 'f-orig', anchorExternalLineId: 'e-1', byNo: 'ADJ3' }],
      );
      expect(r.matched).toHaveLength(0);
      expect(r.mismatch).toEqual([{
        internalFlowId: 'f-orig', externalLineId: 'e-1', internalAmount: '2950', externalAmount: '2925', ref: '0xr',
      }]);
      expect(r.orphanInternal).toHaveLength(0);
      expect(r.orphanExternal).toHaveLength(0);
    });

    it('flow anchor only, net 0 → the pair cancels inside the wallet: MATCHED internal-to-internal (no external line), resolution = the adjustment no', async () => {
      // 重复入账 IN 800，冲正 OUT 800：净 0，对账单上本来就没有它。
      const r = await run(
        [deposit('f-dup', 'IN', 800, '0xdup'), adj('f-rev', 'OUT', 800)],
        [],
        [{ flowId: 'f-rev', anchorFlowId: 'f-dup', byNo: 'ADJ4' }],
      );
      expect(r.matched).toEqual([{
        internalFlowId: 'f-dup', externalLineId: null, via: 'anchor', resolution: 'ADJ4', groupFlowIds: ['f-dup', 'f-rev'],
      }]);
      expect(r.orphanInternal).toHaveLength(0);
    });

    it('flow anchor only, net ≠ 0 → ONE synthetic internal row (net amount, net direction, the anchor flow\'s externalRef) enters Pass 1', async () => {
      // 内部 IN 1000（ref R），冲正了 OUT 100，对账单 IN 900（ref R）：合成行 IN 900 / R 与对账单按单号配上。
      const r = await run(
        [deposit('f-orig', 'IN', 1000, 'R'), adj('f-adj', 'OUT', 100)],
        [ext('e-r', 'IN', 900, 'R')],
        [{ flowId: 'f-adj', anchorFlowId: 'f-orig', byNo: 'ADJ5' }],
      );
      expect(r.matched).toEqual([{ internalFlowId: 'f-orig', externalLineId: 'e-r', via: 'ref' }]);
      expect(r.mismatch).toHaveLength(0);
      expect(r.orphanInternal).toHaveLength(0);
      expect(r.orphanExternal).toHaveLength(0);
    });

    it('flow anchor only, net ≠ 0 and nothing on the statement agrees → the synthetic row is the orphan (net amount, not the original row amount)', async () => {
      const r = await run(
        [deposit('f-orig', 'IN', 1000, 'R'), adj('f-adj', 'OUT', 100)],
        [],
        [{ flowId: 'f-adj', anchorFlowId: 'f-orig', byNo: 'ADJ5' }],
      );
      expect(r.orphanInternal).toEqual([{
        internalFlowId: 'f-orig', eventCode: 'DEPOSIT_CONFIRMED', amount: '900', direction: 'IN', externalRef: 'R',
      }]);
      expect(r.matched).toHaveLength(0);
    });

    it('an anchored adjustment flow is in the candidate pool, an anchorless one is not (it only counts in the balance)', async () => {
      const r = await run(
        [adj('f-anchored', 'OUT', 800), adj('f-bare', 'OUT', 300)],
        [],
        [
          { flowId: 'f-anchored', anchorFlowId: 'not-in-this-wallet', byNo: 'ADJ6' },
          { flowId: 'f-bare', byNo: 'ADJ7' },
        ],
      );
      // 锚在本钱包都落空 → 留在池里照常走后面的轮次（这里没有对手，成了孤儿，看得见）；无锚的那条压根不在池里。
      expect(r.orphanInternal.map((o) => o.internalFlowId)).toEqual(['f-anchored']);
    });

    it('reattribution: the wronged-from wallet cancels its ghost against the OUT leg; the rightful wallet pairs its IN leg with the anchored external line (one adjustment, two wallets)', async () => {
      const anchors = [{ flowId: '', anchorFlowId: 'f-ghost', anchorExternalLineId: 'e-to', byNo: 'ADJ8' }];
      // 错记方钱包：幽灵 IN 875 + 改记现金对的 OUT 875；外部行 e-to 不是它的。
      const fromSide = await run(
        [deposit('f-ghost', 'IN', 875, 'X'), adj('f-cash-out', 'OUT', 875)],
        [],
        anchors.map((a) => ({ ...a, flowId: 'f-cash-out' })),
      );
      expect(fromSide.matched).toEqual([{
        internalFlowId: 'f-ghost', externalLineId: null, via: 'anchor', resolution: 'ADJ8', groupFlowIds: ['f-ghost', 'f-cash-out'],
      }]);
      expect(fromSide.orphanInternal).toHaveLength(0);
      // 正主方钱包：改记现金对的 IN 875 对上银行单上那条 IN 875；幽灵流水不是它的。
      const toSide = await run(
        [adj('f-cash-in', 'IN', 875)],
        [ext('e-to', 'IN', 875, 'ZANDREF')],
        anchors.map((a) => ({ ...a, flowId: 'f-cash-in' })),
      );
      expect(toSide.matched).toEqual([{
        internalFlowId: 'f-cash-in', externalLineId: 'e-to', via: 'anchor', resolution: 'ADJ8', groupFlowIds: ['f-cash-in'],
      }]);
      expect(toSide.orphanExternal).toHaveLength(0);
    });
  });

  it('截止点过滤在「非（调账流水 ∧ 两锚皆空）」组合之后仍然生效：截止点之后写入的同日流水（含有锚的调账流水）不进池', async () => {
    // cutoff = 2026-06-26T23:59:59Z = 迪拜 06-27 03:59:59；同日（06-27）、写入时刻晚于截止点又没越过当日日终 → 三支都不中
    const late = new Date('2026-06-27T01:00:00Z');
    const prisma = makePrismaMock([
      { id: 'flow-in-window', direction: 'IN', amount: 100, externalRef: '0xin', eventCode: 'DEPOSIT_CONFIRMED',
        sourceType: 'DEPOSIT', createdAt: new Date('2026-06-26T10:00:00Z') },
      { id: 'flow-late', direction: 'IN', amount: 200, externalRef: '0xlate', eventCode: 'DEPOSIT_CONFIRMED',
        sourceType: 'DEPOSIT', createdAt: late, effectiveDate: '2026-06-27' },
      { id: 'flow-late-adj', direction: 'OUT', amount: 50, externalRef: null, eventCode: 'RECON_ADJUSTMENT_POSTED',
        sourceType: 'RECON_ADJUSTMENT', createdAt: late, effectiveDate: '2026-06-27' },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust', cashTbAccountId: CASH,
      explainedAnchors: [{ flowId: 'flow-late-adj', anchorFlowId: 'flow-late', byNo: 'ADJ9' }],
      externalLines: [], cutoff, decimals: 0,
    });
    expect(result.orphanInternal.map((o) => o.internalFlowId)).toEqual(['flow-in-window']);
    expect(result.matched).toHaveLength(0);
  });

  it('PENDING transfers are not on any statement yet → not candidates', async () => {
    const prisma = makePrismaMock([
      { id: 'flow-pending', direction: 'OUT', amount: 100, externalRef: null, eventCode: 'WITHDRAW_LOCK',
        transferType: 'PENDING', createdAt: new Date('2026-06-26T10:00:00Z') },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({
      walletRef: 'w-cust', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [], cutoff, decimals: 0,
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
      cashTbAccountId: null, explainedAnchors: [],
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
    const result = await svc.matchFlows({ walletRef: 'w-cust', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [], cutoff, decimals: 0 });
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
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [extLine('IN', 100, '0xabc')], cutoff: now, decimals: 0 });
      expect(res.inTransit).toHaveLength(1);
      expect(res.inTransit[0].fundsOrderNo).toBe('FO-9');
      expect(res.orphanExternal).toHaveLength(0);
    });

    it('third pass: no candidate → stays orphanExternal', async () => {
      const fundsOrderService = {
        findNonTerminalByWallet: jest.fn().mockResolvedValue([]),
      };
      const matcher = makeMatcherWithFundsOrders(fundsOrderService);
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [extLine('IN', 100, '0xabc')], cutoff: now, decimals: 0 });
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
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [extLine('IN', 100, '0xabc', now)], cutoff: now, decimals: 0 });
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
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [extLine('IN', 300, '0xhit', now)], cutoff: now, decimals: 0 });
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
        cashTbAccountId: CASH, explainedAnchors: [],
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
        cashTbAccountId: CASH, explainedAnchors: [],
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
        cashTbAccountId: CASH, explainedAnchors: [],
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
        cashTbAccountId: CASH, explainedAnchors: [],
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
      const res = await matcher.matchFlows({ walletRef: 'W1', cashTbAccountId: CASH, explainedAnchors: [], externalLines: [extLine('IN', 100, '0xts', at)], cutoff: now, decimals: 0 });
      expect(res.inTransit).toHaveLength(1);
      expect(res.inTransit[0].externalTimestamp).toEqual(at);
    });
  });
});
