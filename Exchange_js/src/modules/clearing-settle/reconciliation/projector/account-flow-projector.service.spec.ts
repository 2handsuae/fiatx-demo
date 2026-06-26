// src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts
//
// Phase B / T3: pure projection (`projectEvidence`) + idempotent persistence
// (`persist`). Each evidence row fans into exactly 2 flow rows — debit→OUT,
// credit→IN. Both rows share the evidence's transfer-level fields; each row
// carries the wallet ref of its own leg.

import { AccountFlowProjectorService } from './account-flow-projector.service';

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

    beforeEach(() => {
      mockClient = {
        accountFlow: {
          upsert: jest.fn().mockResolvedValue({}),
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
      const txClient = { accountFlow: { upsert: jest.fn().mockResolvedValue({}) } };
      await service.persist(txClient as any, baseEvidence as any);
      expect(txClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
      expect(mockClient.accountFlow.upsert).not.toHaveBeenCalled();
    });
  });
});
