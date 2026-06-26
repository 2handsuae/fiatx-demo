// Phase B / T7: WalletFlowMatcherService unit tests (TDD).
//
// Matches the per-wallet internal source-of-truth (account_flows where
// walletRef=? AND isExternalCrossing=true) against external statement lines
// for the same wallet, using ref-equality first and amount/time-window fuzzy
// fallback.

import { Prisma } from '@prisma/client';
import { WalletFlowMatcherService } from './wallet-flow-matcher.service';

const D = (n: string | number) => new Prisma.Decimal(n);

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
          amount: new Prisma.Decimal(f.amount),
        }));
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
