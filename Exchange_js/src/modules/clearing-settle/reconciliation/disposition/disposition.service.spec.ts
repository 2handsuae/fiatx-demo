import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

// Minimal Prisma where evaluator: OR matches if any sub-condition hits, other keys require exact equality.
// The `existing` row in the regression test below is only found when the service's where clause is
// correctly shaped — if the service regresses to AND-ing the two anchors into one where level, this
// evaluator will fail to match it.
function whereMatches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as any[]).some((cond) => whereMatches(row, cond));
    return row[key] === value;
  });
}

describe('DispositionService.record (spec §3.2/§7)', () => {
  it('hold: writes a finding record + audit with an explicit requestId, touches no ledger', async () => {
    const { svc, prisma, audit } = build();
    const r = await svc.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'CUTOFF_STRADDLE', disposition: 'HOLD_NEXT_PERIOD', findingNote: 'External line timestamp falls in the next period', internalDirection: 'IN',
    } as any, ACTOR);
    expect(r.outlet).toBe('HOLD_NEXT_PERIOD');
    const created = prisma.reconciliationDisposition.create.mock.calls[0][0].data;
    expect(created.book).toBe('CLIENT');                    // case.book CUSTOMER → normalized to CLIENT (same as adjustment)
    expect(created.dispositionNo).toMatch(/^RCD/);
    const auditArg = audit.recordByActor.mock.calls[0][0];
    expect(auditArg.action).toBe('RECON_DISPOSITION_RECORDED');
    expect(auditArg.causeCode).toBe('CUTOFF_STRADDLE');      // requiredFields top level
    expect(auditArg.outlet).toBe('HOLD_NEXT_PERIOD');
    expect(auditArg.requestId).toMatch(/^RECON_DISPOSITION_RECORDED_RCD/); // explicit requestId
  });
  it('re-finding the same anchor = overwrite + one more audit entry', async () => {
    const existing = { id: 'd0', dispositionNo: 'RCD000', adjustmentNo: null };
    const { svc, prisma, audit } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
        create: jest.fn(),
      },
    });
    await svc.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', disposition: 'REVERSE', findingNote: 'Twin entry confirmed', internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ACTOR);
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalled();
    expect(prisma.reconciliationDisposition.create).not.toHaveBeenCalled();
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
  });
  it('a line already linked to an adjustment rejects overwrite (400)', async () => {
    const { svc } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue({ dispositionNo: 'RCD000', adjustmentNo: 'ADJ001' }),
      },
    });
    await expect(svc.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', disposition: 'REVERSE', findingNote: 'x', internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ACTOR)).rejects.toThrow(BadRequestException);
  });
  it('same-anchor lookup uses OR not AND — an anchor set that drifts across runs still hits the existing record and keeps the link lock (regression: the old AND wording would miss it)', async () => {
    // Reproduces a defect caught in review: this piece of evidence was first found as
    // ORPHAN_INTERNAL, so the row only had explainedFlowId, with explainedExternalLineId
    // null; the next reconciliation run reclassified it as AMOUNT_MISMATCH, and the new
    // request carries both anchors.
    const existing = {
      caseNo: 'REC-1', dispositionNo: 'RCD000', explainedFlowId: 'f1', explainedExternalLineId: null, adjustmentNo: 'ADJ001',
    };
    const findFirstMock = jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(whereMatches(existing, where) ? existing : null));
    const { svc, prisma } = build({
      reconciliationDisposition: { findFirst: findFirstMock, update: jest.fn(), create: jest.fn() },
    });

    await expect(svc.record({
      caseNo: 'REC-1', matchType: 'AMOUNT_MISMATCH', explainedFlowId: 'f1', explainedExternalLineId: 'x-new',
      causeCode: 'AMT_MISBOOKED', disposition: 'CORRECT', findingNote: 'Both anchors present after reclassification', deltaSign: 1, internalSourceType: 'DEPOSIT',
    } as any, ACTOR)).rejects.toThrow(/ADJ001/); // only hits existing (and reports its linked order) when the lookup matches

    // Assert the call params: the two anchors must be independent OR clauses, not AND-ed
    // into the same where level — otherwise the new request's explainedExternalLineId='x-new'
    // would never match the null stored in the database.
    const calledWhere = findFirstMock.mock.calls[0][0].where;
    expect(calledWhere.OR).toEqual(expect.arrayContaining([
      { explainedFlowId: 'f1' },
      { explainedExternalLineId: 'x-new' },
    ]));
    expect(prisma.reconciliationDisposition.create).not.toHaveBeenCalled();
  });
  it('both anchors missing → 400; case not OPEN → 400', async () => {
    const { svc } = build();
    await expect(svc.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(/anchored/);
    const closed = build({ reconciliationCase: { findUnique: jest.fn().mockResolvedValue({ ...CASE_ROW, status: 'RESOLVED' }) } });
    await expect(closed.svc.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1', causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(/open/i);
  });
});

