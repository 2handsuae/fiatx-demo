import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { LpExchangeService } from './lp-exchange.service';
import { LpExchangeStatus as S } from './dto/lp-exchange.dto';
import { LpProfileStatus } from './dto/lp-profile.dto';

/** 行为化内存行 mock（照 lp-profile.service.spec.ts 的 makePrisma 先例）。
 *  clock 用递增计数器而非 `new Date()`——避免同一 tick 内连续两次写入撞同一毫秒。 */
function makePrisma() {
  const rows = new Map<string, any>();
  let clock = Date.parse('2026-09-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  const assets: Record<string, any> = {
    'asset-aed': { id: 'asset-aed', code: 'AED', currency: 'AED', decimals: 2 },
    'asset-usdt': { id: 'asset-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6 },
  };
  return {
    lpExchange: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, failureReasonCode: null, failureNote: null, executedAt: null, deliveredAt: null, settledAt: null, createdAt: tick(), updatedAt: tick(), ...data };
        rows.set(row.exchangeNo, row);
        return { ...row, sellAsset: assets[row.sellAssetId], buyAsset: assets[row.buyAssetId] };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.exchangeNo);
        if (!existing) throw new Error(`no such row: ${where.exchangeNo}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        rows.set(where.exchangeNo, updated);
        return { ...updated, sellAsset: assets[updated.sellAssetId], buyAsset: assets[updated.buyAssetId] };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = rows.get(where.exchangeNo);
        return row ? { ...row, sellAsset: assets[row.sellAssetId], buyAsset: assets[row.buyAssetId] } : null;
      }),
      findMany: jest.fn(async (args: any = {}) => {
        const list = [...rows.values()].map((r) => ({ ...r, sellAsset: assets[r.sellAssetId], buyAsset: assets[r.buyAssetId] }));
        const orderBy = args.orderBy;
        if (!orderBy) return list;
        const [field] = Object.keys(orderBy);
        const dir = orderBy[field] === 'asc' ? 1 : -1;
        return list.sort((a, b) => (dir * (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0)));
      }),
      count: jest.fn(async () => rows.size),
    },
    fundsOrder: { findMany: jest.fn(async () => []) },
  };
}

const activeProfile = { id: 'uuid-lp-1', lpNo: 'LPP1', status: LpProfileStatus.ACTIVE };
function makeLpProfiles(profile: any = activeProfile) {
  return {
    assertActiveByNo: jest.fn(async (lpNo: string) => {
      if (profile.lpNo !== lpNo || profile.status !== LpProfileStatus.ACTIVE) {
        throw new BadRequestException(`Liquidity provider ${lpNo} is not ACTIVE (status=${profile.status}) — cannot open an LP exchange order against it.`);
      }
    }),
    findByNo: jest.fn(async () => profile),
  } as any;
}

const baseInput = {
  lpNo: 'LPP1', sellAssetId: 'asset-aed', sellAmount: '50000', buyAssetId: 'asset-usdt', buyAmount: '13600',
  prudentialPurpose: 'Rebalance AED liquidity into USDT corridor ahead of settlement', reason: 'Quarterly rebalance',
  sellFromWalletId: 'w-ops-aed', buyViaWalletId: 'w-liq-usdt', buyToWalletId: 'w-ops-usdt', createdByUserId: 'ADM1',
};

describe('LpExchangeService (乙波一 T4)', () => {
  const svc = (prisma: any = makePrisma(), accounting: any = {}, lpProfiles: any = makeLpProfiles()) =>
    new LpExchangeService(prisma, accounting, lpProfiles);

  describe('create — 出生守卫', () => {
    it('rejects create when profile is SUSPENDED', async () => {
      const suspended = { id: 'uuid-lp-2', lpNo: 'LPP2', status: LpProfileStatus.SUSPENDED };
      const service = svc(makePrisma(), {}, makeLpProfiles(suspended));
      await expect(service.create({ ...baseInput, lpNo: 'LPP2' })).rejects.toThrow(/not ACTIVE/);
    });

    it('rejects create when sellAsset equals buyAsset', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, buyAssetId: baseInput.sellAssetId })).rejects.toThrow(/must sell and buy two different assets/);
    });

    it('rejects create without prudentialPurpose', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, prudentialPurpose: '' })).rejects.toThrow(/prudentialPurpose is required/);
    });

    it('rejects create when sellAmount is zero or negative', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, sellAmount: '0' })).rejects.toThrow(/greater than zero/);
      await expect(service.create({ ...baseInput, sellAmount: '-1' })).rejects.toThrow(/greater than zero/);
    });

    it('rejects create when buyAmount is zero or negative', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, buyAmount: '0' })).rejects.toThrow(/greater than zero/);
    });

    it('happy path: writes an LPX-prefixed row, PENDING_APPROVAL, resolves lpId from lpNo via LpProfileService.findByNo', async () => {
      const lpProfiles = makeLpProfiles();
      const service = svc(makePrisma(), {}, lpProfiles);
      const row = await service.create(baseInput);
      expect(row.exchangeNo).toMatch(/^LPX\d{12}$/);
      expect(row.status).toBe(S.PENDING_APPROVAL);
      expect(row.lpId).toBe(activeProfile.id);
      expect(row.lpNo).toBe('LPP1');
      expect(lpProfiles.assertActiveByNo).toHaveBeenCalledWith('LPP1');
    });
  });

  describe('八态八边（real LP_EXCHANGE_TRANSITIONS table，禁扫文本）', () => {
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.AWAITING_DELIVERY], [S.EXECUTING, S.FAILED],
      [S.AWAITING_DELIVERY, S.DELIVERED],
      [S.DELIVERED, S.SUCCESS],
    ])('%s → %s allowed', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });

    it.each([
      [S.AWAITING_DELIVERY, S.SUCCESS], // 必须先经 DELIVERED，不能跳验收
      [S.EXECUTING, S.DELIVERED],
      [S.PENDING_APPROVAL, S.SUCCESS],
      [S.PENDING_APPROVAL, S.DELIVERED],
      [S.SUCCESS, S.EXECUTING], // 终态零出边
      [S.FAILED, S.EXECUTING],
      [S.REJECTED, S.EXECUTING],
      [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s rejected', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/Illegal LP exchange status transition/); });

    it('rejects AWAITING_DELIVERY → SUCCESS (must pass DELIVERED)', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.lpExchange.update({ where: { exchangeNo: created.exchangeNo }, data: { status: S.AWAITING_DELIVERY } });
      await expect(service.transition(created.exchangeNo, S.SUCCESS)).rejects.toThrow(/Illegal LP exchange status transition/);
    });

    it('SUCCESS is terminal — second accept (transition to SUCCESS again) rejected', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.lpExchange.update({ where: { exchangeNo: created.exchangeNo }, data: { status: S.DELIVERED } });
      const settled = await service.transition(created.exchangeNo, S.SUCCESS, { settledAt: new Date() });
      expect(settled.status).toBe(S.SUCCESS);
      await expect(service.transition(created.exchangeNo, S.SUCCESS)).rejects.toThrow(/Illegal LP exchange status transition/);
    });
  });

  describe('assertFirmOpsBalance — 卖出币运营户可用余额闸（同划转单同名方法形状）', () => {
    const accounting = (creditsPosted: bigint, debitsPosted: bigint, debitsPending = 0n) => ({
      resolveTbAccountId: jest.fn(async () => 1n),
      lookupBalance: jest.fn(async () => ({ creditsPosted, debitsPosted, debitsPending, creditsPending: 0n })),
    });
    it('enough → allowed', async () => {
      await expect(svc(makePrisma(), accounting(100_000_000_000n, 571_811_000n)).assertFirmOpsBalance('AED', 5_000_000n)).resolves.toBeUndefined();
    });
    it('not enough → 400, message carries available / needed', async () => {
      await expect(svc(makePrisma(), accounting(1_000n, 0n)).assertFirmOpsBalance('AED', 2_000n)).rejects.toThrow(/Insufficient.*available 1000.*need 2000/);
    });
    it('currency not on the ledger → 400', async () => {
      await expect(svc(makePrisma(), accounting(1n, 0n)).assertFirmOpsBalance('BTC', 1n)).rejects.toThrow(/Unsupported currency/);
    });
  });

  describe('getView — 铁律⑥零 UUID 投影', () => {
    it('projects business fields only — sellAssetCode/buyAssetCode/amount formatted to precision, no id key present', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      const view = await service.getView(created.exchangeNo);
      const json = JSON.stringify(view);
      expect(json).not.toContain(created.id);
      expect(json).not.toContain(activeProfile.id);
      expect(view).toMatchObject({
        exchangeNo: created.exchangeNo, lpNo: 'LPP1', status: S.PENDING_APPROVAL,
        sellAssetCode: 'AED', sellAmount: '50000.00',
        buyAssetCode: 'USDT-TRON', buyAmount: '13600.000000',
        legs: [],
      });
    });
  });

  describe('list', () => {
    it('returns projected views ordered by createdAt desc', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      await service.create(baseInput);
      await service.create({ ...baseInput, sellAmount: '1000' });
      const { items, total } = await service.list();
      expect(total).toBe(2);
      expect(items[0].createdAt >= items[1].createdAt).toBe(true);
    });
  });
});
