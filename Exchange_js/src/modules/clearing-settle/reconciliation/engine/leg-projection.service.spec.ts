import { Prisma } from '@prisma/client';
import { LegProjectionService } from './leg-projection.service';

// 法币滚 CMA 常量（§2.5）——与假对账单生成器 (recon-redesign-statement-gen.ts) 对齐。
const FIAT_CMA: Record<string, string> = { AED: 'C_CMA-AED-0001' };

describe('LegProjectionService', () => {
  let prisma: any;
  let source: any;
  let svc: LegProjectionService;
  const businessDate = '2026-06-16';
  const cutoff = new Date('2026-06-17T00:00:00.000Z');

  beforeEach(() => {
    prisma = {
      wallet: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // C4: leg-projection reads funds_orders via FundsOrderSourceRepo (payin/payout/internal views).
    // Row shapes returned by the repo match the legacy table rows the projection math consumes,
    // so all leg-shape assertions below are unchanged — only the fetch is redirected to the repo.
    source = {
      findPayins: jest.fn().mockResolvedValue([]),
      findPayouts: jest.fn().mockResolvedValue([]),
      findInternals: jest.fn().mockResolvedValue([]),
    };
    svc = new LegProjectionService(prisma, source);
  });

  describe('terminal states only', () => {
    it('queries payin view CLEARED only, windowed [day, cutoff)', async () => {
      await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      const start = new Date('2026-06-16T00:00:00.000Z');
      expect(source.findPayins).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: 'asset-usdt', status: 'CLEARED', createdAt: { gte: start, lt: cutoff } }),
      );
    });

    it('queries payout view terminal (CLEARED) without createdAt window (CLEARED = already physically out)', async () => {
      await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      expect(source.findPayouts).toHaveBeenCalledWith({ assetId: 'asset-usdt', status: 'CLEARED' });
    });

    it('queries internal view CLEARED only, windowed', async () => {
      await svc.project('asset-aed', 'AED', businessDate, cutoff);
      const start = new Date('2026-06-16T00:00:00.000Z');
      expect(source.findInternals).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: 'asset-aed', status: 'CLEARED', createdAt: { gte: start, lt: cutoff } }),
      );
    });
  });

  describe('Payin → 1 IN leg', () => {
    it('crypto payin: account=vault, external_ref=txHash, sub_account=walletId/vault', async () => {
      source.findPayins.mockResolvedValue([
        {
          id: 'p1', payinNo: 'PI-1', amount: new Prisma.Decimal('315.11'),
          txHash: '0xSEED51USDT', referenceNo: null,
          toWallet: { id: 'w1', vaultId: 'vault-dep-cust', iban: null },
        },
      ]);
      const legs = await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      expect(legs).toHaveLength(1);
      expect(legs[0]).toMatchObject({
        source: 'PAYIN', sourceId: 'p1', sourceNo: 'PI-1',
        direction: 'IN', currency: 'USDT', externalRef: '0xSEED51USDT',
        account: 'vault-dep-cust', subAccount: 'vault-dep-cust',
      });
      expect(legs[0].amount.toString()).toBe('315.11');
    });

    it('fiat payin (incoming): external_ref=null (bank does not echo our ref) → routes to fallback; CMA + VIBAN kept', async () => {
      source.findPayins.mockResolvedValue([
        {
          id: 'p2', payinNo: 'PI-2', amount: new Prisma.Decimal('2391.58'),
          txHash: null, referenceNo: 'REF-SEED5-1-AED',
          toWallet: { id: 'w2', vaultId: null, iban: 'AE111111111111111111' },
        },
      ]);
      const legs = await svc.project('asset-aed', 'AED', businessDate, cutoff);
      expect(legs[0]).toMatchObject({
        direction: 'IN', currency: 'AED', externalRef: null,
        account: FIAT_CMA.AED, subAccount: 'AE111111111111111111',
      });
    });
  });

  describe('Payout → 1 OUT leg (srcWallet via ownerId lookup)', () => {
    it('crypto payout: OUT, external_ref=txHash/payoutRef, sourceNo=payoutNo', async () => {
      source.findPayouts.mockResolvedValue([
        { id: 'po1', payoutNo: 'PO-1', amount: new Prisma.Decimal('66.01'), txHash: '0xWDRPO-1', referenceNo: null, ownerId: 'cust-1' },
      ]);
      prisma.wallet.findMany.mockResolvedValue([
        { id: 'wo', ownerId: 'cust-1', vaultId: 'vault-dep-1', iban: null },
      ]);
      const legs = await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      expect(legs).toHaveLength(1);
      expect(legs[0]).toMatchObject({
        source: 'PAYOUT', sourceNo: 'PO-1', direction: 'OUT',
        currency: 'USDT', externalRef: '0xWDRPO-1', account: 'vault-dep-1',
      });
      // crypto payout 经客户 C_DEP 钱包反查
      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ walletRole: 'C_DEP', ownerId: { in: ['cust-1'] } }) }),
      );
    });

    it('fiat payout: OUT external_ref=referenceNo (your number echoed), account=CMA, sub_account=VIBAN via C_VIBAN', async () => {
      source.findPayouts.mockResolvedValue([
        { id: 'po2', payoutNo: 'PO-2', amount: new Prisma.Decimal('1500.00'), txHash: null, referenceNo: 'WDR-AED-1', ownerId: 'cust-2' },
      ]);
      prisma.wallet.findMany.mockResolvedValue([
        { id: 'wf', ownerId: 'cust-2', vaultId: null, iban: 'AE222222222222222222' },
      ]);
      const legs = await svc.project('asset-aed', 'AED', businessDate, cutoff);
      expect(legs[0]).toMatchObject({
        direction: 'OUT', externalRef: 'WDR-AED-1',
        account: FIAT_CMA.AED, subAccount: 'AE222222222222222222',
      });
      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ walletRole: 'C_VIBAN' }) }),
      );
    });
  });

  describe('InternalFund → 2 legs (OUT from + IN to), same external_ref', () => {
    it('projects two legs sharing txHash, opposite directions', async () => {
      source.findInternals.mockResolvedValue([
        {
          id: 'f1', fundsOrderNo: 'IF-1', amount: new Prisma.Decimal('60.76'),
          txHash: '0xFUND1', referenceNo: null,
          fromWallet: { id: 'wfrom', vaultId: 'vault-from', iban: null },
          toWallet: { id: 'wto', vaultId: 'vault-to', iban: null },
        },
      ]);
      const legs = await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      expect(legs).toHaveLength(2);
      const out = legs.find((l) => l.direction === 'OUT')!;
      const inLeg = legs.find((l) => l.direction === 'IN')!;
      expect(out).toMatchObject({ source: 'INTERNALFUND', externalRef: '0xFUND1', account: 'vault-from' });
      expect(inLeg).toMatchObject({ source: 'INTERNALFUND', externalRef: '0xFUND1', account: 'vault-to' });
      expect(out.amount.toString()).toBe('60.76');
      expect(inLeg.amount.toString()).toBe('60.76');
    });

    it('fiat internal_fund: both legs rolled to CMA, external_ref=referenceNo', async () => {
      source.findInternals.mockResolvedValue([
        {
          id: 'f2', fundsOrderNo: 'IFD-FIAT-1', amount: new Prisma.Decimal('333.58'),
          txHash: null, referenceNo: 'BANK-IFD-FIAT-1',
          fromWallet: { id: 'a', vaultId: null, iban: 'AE333' },
          toWallet: { id: 'b', vaultId: null, iban: 'AE444' },
        },
      ]);
      const legs = await svc.project('asset-aed', 'AED', businessDate, cutoff);
      expect(legs).toHaveLength(2);
      for (const l of legs) expect(l.account).toBe(FIAT_CMA.AED);
      // 法币出金腿有回显 referenceNo；入金腿无回显 → null（走 fallback）。
      expect(legs.find((l) => l.direction === 'OUT')!.externalRef).toBe('BANK-IFD-FIAT-1');
      expect(legs.find((l) => l.direction === 'IN')!.externalRef).toBeNull();
      // sub_account 保留各自 VIBAN（下钻定位）
      expect(legs.find((l) => l.direction === 'OUT')!.subAccount).toBe('AE333');
      expect(legs.find((l) => l.direction === 'IN')!.subAccount).toBe('AE444');
    });

    it('fiat internal_fund firm→firm: each firm leg → own account (NOT rolled to CMA)', async () => {
      source.findInternals.mockResolvedValue([
        {
          id: 'f3', fundsOrderNo: 'IFD-FIRM-1', amount: new Prisma.Decimal('42.03'),
          txHash: null, referenceNo: 'BANK-IFD-FIRM-1',
          fromWallet: { id: 'fops', vaultId: null, iban: null, walletRole: 'F_OPS' },
          toWallet: { id: 'ffee', vaultId: null, iban: null, walletRole: 'F_FEE' },
        },
      ]);
      const legs = await svc.project('asset-aed', 'AED', businessDate, cutoff);
      expect(legs).toHaveLength(2);
      expect(legs.find((l) => l.direction === 'OUT')!).toMatchObject({
        account: 'F_OPS-AED-0001', book: 'FIRM', subAccount: null,
      });
      expect(legs.find((l) => l.direction === 'IN')!).toMatchObject({
        account: 'F_FEE-AED-0001', book: 'FIRM', subAccount: null,
      });
    });

    it('fiat internal_fund firm→client: firm leg → own account, client (C_VIBAN) leg → CMA', async () => {
      source.findInternals.mockResolvedValue([
        {
          id: 'f4', fundsOrderNo: 'IFD-MIX-1', amount: new Prisma.Decimal('3630.47'),
          txHash: null, referenceNo: 'BANK-IFD-MIX-1',
          fromWallet: { id: 'fset', vaultId: null, iban: null, walletRole: 'F_SET' },
          toWallet: { id: 'cviban', vaultId: null, iban: 'AE555', walletRole: 'C_VIBAN' },
        },
      ]);
      const legs = await svc.project('asset-aed', 'AED', businessDate, cutoff);
      expect(legs.find((l) => l.direction === 'OUT')!).toMatchObject({
        account: 'F_SET-AED-0001', book: 'FIRM', subAccount: null,
      });
      expect(legs.find((l) => l.direction === 'IN')!).toMatchObject({
        account: FIAT_CMA.AED, book: 'CLIENT', subAccount: 'AE555',
      });
    });

    it('crypto internal_fund FIRM leg: role account (F_*-USDT-0001), NOT wallet UUID/vault', async () => {
      source.findInternals.mockResolvedValue([
        {
          id: 'f5', fundsOrderNo: 'IFD-CRYPTO-FIRM', amount: new Prisma.Decimal('4.36'),
          txHash: '0xFEEFUND', referenceNo: null,
          fromWallet: { id: 'fops-uuid', vaultId: null, iban: null, walletRole: 'F_OPS' },
          toWallet: { id: 'ffee-uuid', vaultId: null, iban: null, walletRole: 'F_FEE' },
        },
      ]);
      const legs = await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      expect(legs.find((l) => l.direction === 'OUT')!).toMatchObject({ account: 'F_OPS-USDT-0001', book: 'FIRM' });
      expect(legs.find((l) => l.direction === 'IN')!).toMatchObject({ account: 'F_FEE-USDT-0001', book: 'FIRM' });
    });

    it('crypto internal_fund client pool with no vaultId → role-key fallback (no wallet UUID exposed)', async () => {
      source.findInternals.mockResolvedValue([
        {
          id: 'f6', fundsOrderNo: 'IFD-CMAIN', amount: new Prisma.Decimal('48'),
          txHash: '0xCMAIN', referenceNo: null,
          fromWallet: { id: 'cmain-uuid', vaultId: null, iban: null, walletRole: 'C_MAIN' },
          toWallet: { id: 'cdep-uuid', vaultId: 'vault-dep-x', iban: null, walletRole: 'C_DEP' },
        },
      ]);
      const legs = await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
      expect(legs.find((l) => l.direction === 'OUT')!).toMatchObject({ account: 'C_MAIN-USDT-0001', book: 'CLIENT' });
      expect(legs.find((l) => l.direction === 'IN')!).toMatchObject({ account: 'vault-dep-x', book: 'CLIENT' });
    });
  });

  it('combines all three sources into one leg list', async () => {
    source.findPayins.mockResolvedValue([
      { id: 'p', payinNo: 'PI', amount: new Prisma.Decimal('1'), txHash: '0xA', referenceNo: null, toWallet: { vaultId: 'v', iban: null } },
    ]);
    source.findPayouts.mockResolvedValue([
      { id: 'o', payoutNo: 'PO', amount: new Prisma.Decimal('2'), txHash: '0xB', referenceNo: null, ownerId: 'c' },
    ]);
    prisma.wallet.findMany.mockResolvedValue([{ id: 'wv', ownerId: 'c', vaultId: 'v2', iban: null }]);
    source.findInternals.mockResolvedValue([
      { id: 'f', fundsOrderNo: 'IF', amount: new Prisma.Decimal('3'), txHash: '0xC', referenceNo: null, fromWallet: { vaultId: 'vf', iban: null }, toWallet: { vaultId: 'vt', iban: null } },
    ]);
    const legs = await svc.project('asset-usdt', 'USDT', businessDate, cutoff);
    // 1 payin + 1 payout + 2 internalfund = 4
    expect(legs).toHaveLength(4);
    expect(legs.filter((l) => l.source === 'INTERNALFUND')).toHaveLength(2);
  });
});
