// Phase B / T7: WalletFlowMatcherService unit tests (TDD).
//
// Matches the per-wallet internal source-of-truth (account_flows where
// walletRef=? AND isExternalCrossing=true) against external statement lines
// for the same wallet, using ref-equality first and amount/time-window fuzzy
// fallback.

import { Prisma } from '@prisma/client';
import { WalletFlowMatcherService } from './wallet-flow-matcher.service';

const D = (n: string | number) => new Prisma.Decimal(n);

// Default tbAccountId every flow falls back to when the fixture doesn't set
// one. The registry mock maps it to code=100 (CLIENT_PAYABLE) so flows pass
// the matcher's owned-code filter unless a fixture overrides tbAccountId to
// 'tb-aggregate' (mapped to code=1 / CLIENT_ASSET — aggregate leg, excluded).
const DEFAULT_TB_OWNED = 'tb-owned';
const DEFAULT_TB_AGGREGATE = 'tb-aggregate';

function makePrismaMock(flows: any[]) {
  return {
    accountFlow: {
      findMany: jest.fn(async ({ where }: any) => {
        return flows.filter((f) => {
          if (where.walletRef && f.walletRef !== where.walletRef) return false;
          if (where.isExternalCrossing !== undefined && (f.isExternalCrossing ?? false) !== where.isExternalCrossing) return false;
          if (where.createdAt?.lte && f.createdAt > where.createdAt.lte) return false;
          return true;
        }).map((f) => ({
          ...f,
          tbAccountId: f.tbAccountId ?? DEFAULT_TB_OWNED,
          amount: new Prisma.Decimal(f.amount),
        }));
      }),
    },
    tbAccountRegistry: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where.tbAccountId?.in ?? [];
        const rows: Array<{ tbAccountId: string; code: number }> = [];
        for (const id of ids) {
          if (id === DEFAULT_TB_OWNED) rows.push({ tbAccountId: id, code: 100 });   // CLIENT_PAYABLE (owned)
          else if (id === DEFAULT_TB_AGGREGATE) rows.push({ tbAccountId: id, code: 1 }); // CLIENT_ASSET (aggregate)
          // any other id → no registry row → matcher should skip the flow
        }
        return rows;
      }),
    },
  };
}

describe('WalletFlowMatcherService', () => {
  const cutoff = new Date('2026-06-26T23:59:59Z');

  it('matches via externalRef equality (ref-match)', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-1',
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 1000,
        externalRef: '0xabc',
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [
        { id: 'ext-1', direction: 'IN', amount: D(1000), externalRef: '0xabc', datetime: new Date('2026-06-26T10:00:30Z') },
      ],
      cutoff,
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
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 500,
        externalRef: '0xdef',
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T11:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [],
      cutoff,
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
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [
        { id: 'ext-2', direction: 'IN', amount: D(2000), externalRef: '0xzzz', datetime: new Date('2026-06-26T12:00:00Z') },
      ],
      cutoff,
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
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 100,
        externalRef: '0xsame',
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [
        { id: 'ext-3', direction: 'IN', amount: D(101), externalRef: '0xsame', datetime: new Date('2026-06-26T10:00:30Z') },
      ],
      cutoff,
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
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 750,
        externalRef: null,
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [
        { id: 'ext-4', direction: 'IN', amount: D(750), externalRef: null, datetime: new Date('2026-06-26T10:30:00Z') },
      ],
      cutoff,
      timeWindowMinutes: 60,
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toEqual({ internalFlowId: 'flow-4', externalLineId: 'ext-4', via: 'fuzzy' });
  });

  it('fuzzy candidate outside time window → orphan on both sides', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-5',
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 750,
        externalRef: null,
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-26T10:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [
        // 2 hours later → outside default 60-min window
        { id: 'ext-5', direction: 'IN', amount: D(750), externalRef: null, datetime: new Date('2026-06-26T12:00:00Z') },
      ],
      cutoff,
      timeWindowMinutes: 60,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.orphanInternal).toHaveLength(1);
    expect(result.orphanExternal).toHaveLength(1);
  });

  it('excludes flows landing on aggregate codes (1/50) — same slice as balanceChecker', async () => {
    // Aggregate leg (e.g. CLIENT_ASSET=1 / FIRM_ASSET=50) shares the walletRef
    // for traceability but does not belong to the wallet's external statement.
    // The matcher must drop these before matching, otherwise pass mode produces
    // bogus orphanInternal entries that the recon engine cannot reconcile.
    const prisma = makePrismaMock([
      {
        id: 'flow-agg',
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 1000,
        externalRef: '0xaggregate',
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        createdAt: new Date('2026-06-26T10:00:00Z'),
        tbAccountId: DEFAULT_TB_AGGREGATE, // → registry code=1 (CLIENT_ASSET)
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [],
      cutoff,
    });
    // Aggregate-code flow must not surface as orphan_internal — the external
    // statement only mirrors owned-account activity (PAYABLE/SUSPENSE/firm-equity).
    expect(result.orphanInternal).toHaveLength(0);
    expect(result.matched).toHaveLength(0);
  });

  it('excludes flows whose tbAccountId is not in the registry (defensive)', async () => {
    // If TB registry can't classify the leg (orphan account / stale data /
    // leading-zero padding mismatch between flows and registry), the matcher
    // must skip the flow rather than treat it as evidence. Same defensive
    // rule WalletBalanceChecker applies (`if (!reg) continue;`).
    const prisma = makePrismaMock([
      {
        id: 'flow-unknown',
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 1000,
        externalRef: '0xunknown',
        isExternalCrossing: true,
        eventCode: 'WITHDRAW_FEE_POST',
        createdAt: new Date('2026-06-26T10:00:00Z'),
        tbAccountId: 'tb-not-in-registry',
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [],
      cutoff,
    });
    expect(result.orphanInternal).toHaveLength(0);
    expect(result.matched).toHaveLength(0);
  });

  it('excludes flows where isExternalCrossing=false (internal reclasses)', async () => {
    const prisma = makePrismaMock([
      // This is e.g. SUSPENSE→PAYABLE — has walletRef but does not cross external boundary
      {
        id: 'flow-internal',
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 1000,
        externalRef: null,
        isExternalCrossing: false,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        createdAt: new Date('2026-06-26T11:00:00Z'),
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any);
    const result = await svc.matchFlows({
      walletRef: 'w-cust',
      externalLines: [],
      cutoff,
    });
    // The internal reclass must not show up as orphan_internal — it never
    // crossed external so external statement is not expected to know about it.
    expect(result.orphanInternal).toHaveLength(0);
    expect(result.matched).toHaveLength(0);
  });
});
