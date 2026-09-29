import { randomUUID } from 'node:crypto';
import { CapitalInjectionService } from './capital-injection.service';
import { CapitalInjectionStatus as S } from './dto/capital-injection.dto';

/** 行为化内存行 mock（照 lp-exchange.service.spec.ts 的 makePrisma 先例）。
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
    capitalInjection: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, receivedAt: null, settledAt: null, createdAt: tick(), updatedAt: tick(), ...data };
        rows.set(row.cinNo, row);
        return { ...row, asset: assets[row.assetId] };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.cinNo);
        if (!existing) throw new Error(`no such row: ${where.cinNo}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        rows.set(where.cinNo, updated);
        return { ...updated, asset: assets[updated.assetId] };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = rows.get(where.cinNo);
        return row ? { ...row, asset: assets[row.assetId] } : null;
      }),
      findMany: jest.fn(async (args: any = {}) => {
        const where = args.where ?? {};
        let list = [...rows.values()].filter((r) =>
          Object.entries(where).every(([field, cond]: [string, any]) => r[field] === cond),
        );
        list = list.map((r) => ({ ...r, asset: assets[r.assetId] }));
        const orderBy = args.orderBy;
        if (!orderBy) return list;
        const [field] = Object.keys(orderBy);
        const dir = orderBy[field] === 'asc' ? 1 : -1;
        return list.sort((a, b) => (dir * (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0)));
      }),
      count: jest.fn(async (args: any = {}) => {
        const where = args.where ?? {};
        return [...rows.values()].filter((r) =>
          Object.entries(where).every(([field, cond]: [string, any]) => r[field] === cond),
        ).length;
      }),
    },
    fundsOrder: { findMany: jest.fn(async () => []) },
  };
}

const baseInput = {
  contributorName: 'Founder Holdings Ltd', assetId: 'asset-aed', amount: '500000',
  prudentialPurpose: 'Top up prudential capital buffer ahead of quarter end',
  reason: 'Shareholder capital call', toWalletId: 'w-ops-aed', createdByUserId: 'ADM1',
};

describe('CapitalInjectionService (乙波二 T2)', () => {
  const svc = (prisma: any = makePrisma()) => new CapitalInjectionService(prisma);

  describe('create — 出生守卫', () => {
    it('rejects create without prudentialPurpose', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, prudentialPurpose: '' })).rejects.toThrow(/prudentialPurpose is required/);
    });

    it('rejects create without contributorName', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, contributorName: '' })).rejects.toThrow(/contributorName is required/);
    });

    it('rejects create with zero amount', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, amount: '0' })).rejects.toThrow(/greater than zero/);
    });

    it('rejects create with negative amount', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, amount: '-1' })).rejects.toThrow(/greater than zero/);
    });

    it('happy path: writes a CIN-prefixed row, PENDING_APPROVAL', async () => {
      const service = svc();
      const row = await service.create(baseInput);
      expect(row.cinNo).toMatch(/^CIN\d{12}$/);
      expect(row.status).toBe(S.PENDING_APPROVAL);
      expect(row.contributorName).toBe('Founder Holdings Ltd');
      expect(row.toWalletId).toBe('w-ops-aed');
    });
  });

  describe('六态五边（real CAPITAL_INJECTION_TRANSITIONS table，禁扫文本）', () => {
    it.each([
      [S.PENDING_APPROVAL, S.AWAITING_FUNDS], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.AWAITING_FUNDS, S.RECEIVED],
      [S.RECEIVED, S.SUCCESS],
    ])('%s → %s allowed', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });

    it.each([
      [S.PENDING_APPROVAL, S.RECEIVED],
      [S.PENDING_APPROVAL, S.SUCCESS],
      [S.AWAITING_FUNDS, S.SUCCESS], // 必须先经 RECEIVED，不能跳确认
      [S.AWAITING_FUNDS, S.PENDING_APPROVAL],
      [S.RECEIVED, S.AWAITING_FUNDS],
      [S.SUCCESS, S.RECEIVED], // 终态零出边
      [S.REJECTED, S.PENDING_APPROVAL],
      [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s rejected', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/Illegal capital injection status transition/); });

    it('rejects PENDING_APPROVAL → RECEIVED (must pass AWAITING_FUNDS)', async () => {
      const service = svc();
      const created = await service.create(baseInput);
      await expect(service.transition(created.cinNo, S.RECEIVED)).rejects.toThrow(/Illegal capital injection status transition/);
    });

    it('rejects AWAITING_FUNDS → SUCCESS (must pass RECEIVED)', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.capitalInjection.update({ where: { cinNo: created.cinNo }, data: { status: S.AWAITING_FUNDS } });
      await expect(service.transition(created.cinNo, S.SUCCESS)).rejects.toThrow(/Illegal capital injection status transition/);
    });

    it('SUCCESS is terminal — second confirm rejected', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.capitalInjection.update({ where: { cinNo: created.cinNo }, data: { status: S.RECEIVED } });
      const settled = await service.transition(created.cinNo, S.SUCCESS, { settledAt: new Date() });
      expect(settled.status).toBe(S.SUCCESS);
      await expect(service.transition(created.cinNo, S.SUCCESS)).rejects.toThrow(/Illegal capital injection status transition/);
    });
  });

  // 评审同款：5×5=... 全矩阵穷举独立真值表（六态实为 6，非 5），禁 import 被测常量。
  describe('六态五边全矩阵（6×6=36 组穷举，独立真值表，禁止 import 被测常量）', () => {
    const ALLOWED: ReadonlySet<string> = new Set([
      `${S.PENDING_APPROVAL}->${S.AWAITING_FUNDS}`,
      `${S.PENDING_APPROVAL}->${S.REJECTED}`,
      `${S.PENDING_APPROVAL}->${S.CANCELLED}`,
      `${S.AWAITING_FUNDS}->${S.RECEIVED}`,
      `${S.RECEIVED}->${S.SUCCESS}`,
    ]);
    const ALL_STATES: readonly string[] = [
      S.PENDING_APPROVAL, S.AWAITING_FUNDS, S.RECEIVED, S.SUCCESS, S.REJECTED, S.CANCELLED,
    ];
    const ALL_PAIRS: Array<[string, string]> = ALL_STATES.flatMap((from) => ALL_STATES.map((to) => [from, to] as [string, string]));

    it('sanity：6 态 → 36 组、恰好 5 条允许边', () => {
      expect(ALL_STATES).toHaveLength(6);
      expect(ALL_PAIRS).toHaveLength(36);
      expect(ALLOWED.size).toBe(5);
    });

    it.each(ALL_PAIRS)('%s → %s', (from, to) => {
      if (ALLOWED.has(`${from}->${to}`)) {
        expect(() => svc().assertTransition(from, to)).not.toThrow();
      } else {
        expect(() => svc().assertTransition(from, to)).toThrow(/Illegal capital injection status transition/);
      }
    });
  });

  describe('stampApprovalNo', () => {
    it('writes approvalNo onto the row', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await service.stampApprovalNo(created.cinNo, 'APR1');
      const row = await service.findByNo(created.cinNo);
      expect(row.approvalNo).toBe('APR1');
    });
  });

  describe('getView — 铁律⑥零 UUID 投影', () => {
    it('projects business fields only — assetCode/amount formatted to precision, no id key present', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      const view = await service.getView(created.cinNo);
      const json = JSON.stringify(view);
      expect(json).not.toContain(created.id);
      expect(view).toMatchObject({
        cinNo: created.cinNo, contributorName: 'Founder Holdings Ltd', status: S.PENDING_APPROVAL,
        assetCode: 'AED', amount: '500000.00', legs: [],
      });
    });
  });

  describe('list', () => {
    it('returns projected views ordered by createdAt desc', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      await service.create(baseInput);
      await service.create({ ...baseInput, amount: '1000' });
      const { items, total } = await service.list();
      expect(total).toBe(2);
      expect(items[0].createdAt >= items[1].createdAt).toBe(true);
    });

    it('filters by status', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.capitalInjection.update({ where: { cinNo: created.cinNo }, data: { status: S.AWAITING_FUNDS } });
      await service.create({ ...baseInput, amount: '1000' });
      const { items, total } = await service.list({ status: S.AWAITING_FUNDS });
      expect(total).toBe(1);
      expect(items[0].cinNo).toBe(created.cinNo);
    });
  });
});
