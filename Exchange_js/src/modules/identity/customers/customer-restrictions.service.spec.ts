import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
} from './constants/restriction-cause.constant';
import { NotFoundException } from '@nestjs/common';
import { CustomerRestrictionsService } from './customer-restrictions.service';
/** Task 9：open() 在 scope=ALL 时广播 customer.restriction.opened，本 spec 只需哑桩。 */
const eventEmitterStub = { emit: jest.fn() };


describe('RESTRICTION_CAUSE_POLICY', () => {
  it('七条 cause 的 defaultScopes / visibility / releasePolicy / scopeSelectable / customerLabel 逐字固定（防漂移）', () => {
    expect(RESTRICTION_CAUSE_POLICY).toEqual({
      SANCTION: {
        defaultScopes: ['ALL'],
        visibility: 'SILENT',
        releasePolicy: 'MLRO_APPROVAL',
        scopeSelectable: false,
        customerLabel: '',
      },
      ADMIN_SUSPENSION: {
        defaultScopes: ['ALL'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Account suspended',
      },
      MATERIAL_EXPIRED: {
        defaultScopes: ['WITHDRAW', 'SWAP'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Document expired',
      },
      TIER_UPGRADE_PENDING: {
        defaultScopes: ['WITHDRAW', 'SWAP'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Additional review in progress',
      },
      KYT_REJECTED_SOFT: {
        defaultScopes: ['SWAP', 'WITHDRAW'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Verification required',
      },
      KYT_REJECTED_HARD: {
        defaultScopes: ['SWAP', 'WITHDRAW'],
        visibility: 'SILENT',
        releasePolicy: 'MLRO_APPROVAL',
        scopeSelectable: false,
        customerLabel: '',
      },
      PENDING_DOCUMENT: {
        defaultScopes: ['WITHDRAW', 'SWAP'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: true,
        customerLabel: 'Document required',
      },
    });
  });

  it('SILENT 的 cause 一律没有 customerLabel（客户面结构性无痕）', () => {
    const causes = Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[];
    expect(causes).toHaveLength(7);
    for (const cause of causes) {
      const policy = RESTRICTION_CAUSE_POLICY[cause];
      if (policy.visibility === 'SILENT') expect(policy.customerLabel).toBe('');
      else expect(policy.customerLabel.length).toBeGreaterThan(0);
    }
  });

  it('只有 PENDING_DOCUMENT 允许运营指定 scope', () => {
    const selectable = (Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[]).filter(
      (c) => RESTRICTION_CAUSE_POLICY[c].scopeSelectable,
    );
    expect(selectable).toEqual(['PENDING_DOCUMENT']);
  });
});

/**
 * tx.* 是事务内 client，prisma.* 是事务外 base client。分开 mock 才能断言
 * 「幂等查 + 插入」确实同处一个事务（并发双贴的唯一防线），而不是散在事务外。
 */
function createPrismaMock() {
  const tx = {
    customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }),
    },
    customerRestriction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    customerMain: { findUnique: jest.fn() },
    customerRestriction: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  return { prisma, tx };
}

function createAuditMock() {
  return { recordSystem: jest.fn().mockResolvedValue(undefined), recordByActor: jest.fn() } as any;
}

/** 取第 call 次 createMany 落库的那一批行 */
function createdRows(tx: ReturnType<typeof createPrismaMock>['tx'], call = 0): any[] {
  return tx.customerRestriction.createMany.mock.calls[call][0].data;
}

describe('CustomerRestrictionsService.open', () => {
  it('七个 cause 落库的 scope / visibility / releasePolicy 与注册表逐字一致', async () => {
    for (const cause of Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[]) {
      const { prisma, tx } = createPrismaMock();
      const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

      await svc.open({ customerId: 'c1', cause, reason: 'r', openedBy: 'ops@fiatx.com' });

      const policy = RESTRICTION_CAUSE_POLICY[cause];
      const rows = createdRows(tx);
      expect(rows.map((r) => r.scope)).toEqual(policy.defaultScopes);
      expect(new Set(rows.map((r) => r.restrictionNo)).size).toBe(1);
      for (const row of rows) {
        expect(row.visibility).toBe(policy.visibility);
        expect(row.releasePolicy).toBe(policy.releasePolicy);
        expect(row.status).toBe('OPEN');
        expect(row.customerId).toBe('c1');
        expect(row.openedBy).toBe('ops@fiatx.com');
        expect(row.restrictionNo).toMatch(/^RST\d{10}$/);
      }
    }
  });

  it('入参里的 visibility / releasePolicy 一律不生效（类型上不允许，运行时也被忽略）', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    await svc.open({
      customerId: 'c1',
      cause: 'SANCTION',
      reason: 'sanctions hit',
      openedBy: 'mlro@fiatx.com',
      ...({ visibility: 'DISCLOSED', releasePolicy: 'OPS_APPROVAL' } as any),
    });

    const [row] = createdRows(tx);
    expect(row.visibility).toBe('SILENT');
    expect(row.releasePolicy).toBe('MLRO_APPROVAL');
  });

  it('scope 只有 PENDING_DOCUMENT 接受运营指定，其余 cause 传了也用注册表默认值', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    await svc.open({
      customerId: 'c1',
      cause: 'MATERIAL_EXPIRED',
      scopes: ['DEPOSIT'],
      reason: 'expired',
      openedBy: 'ops@fiatx.com',
    });
    expect(createdRows(tx, 0).map((r) => r.scope)).toEqual(['WITHDRAW', 'SWAP']);

    await svc.open({
      customerId: 'c1',
      cause: 'PENDING_DOCUMENT',
      scopes: ['WITHDRAW'],
      reason: 'need bank statement',
      openedBy: 'ops@fiatx.com',
    });
    expect(createdRows(tx, 1).map((r) => r.scope)).toEqual(['WITHDRAW']);
  });

  it('幂等：同 (customerId, cause, caseRef) 二次 open → created:false、不新增行、审计记 SKIPPED', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findFirst.mockResolvedValue({
      restrictionNo: 'RST2608150001',
      traceId: 'CUSTOMER_RESTRICTION:t-1',
      scope: 'WITHDRAW',
    });
    tx.customerRestriction.findMany.mockResolvedValue([
      { restrictionNo: 'RST2608150001', scope: 'WITHDRAW' },
      { restrictionNo: 'RST2608150001', scope: 'SWAP' },
    ]);
    const svc = new CustomerRestrictionsService(prisma, audit, eventEmitterStub as any);

    const result = await svc.open({
      customerId: 'c1',
      cause: 'MATERIAL_EXPIRED',
      reason: 'Emirates ID expired',
      caseRef: 'MRC26073100xx',
      openedBy: 'system-cron',
    });

    expect(result).toEqual({ restrictionNo: 'RST2608150001', created: false });
    expect(tx.customerRestriction.createMany).not.toHaveBeenCalled();
    expect(tx.customerRestriction.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'c1',
        cause: 'MATERIAL_EXPIRED',
        caseRef: 'MRC26073100xx',
        status: 'OPEN',
      },
    });
    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_RESTRICTION_ADDED',
        result: 'SKIPPED',
        metadata: expect.objectContaining({
          restrictionNo: 'RST2608150001',
          scopes: ['WITHDRAW', 'SWAP'],
        }),
      }),
    );
  });

  it('caseRef 为 null 时不去重：两次 open 产生两个不同 restrictionNo', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);
    // generateReferenceNo 的随机段固定成两个不同值，避免 1/10000 撞号导致偶发红
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0.1111).mockReturnValueOnce(0.2222);

    const first = await svc.open({
      customerId: 'c1',
      cause: 'PENDING_DOCUMENT',
      reason: 'ID copy',
      openedBy: 'ops@fiatx.com',
    });
    const second = await svc.open({
      customerId: 'c1',
      cause: 'PENDING_DOCUMENT',
      reason: 'proof of address',
      openedBy: 'ops@fiatx.com',
    });
    randomSpy.mockRestore();

    expect(tx.customerRestriction.findFirst).not.toHaveBeenCalled();
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.restrictionNo).not.toBe(second.restrictionNo);
    expect(tx.customerRestriction.createMany).toHaveBeenCalledTimes(2);
  });

  it('一号多行：MATERIAL_EXPIRED 落 WITHDRAW / SWAP 两行，同号同 traceId 同一事务', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    const result = await svc.open({
      customerId: 'c1',
      cause: 'MATERIAL_EXPIRED',
      reason: 'Emirates ID expired 08-01',
      caseRef: 'MRC26073100xx',
      openedBy: 'system-cron',
    });

    const rows = createdRows(tx);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.scope)).toEqual(['WITHDRAW', 'SWAP']);
    expect(rows[0].restrictionNo).toBe(rows[1].restrictionNo);
    expect(rows[0].traceId).toBe(rows[1].traceId);
    expect(rows[0].caseRef).toBe('MRC26073100xx');
    expect(result).toEqual({ restrictionNo: rows[0].restrictionNo, created: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.customerRestriction.findFirst).not.toHaveBeenCalled();
  });

  it('SANCTION 额外写一条 CUSTOMER_FROZEN；非 SANCTION 只写 ADDED', async () => {
    const { prisma } = createPrismaMock();
    const audit = createAuditMock();
    const svc = new CustomerRestrictionsService(prisma, audit, eventEmitterStub as any);

    await svc.open({ customerId: 'c1', cause: 'SANCTION', reason: 'CRA hit', openedBy: 'mlro@fiatx.com' });
    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'CUSTOMER_RESTRICTION_ADDED',
      'CUSTOMER_FROZEN',
    ]);

    audit.recordSystem.mockClear();
    await svc.open({ customerId: 'c1', cause: 'ADMIN_SUSPENSION', reason: 'ops hold', openedBy: 'ops@fiatx.com' });
    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'CUSTOMER_RESTRICTION_ADDED',
    ]);
  });

  it('客户不存在直接抛 NotFoundException', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.customerMain.findUnique.mockResolvedValue(null);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    await expect(
      svc.open({ customerId: 'ghost', cause: 'SANCTION', reason: 'x', openedBy: 'ops' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('传了外部 tx：不再自己开 $transaction，写入直接走传进来的那个 client（不是别开的第二事务）', async () => {
    const { prisma } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    const externalTx = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }),
      },
      customerRestriction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;

    const result = await svc.open(
      { customerId: 'c1', cause: 'PENDING_DOCUMENT', reason: 'ID copy', openedBy: 'ops@fiatx.com' },
      externalTx,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(externalTx.customerMain.findUnique).toHaveBeenCalledTimes(1);
    expect(externalTx.customerRestriction.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.customerMain.findUnique).not.toHaveBeenCalled();
    expect(result.created).toBe(true);
  });
});

