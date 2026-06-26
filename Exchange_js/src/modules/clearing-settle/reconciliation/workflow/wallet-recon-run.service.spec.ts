// Phase B / T7: WalletReconRunService unit tests (TDD).
//
// Orchestrates the per-wallet engine:
//   1. Internal-identity pre-gate (sum payable+suspense == sum client_asset, etc.)
//   2. Per-wallet balance + flow checks (T6 + flow matcher)
//   3. Cross-wallet same-externalRef invariant (e.g. WITHDRAW_FEE_POST +
//      WITHDRAW_FEE_FIRM must have equal amounts)
//   4. Summarize → ReconciliationRun row (engineVersion='WALLET_V1').

import { Prisma } from '@prisma/client';
import { WalletReconRunService } from './wallet-recon-run.service';

const D = (n: string | number) => new Prisma.Decimal(n);

function makeDeps(overrides: any = {}) {
  // ── Identity-pre-gate inputs ──
  // accountFlow.groupBy is the cheapest way to sum amount per (tbAccountId, direction);
  // here we mock the higher-level call we'll add: a method that returns the per-code
  // aggregate. For test isolation we stub it directly via internalIdentity() spy.
  const reconciliationRun = {
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
  const reconciliationCase = {
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }: any) => ({ id: `case-${Math.random().toString(36).slice(2, 8)}`, ...data })),
    update: jest.fn(),
  };
  const reconciliationLineItem = { create: jest.fn(), createMany: jest.fn() };
  const externalBalance = { findMany: jest.fn().mockResolvedValue([]) };
  const externalStatementLine = { findMany: jest.fn().mockResolvedValue([]) };
  const accountFlow = {
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const tbAccountRegistry = { findMany: jest.fn().mockResolvedValue([]) };

  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    reconciliationRun,
    reconciliationCase,
    reconciliationLineItem,
    externalBalance,
    externalStatementLine,
    accountFlow,
    tbAccountRegistry,
  };

  const balanceChecker = {
    checkBalance: jest.fn().mockResolvedValue({
      pass: true,
      walletRef: 'w-default',
      walletKind: 'CUSTOMER',
      coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
      ownerNo: 'c-default',
      internal: { payable: 0n, suspense: 0n, total: 0n },
      external: 0n,
      delta: 0n,
    }),
  };
  const flowMatcher = {
    matchFlows: jest.fn().mockResolvedValue({
      matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
    }),
  };
  const tigerBeetle = {
    lookupAccounts: jest.fn().mockResolvedValue([]),
  };

  Object.assign(prisma, overrides.prisma ?? {});
  if (overrides.balanceChecker) Object.assign(balanceChecker, overrides.balanceChecker);
  if (overrides.flowMatcher) Object.assign(flowMatcher, overrides.flowMatcher);
  if (overrides.tigerBeetle) Object.assign(tigerBeetle, overrides.tigerBeetle);

  // Default identity-pre-gate: balanced (asset == liab, asset == equity).
  // Tests stub computeInternalIdentity directly on the service to bypass
  // TB lookup entirely; tigerBeetle mock is only there to satisfy DI.
  return { prisma, balanceChecker, flowMatcher, tigerBeetle };
}

