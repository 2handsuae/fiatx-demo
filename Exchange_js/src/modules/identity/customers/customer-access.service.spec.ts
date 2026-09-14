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
  const svc = new CustomerAccessService(prisma, restrictions);
  return { svc, prisma, restrictions };
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
      claimedMaterialStatus: null,
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

describe('CustomerAccessService.resolve — blockingNotes（准入判定地基）', () => {
  it('blockingNotes 含 SILENT 行，逐能力展开后 cause/restrictionNo/visibility 齐全', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const access = await svc.resolve('cust-1');

    // SANCTION_ROW scopes=['ALL'] 展开三能力，三条 blockingNotes 全部来自这一张 SILENT 便签
    expect(access.blockingNotes).toHaveLength(3);
    expect([...access.blockingNotes].sort((a, b) => a.capability.localeCompare(b.capability))).toEqual([
      { capability: 'DEPOSIT', restrictionNo: 'RST-1', cause: 'SANCTION', visibility: 'SILENT' },
      { capability: 'SWAP', restrictionNo: 'RST-1', cause: 'SANCTION', visibility: 'SILENT' },
      { capability: 'WITHDRAW', restrictionNo: 'RST-1', cause: 'SANCTION', visibility: 'SILENT' },
    ]);
  });
});

describe('CustomerAccessService.intakeDecision', () => {
  it('① SILENT-only（Carol 型：单张 SANCTION）→ ACCEPT_FREEZE', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    await expect(svc.intakeDecision('cust-1', 'WITHDRAW')).resolves.toBe('ACCEPT_FREEZE');
  });

  it('② DISCLOSED-only（Ivy 型：MATERIAL_EXPIRED）→ DENY', async () => {
    const { svc } = build({ openRows: [MATERIAL_ROW] });
    await expect(svc.intakeDecision('cust-1', 'WITHDRAW')).resolves.toBe('DENY');
  });

  it('③ SILENT+DISCLOSED 混合同卡一域 → DENY', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW, MATERIAL_ROW] });
    // WITHDRAW 同时被 SANCTION（SILENT，ALL 展开）与 MATERIAL_EXPIRED（DISCLOSED）卡住
    await expect(svc.intakeDecision('cust-1', 'WITHDRAW')).resolves.toBe('DENY');
  });

  it('④ 无便签 → ALLOW', async () => {
    const { svc } = build({ openRows: [] });
    await expect(svc.intakeDecision('cust-1', 'WITHDRAW')).resolves.toBe('ALLOW');
  });

  it('⑤ lifecycle 非 ACTIVE（如 OFFBOARDED）→ DENY，不看限制账', async () => {
    const { svc } = build({ lifecycle: 'OFFBOARDED', openRows: [] });
    await expect(svc.intakeDecision('cust-1', 'WITHDRAW')).resolves.toBe('DENY');
  });
});
