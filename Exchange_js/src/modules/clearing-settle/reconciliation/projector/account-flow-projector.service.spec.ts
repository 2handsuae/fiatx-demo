// src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts
//
// Phase B / T3: pure projection (`projectEvidence`) + idempotent persistence
// (`persist`). Each evidence row fans into exactly 2 flow rows — debit→OUT,
// credit→IN. Both rows share the evidence's transfer-level fields; each row
// carries the wallet ref of its own leg.

import { AccountFlowProjectorService, WalletRefMismatchError } from './account-flow-projector.service';

describe('AccountFlowProjectorService', () => {
  let service: AccountFlowProjectorService;

  beforeEach(() => {
    service = new AccountFlowProjectorService();
  });

  const baseEvidence = {
    tbTransferId: 'abc123',
    sourceType: 'DEPOSIT',
    sourceNo: 'DEP-001',
    eventCode: 'EVT_DEPOSIT_SUCCESS',
    debitCode: 'A.CUSTODY',
    creditCode: 'L.CLIENT_PAYABLE',
    debitTbAccountId: 'tb-debit-001',
    creditTbAccountId: 'tb-credit-002',
    amount: 100,
    assetCode: 'USD',
    traceId: 'trace-1',
    actorType: 'SYSTEM',
    actorId: 'SYSTEM',
    memo: null,
    pendingId: null,
    transferType: 'POSTED',
    debitWalletRef: 'wallet-debit',
    creditWalletRef: 'wallet-credit',
    externalRef: '0xdeadbeef',
    isExternalCrossing: true,
    createdAt: new Date('2026-06-26T12:00:00Z'),
  };

  describe('projectEvidence (pure)', () => {
    it('returns 2 rows: debit→OUT and credit→IN', () => {
      const rows = service.projectEvidence(baseEvidence as any);

      expect(rows).toHaveLength(2);

      const out = rows.find((r) => r.direction === 'OUT')!;
      const inn = rows.find((r) => r.direction === 'IN')!;

      expect(out.tbAccountId).toBe('tb-debit-001');
      expect(out.walletRef).toBe('wallet-debit');

      expect(inn.tbAccountId).toBe('tb-credit-002');
      expect(inn.walletRef).toBe('wallet-credit');
    });

    it('both rows share transfer-level fields (transferId/externalRef/eventCode/sourceType/sourceNo/transferType/assetCode/createdAt/isExternalCrossing/amount)', () => {
      const rows = service.projectEvidence(baseEvidence as any);

      for (const r of rows) {
        expect(r.tbTransferId).toBe('abc123');
        expect(r.externalRef).toBe('0xdeadbeef');
        expect(r.eventCode).toBe('EVT_DEPOSIT_SUCCESS');
        expect(r.sourceType).toBe('DEPOSIT');
        expect(r.sourceNo).toBe('DEP-001');
        expect(r.transferType).toBe('POSTED');
        expect(r.assetCode).toBe('USD');
        expect(r.createdAt).toEqual(new Date('2026-06-26T12:00:00Z'));
        expect(r.isExternalCrossing).toBe(true);
        expect(Number(r.amount)).toBe(100);
      }
    });

    it('walletRef/externalRef fall back to null when evidence has none', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitWalletRef: null,
        creditWalletRef: null,
        externalRef: null,
        isExternalCrossing: false,
      } as any);

      for (const r of rows) {
        expect(r.externalRef).toBeNull();
        expect(r.isExternalCrossing).toBe(false);
      }
      expect(rows.find((r) => r.direction === 'OUT')!.walletRef).toBeNull();
      expect(rows.find((r) => r.direction === 'IN')!.walletRef).toBeNull();
    });

    it('skips rows whose account id is missing (legacy evidence with no debit/credit TB id)', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitTbAccountId: null,
      } as any);
      // Only the credit row should be produced
      expect(rows).toHaveLength(1);
      expect(rows[0].direction).toBe('IN');
      expect(rows[0].tbAccountId).toBe('tb-credit-002');
    });
  });

  describe('persist (idempotent upsert)', () => {
    let mockClient: any;

    // Helper: build a client mock with default aggregate-registry stubs.
    // baseEvidence references fake tbAccountIds ('tb-debit-001', 'tb-credit-002')
    // and fake walletRefs ('wallet-debit', 'wallet-credit'). We default both
    // registry lookups to code=1 (CLIENT_ASSET aggregate) so R2 owner check is
    // skipped for these existing tests — keeps them focused on projection
    // behavior, not invariant enforcement.
    const aggregateRegistry = { code: 1, ownerType: 'SYSTEM', ownerNo: 'PLATFORM' };
    const dummyWallet = { id: 'w', ownerType: 'SYSTEM', ownerNo: 'PLATFORM' };

    beforeEach(() => {
      mockClient = {
        accountFlow: {
          upsert: jest.fn().mockResolvedValue({}),
        },
        wallet: {
          findUnique: jest.fn().mockResolvedValue(dummyWallet),
        },
        tbAccountRegistry: {
          findUnique: jest.fn().mockResolvedValue(aggregateRegistry),
        },
      };
    });

    it('upserts 2 rows keyed by (tbTransferId, tbAccountId)', async () => {
      await service.persist(mockClient, baseEvidence as any);

      expect(mockClient.accountFlow.upsert).toHaveBeenCalledTimes(2);

      const calls = mockClient.accountFlow.upsert.mock.calls.map((c: any[]) => c[0]);
      const wheres = calls.map((c: any) => c.where.tbTransferId_tbAccountId);
      expect(wheres).toEqual(
        expect.arrayContaining([
          { tbTransferId: 'abc123', tbAccountId: 'tb-debit-001' },
          { tbTransferId: 'abc123', tbAccountId: 'tb-credit-002' },
        ]),
      );
    });

    it('re-projection (second call with mutated evidence fields) updates the existing rows', async () => {
      await service.persist(mockClient, baseEvidence as any);

      // Simulate enrichForPost: eventCode/externalRef/isExternalCrossing change.
      const enriched = {
        ...baseEvidence,
        eventCode: 'EVT_WITHDRAW_SUCCESS',
        externalRef: '0xnewhash',
        isExternalCrossing: true,
      };
      mockClient.accountFlow.upsert.mockClear();
      await service.persist(mockClient, enriched as any);

      expect(mockClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
      for (const call of mockClient.accountFlow.upsert.mock.calls) {
        const args = call[0];
        // update payload must reflect the new fields
        expect(args.update.eventCode).toBe('EVT_WITHDRAW_SUCCESS');
        expect(args.update.externalRef).toBe('0xnewhash');
        expect(args.update.isExternalCrossing).toBe(true);
      }
    });

    it('passes through tx client (caller controls atomicity with writeEvidence)', async () => {
      const txClient = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(dummyWallet) },
        tbAccountRegistry: { findUnique: jest.fn().mockResolvedValue(aggregateRegistry) },
      };
      await service.persist(txClient as any, baseEvidence as any);
      expect(txClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
      expect(mockClient.accountFlow.upsert).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // R2: walletRef ↔ tbAccountId owner consistency
  // ─────────────────────────────────────────────────────────────
  // Rule (spec verbatim):
  //   For each AccountFlow row:
  //     - walletRef must join to wallets table (no orphan)
  //     - wallets.ownerType/ownerNo must equal tb_account_registry.ownerType/ownerNo
  //       for the row's tbAccountId
  //     - Exception: aggregate accounts (CLIENT_ASSET code=1, FIRM_ASSET code=50)
  //       carry no owner — skip the owner check
  //   Violation → throw WalletRefMismatchError before persisting the row.
  describe('R2: assertWalletRefMatchesTbAccount', () => {
    const customerOwnedRegistry = {
      code: 100, // L.CLIENT_PAYABLE per-customer
      ownerType: 'CUSTOMER',
      ownerNo: 'C00001',
    };
    const aliceWallet = { id: 'wallet-alice', ownerType: 'CUSTOMER', ownerNo: 'C00001' };
    const bobWallet = { id: 'wallet-bob', ownerType: 'CUSTOMER', ownerNo: 'C00002' };

    // Evidence where every leg is per-customer (not aggregate), so the R2
    // assertion is actively exercised on both debit and credit.
    const customerEvidence = {
      tbTransferId: 'tx-r2',
      sourceType: 'SWAP',
      sourceNo: 'SW-001',
      eventCode: 'SWAP_BUY_CLIENT',
      debitTbAccountId: 'tb-customer-debit',
      creditTbAccountId: 'tb-customer-credit',
      amount: 50,
      assetCode: 'AED',
      transferType: 'POSTED',
      debitWalletRef: 'wallet-alice',
      creditWalletRef: 'wallet-alice',
      externalRef: null,
      isExternalCrossing: false,
      createdAt: new Date('2026-06-29T10:00:00Z'),
    };

    it('throws WalletRefMismatchError when walletRef is not in wallets table (orphan)', async () => {
      const danglingClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(null) }, // dangling
        tbAccountRegistry: { findUnique: jest.fn().mockResolvedValue(customerOwnedRegistry) },
      };
      await expect(service.persist(danglingClient, customerEvidence as any))
        .rejects.toThrow(WalletRefMismatchError);
      // Should never reach the upsert — assertion runs first
      expect(danglingClient.accountFlow.upsert).not.toHaveBeenCalled();
    });

    it('throws WalletRefMismatchError when wallet owner != tbAccountId registry owner (per-customer account)', async () => {
      const mismatchClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        // walletRef resolves to Bob, but the registry says this tbAccountId belongs to Alice (C00001)
        wallet: { findUnique: jest.fn().mockResolvedValue(bobWallet) },
        tbAccountRegistry: { findUnique: jest.fn().mockResolvedValue(customerOwnedRegistry) },
      };
      await expect(service.persist(mismatchClient, customerEvidence as any))
        .rejects.toThrow(WalletRefMismatchError);
      expect(mismatchClient.accountFlow.upsert).not.toHaveBeenCalled();
    });

    it('passes when wallet owner == tbAccountId registry owner', async () => {
      const okClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(aliceWallet) },
        tbAccountRegistry: { findUnique: jest.fn().mockResolvedValue(customerOwnedRegistry) },
      };
      await service.persist(okClient, customerEvidence as any);
      // Both debit and credit rows upsert — assertion didn't block
      expect(okClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
    });

    it('skips owner check for aggregate accounts (code=1 CLIENT_ASSET)', async () => {
      // walletRef = Bob, but tbAccountId is CLIENT_ASSET aggregate — no owner
      // attached to the registry row. Owner check must NOT run.
      const aggregateClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(bobWallet) },
        tbAccountRegistry: {
          findUnique: jest.fn().mockResolvedValue({ code: 1, ownerType: 'SYSTEM', ownerNo: null }),
        },
      };
      await service.persist(aggregateClient, customerEvidence as any);
      expect(aggregateClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
    });

    it('skips owner check for aggregate accounts (code=50 FIRM_ASSET)', async () => {
      const aggregateClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(bobWallet) },
        tbAccountRegistry: {
          findUnique: jest.fn().mockResolvedValue({ code: 50, ownerType: 'SYSTEM', ownerNo: null }),
        },
      };
      await service.persist(aggregateClient, customerEvidence as any);
      expect(aggregateClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
    });

    it('skips assertion entirely when walletRef is null (handled by other invariants)', async () => {
      const nullRefClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn() },
        tbAccountRegistry: { findUnique: jest.fn() },
      };
      const evidenceNoWalletRef = {
        ...customerEvidence,
        debitWalletRef: null,
        creditWalletRef: null,
      };
      await service.persist(nullRefClient, evidenceNoWalletRef as any);
      // Neither lookup should fire (no walletRef → no assertion)
      expect(nullRefClient.wallet.findUnique).not.toHaveBeenCalled();
      expect(nullRefClient.tbAccountRegistry.findUnique).not.toHaveBeenCalled();
      expect(nullRefClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
    });

    it('skips assertion when registry row is absent (unknown tbAccountId tolerated)', async () => {
      // No registry row → can't determine the expected owner → don't throw
      // (consistent with verify-demo-data scanner's `if (!reg) continue;`).
      const noRegClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(bobWallet) },
        tbAccountRegistry: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      await service.persist(noRegClient, customerEvidence as any);
      expect(noRegClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
    });

    it('error message identifies the offending walletRef + tbAccountId for debuggability', async () => {
      const mismatchClient: any = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        wallet: { findUnique: jest.fn().mockResolvedValue(bobWallet) },
        tbAccountRegistry: { findUnique: jest.fn().mockResolvedValue(customerOwnedRegistry) },
      };
      await expect(service.persist(mismatchClient, customerEvidence as any))
        .rejects.toThrow(/wallet-alice/); // walletRef from evidence appears in message
    });
  });
});
