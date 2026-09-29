import { randomUUID } from 'node:crypto';
import { VendorPaymentService } from './vendor-payment.service';
import { VendorPaymentStatus as S } from './dto/vendor-payment.dto';
import { OutsourcingVendorsService } from '../../governance/compliance-office/outsourcing-vendors.service';

/** 行为化内存行 mock（照 capital-injection.service.spec.ts 的 makePrisma 先例）。
 *  clock 用递增计数器而非 `new Date()`——避免同一 tick 内连续两次写入撞同一毫秒。 */
function makePrisma() {
  const rows = new Map<string, any>();
  let clock = Date.parse('2026-09-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  const assets: Record<string, any> = {
    'asset-aed': { id: 'asset-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' },
    'asset-usdt': { id: 'asset-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' },
  };
  return {
    vendorPayment: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, failureReasonCode: null, failureNote: null, executedAt: null, settledAt: null, createdAt: tick(), updatedAt: tick(), ...data };
        rows.set(row.payNo, row);
        return { ...row, asset: assets[row.assetId] };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.payNo);
        if (!existing) throw new Error(`no such row: ${where.payNo}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        rows.set(where.payNo, updated);
        return { ...updated, asset: assets[updated.assetId] };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = rows.get(where.payNo);
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

/** 真实 OutsourcingVendorsService（横向读，非恒返回 mock）——只喂它需要的
 *  prisma.outsourcingVendor delegate，assertActiveByNo/findByNo 两方法都走真实实现，
 *  具区分力（ACTIVE 放行、TERMINATED 拒、未知 vendorNo 404）。第二个构造参数
 *  （AuditLogsService）留空——两方法都是只读守卫，不写审计。 */
function makeVendors(vendorRows: Record<string, any>) {
  const prisma = {
    outsourcingVendor: {
      findUnique: jest.fn(async ({ where }: any) => vendorRows[where.vendorNo] ?? null),
    },
  };
  return new OutsourcingVendorsService(prisma as any, {} as any);
}

const activeVendor = { id: 'vendor-1', vendorNo: 'VEN2609290001', name: 'HexTrust Custody Ltd', status: 'ACTIVE' };
const terminatedVendor = { id: 'vendor-2', vendorNo: 'VEN2609290002', name: 'Stale Vendor Ltd', status: 'TERMINATED' };

const baseInput = {
  vendorNo: activeVendor.vendorNo, payeeAccountRef: 'HexTrust ops account — IBAN AE070000000123456789',
  assetId: 'asset-aed', amount: '12000',
  purposeNote: 'HexTrust 2026-09 月费', prudentialPurpose: 'Discharge outsourced custody service fee obligation',
  reason: 'Monthly vendor invoice settlement', fromWalletId: 'w-ops-aed', createdByUserId: 'ADM1',
};

function makeAccounting(creditsPosted: bigint, debitsPosted: bigint, debitsPending = 0n) {
  return {
    resolveTbAccountId: jest.fn(async () => 1n),
    lookupBalance: jest.fn(async () => ({ creditsPosted, debitsPosted, debitsPending, creditsPending: 0n })),
  };
}

describe('VendorPaymentService (乙波二 T4)', () => {
  const svc = (
    prisma: any = makePrisma(),
    vendors: any = makeVendors({ [activeVendor.vendorNo]: activeVendor, [terminatedVendor.vendorNo]: terminatedVendor }),
    accounting: any = makeAccounting(0n, 0n),
  ) => new VendorPaymentService(prisma, vendors, accounting);

  describe('create — 出生守卫', () => {
    it('rejects create when vendor is TERMINATED', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, vendorNo: terminatedVendor.vendorNo })).rejects.toThrow(/not ACTIVE/);
    });

    it('rejects create with zero amount', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, amount: '0' })).rejects.toThrow(/greater than zero/);
    });

    it('rejects create with negative amount', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, amount: '-1' })).rejects.toThrow(/greater than zero/);
    });

    it('rejects create without prudentialPurpose', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, prudentialPurpose: '' })).rejects.toThrow(/prudentialPurpose is required/);
    });

    it('rejects create without purposeNote', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, purposeNote: '' })).rejects.toThrow(/purposeNote is required/);
    });

    it('rejects create without reason', async () => {
      const service = svc();
      await expect(service.create({ ...baseInput, reason: '' })).rejects.toThrow(/reason is required/);
    });

    it('happy path: writes a PAY-prefixed row, PENDING_APPROVAL, vendor snapshot from the registry', async () => {
      const service = svc();
      const row = await service.create(baseInput);
      expect(row.payNo).toMatch(/^PAY\d{12}$/);
      expect(row.status).toBe(S.PENDING_APPROVAL);
      expect(row.vendorId).toBe(activeVendor.id);
      expect(row.vendorNo).toBe(activeVendor.vendorNo);
      expect(row.vendorName).toBe(activeVendor.name);
      expect(row.fromWalletId).toBe('w-ops-aed');
    });
  });

  describe('六态六边（real VENDOR_PAYMENT_TRANSITIONS table，禁扫文本）', () => {
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.SUCCESS], [S.EXECUTING, S.FAILED],
    ])('%s → %s allowed', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });

    it.each([
      [S.PENDING_APPROVAL, S.SUCCESS],
      [S.EXECUTING, S.REJECTED],
      [S.FAILED, S.PENDING_APPROVAL],
      [S.REJECTED, S.PENDING_APPROVAL],
      [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s rejected', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/Illegal vendor payment status transition/); });

    it('rejects EXECUTING → CANCELLED (not in table)', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.vendorPayment.update({ where: { payNo: created.payNo }, data: { status: S.EXECUTING } });
      await expect(service.transition(created.payNo, S.CANCELLED)).rejects.toThrow(/Illegal vendor payment status transition/);
    });

    it('SUCCESS is terminal — no further transitions', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await prisma.vendorPayment.update({ where: { payNo: created.payNo }, data: { status: S.EXECUTING } });
      const executed = await service.transition(created.payNo, S.SUCCESS, { executedAt: new Date(), settledAt: new Date() });
      expect(executed.status).toBe(S.SUCCESS);
      await expect(service.transition(created.payNo, S.SUCCESS)).rejects.toThrow(/Illegal vendor payment status transition/);
      await expect(service.transition(created.payNo, S.FAILED)).rejects.toThrow(/Illegal vendor payment status transition/);
    });
  });

  // 评审同款：6×6=36 组穷举独立真值表（六态六边），禁 import 被测常量。
  describe('六态六边全矩阵（6×6=36 组穷举，独立真值表，禁止 import 被测常量）', () => {
    const ALLOWED: ReadonlySet<string> = new Set([
      `${S.PENDING_APPROVAL}->${S.EXECUTING}`,
      `${S.PENDING_APPROVAL}->${S.FAILED}`,
      `${S.PENDING_APPROVAL}->${S.REJECTED}`,
      `${S.PENDING_APPROVAL}->${S.CANCELLED}`,
      `${S.EXECUTING}->${S.SUCCESS}`,
      `${S.EXECUTING}->${S.FAILED}`,
    ]);
    const ALL_STATES: readonly string[] = [
      S.PENDING_APPROVAL, S.EXECUTING, S.SUCCESS, S.FAILED, S.REJECTED, S.CANCELLED,
    ];
    const ALL_PAIRS: Array<[string, string]> = ALL_STATES.flatMap((from) => ALL_STATES.map((to) => [from, to] as [string, string]));

    it('sanity：6 态 → 36 组、恰好 6 条允许边', () => {
      expect(ALL_STATES).toHaveLength(6);
      expect(ALL_PAIRS).toHaveLength(36);
      expect(ALLOWED.size).toBe(6);
    });

    it.each(ALL_PAIRS)('%s → %s', (from, to) => {
      if (ALLOWED.has(`${from}->${to}`)) {
        expect(() => svc().assertTransition(from, to)).not.toThrow();
      } else {
        expect(() => svc().assertTransition(from, to)).toThrow(/Illegal vendor payment status transition/);
      }
    });
  });

  describe('stampApprovalNo', () => {
    it('writes approvalNo onto the row', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      await service.stampApprovalNo(created.payNo, 'APR1');
      const row = await service.findByNo(created.payNo);
      expect(row.approvalNo).toBe('APR1');
    });
  });

  describe('assertFirmOpsBalance — operating account net credit balance (credits − debits − pending debits) ≥ amount', () => {
    it('enough → allowed', async () => {
      const service = svc(makePrisma(), makeVendors({}), makeAccounting(100_000_000_000n, 571_811_000n));
      await expect(service.assertFirmOpsBalance('USDT', 7_500_000n)).resolves.toBeUndefined();
    });
    it('not enough → 400, message carries available / needed', async () => {
      const service = svc(makePrisma(), makeVendors({}), makeAccounting(1_000n, 0n));
      await expect(service.assertFirmOpsBalance('AED', 2_000n)).rejects.toThrow(/Insufficient.*available 1000.*need 2000/);
    });
    it('pending debits also count as committed', async () => {
      const service = svc(makePrisma(), makeVendors({}), makeAccounting(3_000n, 0n, 2_000n));
      await expect(service.assertFirmOpsBalance('AED', 1_500n)).rejects.toThrow(/Insufficient/);
    });
    it('currency not on the ledger → 400', async () => {
      const service = svc(makePrisma(), makeVendors({}), makeAccounting(1n, 0n));
      await expect(service.assertFirmOpsBalance('BTC', 1n)).rejects.toThrow(/Unsupported currency/);
    });
  });

  describe('getView — 铁律⑥零 UUID 投影', () => {
    it('projects business fields only — assetCode/amount formatted to precision, no id key present', async () => {
      const prisma = makePrisma();
      const service = svc(prisma);
      const created = await service.create(baseInput);
      const view = await service.getView(created.payNo);
      const json = JSON.stringify(view);
      expect(json).not.toContain(created.id);
      expect(json).not.toContain(activeVendor.id);
      expect(view).toMatchObject({
        payNo: created.payNo, vendorNo: activeVendor.vendorNo, vendorName: activeVendor.name,
        status: S.PENDING_APPROVAL, assetCode: 'AED', amount: '12000.00', legs: [],
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
      await prisma.vendorPayment.update({ where: { payNo: created.payNo }, data: { status: S.EXECUTING } });
      await service.create({ ...baseInput, amount: '1000' });
      const { items, total } = await service.list({ status: S.EXECUTING });
      expect(total).toBe(1);
      expect(items[0].payNo).toBe(created.payNo);
    });
  });
});
