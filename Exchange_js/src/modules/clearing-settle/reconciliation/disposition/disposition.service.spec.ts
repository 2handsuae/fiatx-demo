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