// 写端翻转（Task 3）：财务先选处置，record() 按矩阵（这一格允许哪些处置）+ 码（该码是否
// 归属所选处置）两道校验，出口 = outletOf(disposition)，不再单靠成因反推。
describe('DispositionService.record — disposition matrix (Task 3: write-side flip)', () => {
  // AMOUNT_MISMATCH × CLIENT（CASE_ROW.book='CUSTOMER'→CLIENT）：矩阵只放行 CORRECT
  // （dispositionsFor 对这一格的 REVERSE 恒不放行——REVERSE 在这一格只对 FIRM 账簿开放）。
  const baseDto = {
    caseNo: 'REC-1', matchType: 'AMOUNT_MISMATCH' as const,
    explainedFlowId: 'f1', explainedExternalLineId: 'e1',
    findingNote: 'Investigated against the bank receipt', internalSourceType: 'DEPOSIT',
  };

  it('矩阵外处置拒 400：金额不对×客户 选 REVERSE', async () => {
    const { svc } = build();
    await expect(svc.record({ ...baseDto, causeCode: 'AMT_MISBOOKED', disposition: 'REVERSE' } as any, ACTOR))
      .rejects.toThrow(/not available for this line/);
  });
  it('码不配处置拒 400：CORRECT 配 DUP_BOOKING', async () => {
    const { svc } = build();
    await expect(svc.record({ ...baseDto, causeCode: 'DUP_BOOKING', disposition: 'CORRECT' } as any, ACTOR))
      .rejects.toThrow(/does not belong/);
  });
  it('合法组合落库：outlet=outletOf(disposition)，审计 RECON_DISPOSITION_RECORDED 带 requestId', async () => {
    const { svc, prisma, audit } = build();
    await svc.record({ ...baseDto, causeCode: 'AMT_FEE_NETTED', disposition: 'CORRECT' } as any, ACTOR);
    expect(prisma.reconciliationDisposition.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outlet: 'ADJUST_CORRECT' }) }));
    // recordByActor(envelope, actorContext) 是两参签名（同文件既有写点，见 :106 一带）——
    // 加 expect.anything() 补第二参，避免 toHaveBeenCalledWith 因参数个数不齐而误判。
    expect(audit.recordByActor).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECON_DISPOSITION_RECORDED', requestId: expect.any(String) }), expect.anything());
  });
});