describe('CustomerRestrictionsService.release', () => {
  const openRows = (cause: RestrictionCause, visibility: string) => [
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'WITHDRAW',
      cause,
      visibility,
      status: 'OPEN',
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'SWAP',
      cause,
      visibility,
      status: 'OPEN',
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
  ];

  it('一次撕掉同号全部行，写 CUSTOMER_RESTRICTION_CLEARED', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findMany.mockResolvedValue(openRows('MATERIAL_EXPIRED', 'DISCLOSED'));
    const svc = new CustomerRestrictionsService(prisma, audit, eventEmitterStub as any);

    await svc.release('RST2608150001', {
      releasedBy: 'ops@fiatx.com',
      releaseMode: 'MANUAL',
      releaseApprovalNo: 'APR2608150001',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.customerRestriction.updateMany).toHaveBeenCalledWith({
      where: { restrictionNo: 'RST2608150001', status: 'OPEN' },
      data: expect.objectContaining({
        status: 'RELEASED',
        releasedBy: 'ops@fiatx.com',
        releaseMode: 'MANUAL',
        releaseApprovalNo: 'APR2608150001',
        releaseOrderRef: null,
      }),
    });
    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_RESTRICTION_CLEARED',
        result: 'SUCCESS',
        traceId: 'CUSTOMER_RESTRICTION:t-1',
        metadata: expect.objectContaining({
          restrictionNo: 'RST2608150001',
          cause: 'MATERIAL_EXPIRED',
          scopes: ['WITHDRAW', 'SWAP'],
          releaseMode: 'MANUAL',
          approvalNo: 'APR2608150001',
        }),
      }),
    );
  });

  it('SANCTION 撕的时候额外写 CUSTOMER_UNFROZEN，并带上政府解除令文书号', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findMany.mockResolvedValue([
      { ...openRows('SANCTION', 'SILENT')[0], scope: 'ALL' },
    ]);
    const svc = new CustomerRestrictionsService(prisma, audit, eventEmitterStub as any);

    await svc.release('RST2608150001', {
      releasedBy: 'mlro@fiatx.com',
      releaseMode: 'MANUAL',
      releaseApprovalNo: 'APR2608150002',
      releaseOrderRef: 'GOV-2026-0815',
    });

    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'CUSTOMER_RESTRICTION_CLEARED',
      'CUSTOMER_UNFROZEN',
    ]);
    expect(audit.recordSystem.mock.calls[0][0].metadata.releaseOrderRef).toBe('GOV-2026-0815');
  });

  it('已 RELEASED 的便签幂等成功：不再 update、不重复写审计；号不存在才抛 NotFound', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findMany.mockResolvedValue([
      { ...openRows('MATERIAL_EXPIRED', 'DISCLOSED')[0], status: 'RELEASED' },
    ]);
    const svc = new CustomerRestrictionsService(prisma, audit, eventEmitterStub as any);

    await expect(
      svc.release('RST2608150001', { releasedBy: 'ops@fiatx.com', releaseMode: 'AUTO' }),
    ).resolves.toBeUndefined();
    expect(tx.customerRestriction.updateMany).not.toHaveBeenCalled();
    expect(audit.recordSystem).not.toHaveBeenCalled();

    tx.customerRestriction.findMany.mockResolvedValue([]);
    await expect(
      svc.release('RST-nope', { releasedBy: 'ops@fiatx.com', releaseMode: 'AUTO' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('传了外部 tx：不再自己开 $transaction，写入直接走传进来的那个 client（不是别开的第二事务）', async () => {
    const { prisma } = createPrismaMock();
    const audit = createAuditMock();
    const svc = new CustomerRestrictionsService(prisma, audit, eventEmitterStub as any);

    const externalTx = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue({ customerNo: 'CUS-001' }),
      },
      customerRestriction: {
        findMany: jest.fn().mockResolvedValue(openRows('MATERIAL_EXPIRED', 'DISCLOSED')),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    } as any;

    await svc.release(
      'RST2608150001',
      { releasedBy: 'ops@fiatx.com', releaseMode: 'AUTO' },
      externalTx,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(externalTx.customerRestriction.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.customerRestriction.findMany).not.toHaveBeenCalled();
    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_RESTRICTION_CLEARED' }),
    );
  });
});

describe('CustomerRestrictionsService 读侧', () => {
  const dbRows = [
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'WITHDRAW',
      cause: 'MATERIAL_EXPIRED',
      visibility: 'DISCLOSED',
      releasePolicy: 'OPS_APPROVAL',
      status: 'OPEN',
      reason: 'Emirates ID expired',
      caseRef: 'MRC26073100xx',
      releaseOrderRef: null,
      openedAt: new Date('2026-08-09T02:00:00Z'),
      openedBy: 'system-cron',
      releasedAt: null,
      releasedBy: null,
      releaseApprovalNo: null,
      releaseMode: null,
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'SWAP',
      cause: 'MATERIAL_EXPIRED',
      visibility: 'DISCLOSED',
      releasePolicy: 'OPS_APPROVAL',
      status: 'OPEN',
      reason: 'Emirates ID expired',
      caseRef: 'MRC26073100xx',
      releaseOrderRef: null,
      openedAt: new Date('2026-08-09T02:00:00Z'),
      openedBy: 'system-cron',
      releasedAt: null,
      releasedBy: null,
      releaseApprovalNo: null,
      releaseMode: null,
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
  ];

  it('listOpen / findByNo 把同号多行折成一行、scope 收进 scopes', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerRestriction.findMany.mockResolvedValue(dbRows);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    const [row] = await svc.listOpen('c1');
    expect(row.restrictionNo).toBe('RST2608150001');
    expect(row.scopes).toEqual(['WITHDRAW', 'SWAP']);
    expect(row.cause).toBe('MATERIAL_EXPIRED');
    expect(row.visibility).toBe('DISCLOSED');
    expect(row.status).toBe('OPEN');
    expect(prisma.customerRestriction.findMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', status: 'OPEN' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });

    const byNo = await svc.findByNo('RST2608150001');
    expect(byNo?.scopes).toEqual(['WITHDRAW', 'SWAP']);
  });

  it('listAll 不过滤 status；findByNo 查不到返回 null', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerRestriction.findMany.mockResolvedValue([]);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    expect(await svc.listAll('c1')).toEqual([]);
    expect(prisma.customerRestriction.findMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    expect(await svc.findByNo('RST-nope')).toBeNull();
  });

  it('findOpenByCause：给了 caseRef 就精确匹配，传 null 表示不限 caseRef', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerRestriction.findFirst.mockResolvedValue(dbRows[0]);
    prisma.customerRestriction.findMany.mockResolvedValue(dbRows);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock(), eventEmitterStub as any);

    const hit = await svc.findOpenByCause('c1', 'MATERIAL_EXPIRED', 'MRC26073100xx');
    expect(hit?.scopes).toEqual(['WITHDRAW', 'SWAP']);
    expect(prisma.customerRestriction.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'c1',
        cause: 'MATERIAL_EXPIRED',
        status: 'OPEN',
        caseRef: 'MRC26073100xx',
      },
      orderBy: { openedAt: 'asc' },
    });

    prisma.customerRestriction.findFirst.mockClear();
    await svc.findOpenByCause('c1', 'KYT_REJECTED_SOFT', null);
    expect(prisma.customerRestriction.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'c1', cause: 'KYT_REJECTED_SOFT', status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
    });
  });
});
