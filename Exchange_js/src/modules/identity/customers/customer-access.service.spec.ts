import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerAccessService } from './customer-access.service';

/**
 * 全部依赖用手写 mock 直接构造（本仓单测惯例，见 customer-restrictions.service.spec.ts）。
 * listOpen 返回的是「按 restrictionNo 聚合后」的 RestrictionRow（scopes 是数组），
 * 与 Task 3 契约一致：一号多行在 domain service 内已合并。
 */
function row(over: Partial<any> = {}) {
  return {
    restrictionNo: 'RST-1',
    customerId: 'cust-1',
    scopes: ['ALL'],
    cause: 'SANCTION',
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    status: 'OPEN',
    reason: 'sanctions hit',
    caseRef: null,
    releaseOrderRef: null,
    openedAt: new Date('2026-08-15T00:00:00.000Z'),
    openedBy: 'system',
    releasedAt: null,
    releasedBy: null,
    releaseApprovalNo: null,
    releaseMode: null,
    traceId: 'trace-1',
    ...over,
  };
}

const SANCTION_ROW = row();
const MATERIAL_ROW = row({
  restrictionNo: 'RST-2',
  scopes: ['WITHDRAW', 'SWAP'],
  cause: 'MATERIAL_EXPIRED',
  visibility: 'DISCLOSED',
  releasePolicy: 'OPS_APPROVAL',
  reason: 'passport expired',
});

function build(opts: {
  lifecycle?: string | null;
  openRows?: any[];
  balances?: Record<string, bigint>;
  inflight?: number;
} = {}) {
  const prisma = {
    customerMain: {
      findUnique: jest.fn().mockResolvedValue(
        opts.lifecycle === null
          ? null
          : { id: 'cust-1', customerNo: 'C-001', lifecycle: opts.lifecycle ?? 'ACTIVE' },
      ),
    },
  } as any;
  const restrictions = { listOpen: jest.fn().mockResolvedValue(opts.openRows ?? []) } as any;
  const accounting = {
    getCustomerAvailableBalance: jest.fn(async (_c: string, currency: string) => {
      const balances = opts.balances ?? {};
      if (!(currency in balances)) {
        // 客户在该 ledger 从未开户 —— 真实 AccountingService 就是抛这个
        throw new NotFoundException({ code: 'TB_ACCOUNT_REGISTRY_NOT_FOUND', message: 'no account' });
      }
      const total = balances[currency];
      return { available: total, held: 0n, total };
    }),
  } as any;
  const fundsOrders = {
    countNonTerminalByCustomer: jest.fn().mockResolvedValue(opts.inflight ?? 0),
  } as any;
  const svc = new CustomerAccessService(prisma, restrictions, accounting, fundsOrders);
  return { svc, prisma, restrictions, accounting, fundsOrders };
}

async function catchForbidden(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse();
  }
  throw new Error('expected ForbiddenException, but the call resolved');
}