describe('DispositionService.linkAdjustment', () => {
  it('only accepts findings with an ADJUST-family outlet that are not yet linked', async () => {
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

describe('Recon batch A: allowed finding-link combinations (spec §3.6)', () => {
  const held = { dispositionNo: 'RCD001', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null };
  const buildLink = (row: any) => {
    const prisma: any = {
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({ ...row, adjustmentNo: 'ADJ_WO' }),
      },
    };
    return { svc: new DispositionService(prisma, { recordByActor: jest.fn() } as any), prisma };
  };
  it('Hold · Investigating + write-off family → link allowed', async () => {
    const { svc, prisma } = buildLink(held);
    await svc.linkAdjustment('RCD001', 'ADJ_WO', { family: 'WRITE_OFF' });
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({ where: { dispositionNo: 'RCD001' }, data: { adjustmentNo: 'ADJ_WO' } });
  });
  it('Hold · Investigating + any other family → still rejected ("does not route to an adjustment")', async () => {
    const { svc } = buildLink(held);
    await expect(svc.linkAdjustment('RCD001', 'ADJ_X', { family: 'CORRECT' })).rejects.toThrow(BadRequestException);
    await expect(svc.linkAdjustment('RCD001', 'ADJ_X')).rejects.toThrow(BadRequestException);
  });
});

// Recon wave 3 (Task 10) review Fix 1 (Critical): linkAdjustment's outlet allowlist originally
// only recognized HOLD_INVESTIGATING+WRITE_OFF, so the incident path (outlet='INCIDENT') always
// hit 400 when linking back after the adjustment was opened, orphaning the already-persisted DRAFT
// adjustment (the finding line never got linked, yet it could still be submitted for approval).
// With the matching branch added, this group locks down four edge cases: incident path allowed,
// incident path with no family still rejected, other outlets not accidentally allowed by this
// change, and an incident-path line that is already linked rejects linking again.
describe('Recon wave 3 Task 10 review Fix 1: linkAdjustment allowlist now includes INCIDENT', () => {
  const heldIncident = { dispositionNo: 'RCD-INC-1', outlet: 'INCIDENT', adjustmentNo: null };
  const buildLink = (row: any) => {
    const prisma: any = {
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({ ...row, adjustmentNo: 'ADJ_INC' }),
      },
    };
    return { svc: new DispositionService(prisma, { recordByActor: jest.fn() } as any), prisma };
  };
  it('Incident · Pending + write-off family → link allowed (previously always 400, blocking loss-recognition adjustments on the incident path)', async () => {
    const { svc, prisma } = buildLink(heldIncident);
    await svc.linkAdjustment('RCD-INC-1', 'ADJ_INC', { family: 'WRITE_OFF' });
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD-INC-1' }, data: { adjustmentNo: 'ADJ_INC' },
    });
  });
  it('Incident · Pending + no family / any other family → still rejected', async () => {
    const { svc } = buildLink(heldIncident);
    await expect(svc.linkAdjustment('RCD-INC-1', 'ADJ_X')).rejects.toThrow(BadRequestException);
    await expect(svc.linkAdjustment('RCD-INC-1', 'ADJ_X', { family: 'CORRECT' })).rejects.toThrow(BadRequestException);
  });
  it('an outlet that is neither ADJUST-family nor HOLD_INVESTIGATING/INCIDENT → write-off family still rejected (allowlist was not loosened by accident)', async () => {
    const { svc } = buildLink({ dispositionNo: 'RCD-DEF-1', outlet: 'DEFERRED', adjustmentNo: null });
    await expect(svc.linkAdjustment('RCD-DEF-1', 'ADJ_X', { family: 'WRITE_OFF' })).rejects.toThrow(BadRequestException);
  });
  it('an incident-path line already linked to an adjustment → rejects linking again (400, the new branch does not bypass the link lock)', async () => {
    const { svc } = buildLink({ ...heldIncident, adjustmentNo: 'ADJ_OLD' });
    await expect(svc.linkAdjustment('RCD-INC-1', 'ADJ_NEW', { family: 'WRITE_OFF' })).rejects.toThrow(/already linked to adjustment ADJ_OLD/);
  });
});

describe('Recon batch B: supplementNo link-back and overwrite lock', () => {
  it('linkSupplement: outlet not SUPPLEMENT or target mismatch → 400; already linked → 400; normal write succeeds', async () => {
    const { svc: service, prisma } = build();
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', outlet: 'HOLD_INVESTIGATING', deferredTarget: null, supplementNo: null });
    await expect(service.linkSupplement('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT')).rejects.toThrow(/does not accept/);
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_DEPOSIT', supplementNo: 'SIG0' });
    await expect(service.linkSupplement('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT')).rejects.toThrow(/already linked to supplement/);
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_DEPOSIT', supplementNo: null });
    await service.linkSupplement('RCD1', 'SIG1', 'SUPPLEMENT_DEPOSIT');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({ where: { dispositionNo: 'RCD1' }, data: { supplementNo: 'SIG1' } });
  });
  it('record: a finding already linked to a supplement cannot be overwritten', async () => {
    // Follows this file's existing record() mock setup, just swaps `existing` for a row carrying a supplementNo
    const { svc: service } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue({ dispositionNo: 'RCD1', adjustmentNo: null, supplementNo: 'SIG1' }),
      },
    });
    await expect(service.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', disposition: 'REVERSE', findingNote: 'x', internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ACTOR)).rejects.toThrow(/already linked to supplement/);
  });
  it('unlinkSupplement: leaves the row untouched if the linked value is not the expected one', async () => {
    const { svc: service, prisma } = build();
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ dispositionNo: 'RCD1', supplementNo: 'DEP9' });
    await service.unlinkSupplement('RCD1', 'SIG1');
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });
});

