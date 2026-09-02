import { BadRequestException } from '@nestjs/common';
import { DispositionService } from './disposition.service';

const CASE_ROW = {
  caseNo: 'REC-1', status: 'OPEN', book: 'CUSTOMER', walletRef: 'w-uuid',
  businessDate: '2026-09-01', ownerNo: 'CU001', traceId: null,
};
const ACTOR = { actorType: 'ADMIN', userId: 'uuid-1', userNo: 'ADM001', roleCodes: ['OPS_OFFICER'] } as any;

function build(overrides: any = {}) {
  const prisma: any = {
    reconciliationCase: { findUnique: jest.fn().mockResolvedValue(CASE_ROW) },
    reconciliationDisposition: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: 'd1' })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      findUnique: jest.fn(),
    },
    wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA001' }) },
    ...overrides,
  };
  const audit: any = { recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { svc: new DispositionService(prisma, audit), prisma, audit };
}

// 极简 Prisma where 求值器：OR 取任一子条件命中，其余键值要求逐一相等。
// 只有当 service 传来的 where 语义正确时，下面回归测试里的 existing 才会被
// 找到——如果 service 退回成把两个锚 AND 进同一层 where，这里会判不中。
function whereMatches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as any[]).some((cond) => whereMatches(row, cond));
    return row[key] === value;
  });
}

describe('DispositionService.record（spec §3.2/§7）', () => {
  it('挂起：落定性记录 + 审计带显式 requestId，不碰账', async () => {
    const { svc, prisma, audit } = build();
    const r = await svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'CUTOFF_STRADDLE', findingNote: '外部行时间戳在下一账期', internalDirection: 'IN',
    } as any, ACTOR);
    expect(r.outlet).toBe('HOLD_NEXT_PERIOD');
    const created = prisma.reconciliationDisposition.create.mock.calls[0][0].data;
    expect(created.book).toBe('CLIENT');                    // case.book CUSTOMER → CLIENT 归一化（同 adjustment）
    expect(created.dispositionNo).toMatch(/^RCD/);
    const auditArg = audit.recordByActor.mock.calls[0][0];
    expect(auditArg.action).toBe('RECON_DISPOSITION_RECORDED');
    expect(auditArg.causeCode).toBe('CUTOFF_STRADDLE');      // requiredFields 顶层
    expect(auditArg.outlet).toBe('HOLD_NEXT_PERIOD');
    expect(auditArg.requestId).toMatch(/^RECON_DISPOSITION_RECORDED_RCD/); // 显式 requestId
  });
  it('同锚重定 = 覆盖 + 再记一条审计', async () => {
    const existing = { id: 'd0', dispositionNo: 'RCD000', adjustmentNo: null };
    const { svc, prisma, audit } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
        create: jest.fn(),
      },
    });
    await svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', findingNote: '双胞胎实证', internalDirection: 'IN',
    } as any, ACTOR);
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalled();
    expect(prisma.reconciliationDisposition.create).not.toHaveBeenCalled();
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
  });
  it('已挂调账单的行拒绝覆盖（400）', async () => {
    const { svc } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue({ dispositionNo: 'RCD000', adjustmentNo: 'ADJ001' }),
      },
    });
    await expect(svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(BadRequestException);
  });
  it('同锚查找按 OR 而非 AND——锚集跨轮次漂移仍需命中既有记录、维持挂单锁（回归：曾经的 AND 写法会漏网）', async () => {
    // 场景还原评审逮到的缺陷：这条证据第一次定性时是 ORPHAN_INTERNAL，
    // 库里只留了 explainedFlowId，explainedExternalLineId 是 null；下一轮
    // 对账把它重分类成 AMOUNT_MISMATCH，新请求两个锚都带上了。
    const existing = {
      caseNo: 'REC-1', dispositionNo: 'RCD000', explainedFlowId: 'f1', explainedExternalLineId: null, adjustmentNo: 'ADJ001',
    };
    const findFirstMock = jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(whereMatches(existing, where) ? existing : null));
    const { svc, prisma } = build({
      reconciliationDisposition: { findFirst: findFirstMock, update: jest.fn(), create: jest.fn() },
    });

    await expect(svc.record('REC-1', {
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: 'f1', explainedExternalLineId: 'x-new',
      causeCode: 'AMT_MISBOOKED', findingNote: '重分类后两个锚都带', deltaSign: 1, internalSourceType: 'DEPOSIT',
    } as any, ACTOR)).rejects.toThrow(/ADJ001/); // 命中 existing 才会报出它挂的单号

    // 断言调用参数：必须按字段独立 OR，不能把两个锚 AND 进同一层 where
    // ——否则新请求的 explainedExternalLineId='x-new' 永远碰不上库里的 null。
    const calledWhere = findFirstMock.mock.calls[0][0].where;
    expect(calledWhere.OR).toEqual(expect.arrayContaining([
      { explainedFlowId: 'f1' },
      { explainedExternalLineId: 'x-new' },
    ]));
    expect(prisma.reconciliationDisposition.create).not.toHaveBeenCalled();
  });
  it('两个锚都缺 → 400；案件非 OPEN → 400', async () => {
    const { svc } = build();
    await expect(svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(/锚/);
    const closed = build({ reconciliationCase: { findUnique: jest.fn().mockResolvedValue({ ...CASE_ROW, status: 'RESOLVED' }) } });
    await expect(closed.svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1', causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(/OPEN|打开/);
  });
});

describe('DispositionService.linkAdjustment', () => {
  it('只接受 ADJUST 类出口且未挂单的定性', async () => {
    const { svc, prisma } = build({
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue({ dispositionNo: 'RCD001', outlet: 'ADJUST_REVERSE', adjustmentNo: null }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(), create: jest.fn(),
      },
    });
    await svc.linkAdjustment('RCD001', 'ADJ001');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD001' }, data: { adjustmentNo: 'ADJ001' },
    });
    const held = build({
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue({ dispositionNo: 'RCD002', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }),
        update: jest.fn(), findFirst: jest.fn(), create: jest.fn(),
      },
    });
    await expect(held.svc.linkAdjustment('RCD002', 'ADJ001')).rejects.toThrow(BadRequestException);
  });
});