describe('WalletReconRunService', () => {
  const cutoff = new Date('2026-06-26T23:59:59Z');

  it('internal balanced + no wallets to check → run.status=PASS, walletsChecked=0', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-1', runNo: 'RUN-WALLET-1', engineVersion: 'WALLET_V1',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([]); // no wallets

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    // Stub identity pre-gate to balanced.
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('PASS');
    expect(result.walletsChecked).toBe(0);
    expect(result.casesOpened).toBe(0);
    expect(deps.prisma.reconciliationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ engineVersion: 'WALLET_V1' }),
      }),
    );
  });

  it('internal NOT balanced → status=INTERNAL_BREAK, no per-wallet processing', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-2', runNo: 'RUN-WALLET-2', engineVersion: 'WALLET_V1',
    });

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({
      balanced: false,
      breaks: [{ ledger: 1, side: 'CLIENT', asset: '1000', liab: '900', delta: '100' }],
    });

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('INTERNAL_BREAK');
    expect(result.walletsChecked).toBe(0);
    expect(deps.balanceChecker.checkBalance).not.toHaveBeenCalled();
    expect(deps.flowMatcher.matchFlows).not.toHaveBeenCalled();
  });

  it('one wallet balance mismatch → 1 case opened, status=BREAK', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-3', runNo: 'RUN-WALLET-3', engineVersion: 'WALLET_V1',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-cust-1', closingBalance: D(1000), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-1' },
    ]);
    // Asset lookup for case
    deps.prisma.externalStatementLine.findMany.mockResolvedValue([]);

    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: false,
      walletRef: 'w-cust-1',
      walletKind: 'CUSTOMER',
      coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
      ownerNo: 'c-001',
      internal: { payable: 800n, suspense: 100n, total: 900n },
      external: 1000n,
      delta: 100n,
    });

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('BREAK');
    expect(result.walletsChecked).toBe(1);
    expect(result.casesOpened).toBeGreaterThanOrEqual(1);
    expect(deps.prisma.reconciliationCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletRef: 'w-cust-1',
          coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
          ownerNo: 'c-001',
          book: 'CUSTOMER',
        }),
      }),
    );
  });

  it('wallet has flow orphan_internal → case opened with line items', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-4', runNo: 'RUN-WALLET-4', engineVersion: 'WALLET_V1',
    });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-cust-2', closingBalance: D(0), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-2' },
    ]);
    // Balance passes — but flow has an orphan
    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: true,
      walletRef: 'w-cust-2', walletKind: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
      ownerNo: 'c-002', internal: { total: 0n }, external: 0n, delta: 0n,
    });
    deps.flowMatcher.matchFlows.mockResolvedValue({
      matched: [],
      orphanInternal: [
        { internalFlowId: 'flow-x', eventCode: 'DEPOSIT_CONFIRMED', amount: '500', direction: 'IN', externalRef: '0xabc' },
      ],
      orphanExternal: [],
      mismatch: [],
    });

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('BREAK');
    expect(result.orphanInternal).toBe(1);
    expect(result.casesOpened).toBeGreaterThanOrEqual(1);
    expect(deps.prisma.reconciliationLineItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchStatus: 'ORPHAN_INTERNAL',
          walletRef: 'w-cust-2',
          externalRef: '0xabc',
        }),
      }),
    );
  });

  it('cross-wallet same-ref invariant: two matches share ref with unequal amounts → cross_match_mismatch case', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({
      id: 'run-5', runNo: 'RUN-WALLET-5', engineVersion: 'WALLET_V1',
    });
    // Two wallets with externalBalance rows
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-cust', closingBalance: D(0), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-c' },
      { walletRef: 'w-firm-fee', closingBalance: D(0), book: 'FIRM', currency: 'USDT', accountRef: 'acc-f' },
    ]);
    deps.balanceChecker.checkBalance.mockImplementation(async ({ walletRef }: any) => ({
      pass: true, walletRef, walletKind: walletRef === 'w-cust' ? 'CUSTOMER' : 'FIRM',
      coaCode: walletRef === 'w-cust' ? 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE' : 'E.FIRM_FEE',
      ownerNo: walletRef === 'w-cust' ? 'c-001' : 'FIRM_FEE_USDT',
      internal: { total: 0n }, external: 0n, delta: 0n,
    }));
    // Each wallet has a matched flow with the SAME externalRef but different amounts.
    deps.flowMatcher.matchFlows.mockImplementation(async ({ walletRef }: any) => {
      if (walletRef === 'w-cust') {
        return {
          matched: [{ internalFlowId: 'flow-cust-1', externalLineId: 'ext-1', via: 'ref' }],
          orphanInternal: [], orphanExternal: [], mismatch: [],
        };
      }
      return {
        matched: [{ internalFlowId: 'flow-firm-1', externalLineId: 'ext-2', via: 'ref' }],
        orphanInternal: [], orphanExternal: [], mismatch: [],
      };
    });
    // After matchers run, the orchestrator queries the matched flows for cross-wallet check.
    deps.prisma.accountFlow.findMany.mockResolvedValue([
      { id: 'flow-cust-1', walletRef: 'w-cust', externalRef: 'WDR123:fee', direction: 'OUT', amount: D(10) },
      { id: 'flow-firm-1', walletRef: 'w-firm-fee', externalRef: 'WDR123:fee', direction: 'IN', amount: D(12) },
    ]);

    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

    const result = await svc.run({ cutoff });

    expect(result.status).toBe('BREAK');
    // The cross-ref case is one of the cases opened.
    const calls = deps.prisma.reconciliationCase.create.mock.calls;
    const crossCase = calls.find(([arg]: any[]) =>
      arg?.data?.coaCode === 'CROSS_REF' || /cross.?match/i.test(arg?.data?.caseNo ?? ''),
    );
    expect(crossCase).toBeDefined();
  });
});