describe('CustomerAccessService.resolve', () => {
  it('多因并存：SANCTION(ALL) + MATERIAL_EXPIRED(WITHDRAW,SWAP) → blocked 三能力齐，disclosedBlocked 只有 WITHDRAW+SWAP', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW, MATERIAL_ROW] });
    const access = await svc.resolve('cust-1');

    expect([...access.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect([...access.disclosedBlocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
    expect(access.openCount).toBe(2);
    expect(access.lifecycle).toBe('ACTIVE');
  });

  it('tipping-off 命门：仅有 SILENT 限制时 blocked 非空而 disclosedBlocked 为空集', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const access = await svc.resolve('cust-1');

    expect(access.blocked.size).toBe(3);
    expect(access.disclosedBlocked.size).toBe(0);
    expect(access.disclosed).toEqual([]);
    // 客户面唯一能看到的计数字段不存在；openCount 是 admin 面的，仍要含 SILENT
    expect(access.openCount).toBe(1);
  });

  it('disclosed 不含任何 SILENT 行，label 取自 RESTRICTION_CAUSE_POLICY', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW, MATERIAL_ROW] });
    const access = await svc.resolve('cust-1');

    expect(access.disclosed).toHaveLength(1);
    expect(access.disclosed[0]).toEqual({
      restrictionNo: 'RST-2',
      // resolve() 恒给 null —— 认领标记由客户面出口（client controller）回填，
      // 执法侧不依赖材料账（避免模块环）。
      claimedByMaterialRequestNo: null,
      cause: 'MATERIAL_EXPIRED',
      scopes: ['WITHDRAW', 'SWAP'],
      label: 'Document expired',
      reason: 'passport expired',
      openedAt: '2026-08-15T00:00:00.000Z',
    });
    expect(JSON.stringify(access.disclosed)).not.toContain('SANCTION');
    expect(JSON.stringify(access.disclosed)).not.toContain('SILENT');
  });

  it('客户不存在 → NotFoundException', async () => {
    const { svc } = build({ lifecycle: null });
    await expect(svc.resolve('cust-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CustomerAccessService.assertCapability', () => {
  it('lifecycle 非 ACTIVE → LIFECYCLE_NOT_ACTIVE', async () => {
    const { svc } = build({ lifecycle: 'IN_VERIFICATION' });
    const body = await catchForbidden(svc.assertCapability('cust-1', 'WITHDRAW'));
    expect(body.code).toBe('LIFECYCLE_NOT_ACTIVE');
  });

  it('blocked 命中 → CAPABILITY_RESTRICTED，且响应体不泄露 cause / visibility', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const body = await catchForbidden(svc.assertCapability('cust-1', 'WITHDRAW'));

    expect(body.code).toBe('CAPABILITY_RESTRICTED');
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    const text = JSON.stringify(body);
    for (const leak of ['SANCTION', 'SILENT', 'DISCLOSED', 'MATERIAL_EXPIRED', 'RST-1', 'sanctions hit']) {
      expect(text).not.toContain(leak);
    }
  });

  it('SILENT 与 DISCLOSED 两种被拒的响应体逐字相同（否则错误码即信号）', async () => {
    const silent = build({ openRows: [SANCTION_ROW] });
    const disclosed = build({ openRows: [MATERIAL_ROW] });
    const a = await catchForbidden(silent.svc.assertCapability('cust-1', 'WITHDRAW'));
    const b = await catchForbidden(disclosed.svc.assertCapability('cust-1', 'WITHDRAW'));
    expect(a).toEqual(b);
  });

  it('未被卡的能力放行', async () => {
    const { svc } = build({ openRows: [MATERIAL_ROW] });
    await expect(svc.assertCapability('cust-1', 'DEPOSIT')).resolves.toBeUndefined();
  });
});

describe('CustomerAccessService.assertOffboardable', () => {
  it('有 SILENT OPEN 行 → OFFBOARD_BLOCKED_BY_SANCTION', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const body = await catchForbidden(svc.assertOffboardable('cust-1'));
    expect(body.code).toBe('OFFBOARD_BLOCKED_BY_SANCTION');
    expect(body.restrictionNo).toBe('RST-1');
  });

  it('余额非零 → OFFBOARD_BLOCKED_BY_BALANCE', async () => {
    const { svc } = build({ openRows: [MATERIAL_ROW], balances: { AED: 12345n } });
    const body = await catchForbidden(svc.assertOffboardable('cust-1'));
    expect(body.code).toBe('OFFBOARD_BLOCKED_BY_BALANCE');
    expect(body.currency).toBe('AED');
    expect(body.total).toBe('12345');
  });

  it('有非终态 funds_order → OFFBOARD_BLOCKED_BY_INFLIGHT', async () => {
    const { svc } = build({ balances: { AED: 0n, USDT: 0n }, inflight: 2 });
    const body = await catchForbidden(svc.assertOffboardable('cust-1'));
    expect(body.code).toBe('OFFBOARD_BLOCKED_BY_INFLIGHT');
    expect(body.inflight).toBe(2);
  });

  it('干净客户放行；某币种从未开户（TB 注册表 404）按 0 处理，不误报 BALANCE', async () => {
    const { svc, accounting } = build({ balances: { AED: 0n } }); // USDT 会抛 NotFound
    await expect(svc.assertOffboardable('cust-1')).resolves.toBeUndefined();
    expect(accounting.getCustomerAvailableBalance).toHaveBeenCalledTimes(2);
  });
});