// 终审修复批 Item 1：调账驳回/取消/超时清锁——镜像 unlinkSupplement。挂着的定性行
// 按 adjustmentNo 反查（无唯一索引，可能查不到），清空该列后行解锁；定性本体
// （causeCode/findingNote/outlet）原样保留。先红：unlinkAdjustment 补上前这三条
// 断言（尤其第三条 acceptance ②）都会失败。
describe('DispositionService.unlinkAdjustment (终审修复批 Item 1: reject/cancel/timeout clears the lock)', () => {
  it('finds the row by adjustmentNo and clears only that column — causeCode/findingNote/outlet stay untouched', async () => {
    const row = { dispositionNo: 'RCD-REJ-1', adjustmentNo: 'ADJ_REJ_1', causeCode: 'DUP_BOOKING', findingNote: 'twin entry confirmed', outlet: 'ADJUST_REVERSE' };
    const prisma: any = {
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({ ...row, adjustmentNo: null }),
      },
    };
    const svc = new DispositionService(prisma, { recordByActor: jest.fn() } as any);
    await svc.unlinkAdjustment('ADJ_REJ_1');
    expect(prisma.reconciliationDisposition.findFirst).toHaveBeenCalledWith({ where: { adjustmentNo: 'ADJ_REJ_1' } });
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD-REJ-1' }, data: { adjustmentNo: null },
    });
  });

  it('no disposition row is linked to this adjustment (e.g. a plain adjustment that never went through record()) — no-op, no write', async () => {
    const prisma: any = {
      reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    const svc = new DispositionService(prisma, { recordByActor: jest.fn() } as any);
    await svc.unlinkAdjustment('ADJ_NONE');
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });

  it('acceptance ②: after unlink, the same anchor can record() again without hitting "already linked to adjustment" (400)', async () => {
    // Simulates the post-unlinkAdjustment row state: adjustmentNo is already null —
    // record()'s lock check (existing?.adjustmentNo) must let a re-finding through.
    const { svc, prisma } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue({ dispositionNo: 'RCD-REJ-1', adjustmentNo: null, supplementNo: null }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ dispositionNo: 'RCD-REJ-1', ...data })),
        create: jest.fn(),
      },
    });
    const r = await svc.record({
      caseNo: 'REC-1', matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', disposition: 'REVERSE', findingNote: 'reopened after rejection', internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ACTOR);
    expect(r.dispositionNo).toBe('RCD-REJ-1');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalled();
  });
});

// Recon wave 3 (Task 9): three behavioral tests migrated from the placeholder
// InterimDispositionIncidentLink class in incidents.module.ts — the placeholder class was
// deleted, and the behavior is locked here as-is (404/409/writes only the incidentNo column).
describe('DispositionService.attachIncident (recon wave 3: incident registration link-back, principle ③ — a subject writes only its own table)', () => {
  it('finding line not found → 404, update not called', async () => {
    const { svc, prisma } = build({
      reconciliationDisposition: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    });
    await expect(svc.attachIncident('RCD1', 'INC1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.attachIncident('RCD1', 'INC1')).rejects.toThrow(/Finding line not found: RCD1/);
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });

  it('finding line already linked to an incident → 409, update not called', async () => {
    const { svc, prisma } = build({
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue({ dispositionNo: 'RCD1', incidentNo: 'INC0' }),
        update: jest.fn(),
      },
    });
    await expect(svc.attachIncident('RCD1', 'INC1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.attachIncident('RCD1', 'INC1')).rejects.toThrow(/Finding line RCD1 is already linked to incident INC0 — cannot link another/);
    expect(prisma.reconciliationDisposition.update).not.toHaveBeenCalled();
  });

  it('happy path: update writes only the incidentNo column', async () => {
    const { svc, prisma } = build({
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue({ dispositionNo: 'RCD1', incidentNo: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    await svc.attachIncident('RCD1', 'INC1');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD1' },
      data: { incidentNo: 'INC1' },
    });
  });
});
