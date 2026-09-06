import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { IncidentStatus as S, IncidentTypes as T, INCIDENT_REPORT_BASES as REPORT_BASES } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeService(o: Partial<Record<'incidentRow' | 'disposition' | 'kase' | 'transfer' | 'adjustment' | 'adjustments' | 'deposit' | 'remediations' | 'notes' | 'listRows' | 'listTotal' | 'wallet', any>> = {}) {
  const incidentRow = o.incidentRow ?? {
    id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.REGISTERED,
    title: 't', description: 'd', customerNo: null, sourceCaseNo: null, traceId: 'trace-seed',
  };
  const prisma: any = {
    incident: {
      create: jest.fn(async ({ data }: any) => ({ ...incidentRow, ...data })),
      findUnique: jest.fn(async () => incidentRow),
      update: jest.fn(async ({ data }: any) => ({ ...incidentRow, ...data })),
      findMany: jest.fn(async () => o.listRows ?? [incidentRow]),
      count: jest.fn(async () => o.listTotal ?? (o.listRows ?? [incidentRow]).length),
    },
    incidentNote: {
      create: jest.fn(async ({ data }: any) => ({ id: 'note-1', ...data })),
      findMany: jest.fn(async () => o.notes ?? []),
    },
    incidentRemediation: {
      create: jest.fn(async ({ data }: any) => ({ id: 'rem-1', ...data })),
      findMany: jest.fn(async () => o.remediations ?? []),
    },
    reconciliationDisposition: { findUnique: jest.fn(async () => o.disposition ?? null) },
    reconciliationCase: { findUnique: jest.fn(async () => o.kase ?? null) },
    internalTransfer: { findUnique: jest.fn(async () => o.transfer ?? null) },
    reconciliationAdjustment: {
      findUnique: jest.fn(async () => o.adjustment ?? null),
      findMany: jest.fn(async () => o.adjustments ?? []),
    },
    depositTransaction: { findUnique: jest.fn(async () => o.deposit ?? null) },
    wallet: { findUnique: jest.fn(async () => o.wallet ?? null) },
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
  const svc = new IncidentService(prisma, auditLogs);
  return { svc, prisma, auditLogs, incidentRow };
}

describe('IncidentService（平账三期 Task 5）', () => {
  describe('显式迁移表', () => {
    it.each([
      [S.REGISTERED, S.INVESTIGATING], [S.REGISTERED, S.WITHDRAWN],
      [S.INVESTIGATING, S.ASSESSED],
      [S.ASSESSED, S.RESOLVING], [S.ASSESSED, S.CLOSED],
      [S.RESOLVING, S.CLOSED],
    ])('%s → %s 放行', (from, to) => {
      const { svc } = makeService();
      expect(() => svc.assertTransition(from, to)).not.toThrow();
    });

    it.each([
      [S.REGISTERED, S.CLOSED], [S.REGISTERED, S.ASSESSED], [S.REGISTERED, S.RESOLVING],
      [S.INVESTIGATING, S.WITHDRAWN], [S.INVESTIGATING, S.RESOLVING],
      [S.CLOSED, S.REGISTERED], [S.WITHDRAWN, S.REGISTERED],
    ])('%s → %s 拒（非法跃迁 400）', (from, to) => {
      const { svc } = makeService();
      expect(() => svc.assertTransition(from, to)).toThrow(/非法状态迁移/);
    });
  });

  describe('register —— MANUAL', () => {
    it('缺 title/description → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.MANUAL, title: '', description: 'd' } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('正路径：生成 INC 单号、REGISTERED、审计 type 顶层 + correlationId=traceId', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.register({ type: T.MANUAL, title: '服务中断', description: '托管方安全通告' }, ops);
      expect(r.incidentNo).toMatch(/^INC\d+/);
      expect(prisma.incident.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: T.MANUAL, status: S.REGISTERED, title: '服务中断', description: '托管方安全通告' }),
      }));
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REGISTERED', actionDomain: 'GOVERNANCE', type: T.MANUAL, correlationId: r.traceId });
      expect(call.requestId).toMatch(/^INCIDENT_REGISTERED_/);
    });
  });

  describe('register —— UNAUTHORIZED_OUTFLOW', () => {
    it('缺 sourceCaseNo/sourceDispositionNo → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd' }, ops)).rejects.toThrow(/来源案号与定性行号/);
    });
    it('定性行不存在 → 404', async () => {
      const { svc } = makeService({ disposition: null });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('定性行 outlet 不是 INCIDENT → 400', async () => {
      const { svc } = makeService({ disposition: { outlet: 'DEFERRED', causeCode: 'UNAUTHORIZED_OUTFLOW', incidentNo: null } });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/不是未授权转出定性/);
    });
    it('定性行 causeCode 不是 UNAUTHORIZED_OUTFLOW → 400', async () => {
      const { svc } = makeService({ disposition: { outlet: 'INCIDENT', causeCode: 'SOMETHING_ELSE', incidentNo: null } });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/不是未授权转出定性/);
    });
    it('定性行 incidentNo 已占用 → 400（防一行两事故）', async () => {
      const { svc } = makeService({ disposition: { outlet: 'INCIDENT', causeCode: 'UNAUTHORIZED_OUTFLOW', incidentNo: 'INC0' } });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/一行两事故/);
    });
    it('正路径：放行，不在本方法内写回定性行（铁律③留给 workflow）', async () => {
      const { svc, prisma } = makeService({ disposition: { outlet: 'INCIDENT', causeCode: 'UNAUTHORIZED_OUTFLOW', incidentNo: null } });
      const r = await svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
      expect(prisma.reconciliationDisposition.update).toBeUndefined(); // 压根没 mock update——服务不许调它
    });
  });

  describe('register —— LARGE_UNEXPLAINED', () => {
    it('缺 sourceCaseNo → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd' }, ops)).rejects.toThrow(/来源案号/);
    });
    it('案子不存在 → 404', async () => {
      const { svc } = makeService({ kase: null });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('案子 slaBreached=false → 400（够不上升级）', async () => {
      const { svc } = makeService({ kase: { caseNo: 'REC2', slaBreached: false } });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2' }, ops)).rejects.toThrow(/账龄线/);
    });
    it('正路径：slaBreached=true 放行', async () => {
      const { svc } = makeService({ kase: { caseNo: 'REC2', slaBreached: true } });
      const r = await svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });
  });

  describe('register —— CLIENT_SHORTFALL', () => {
    it('缺 customerNo/amount → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd' }, ops)).rejects.toThrow(/客户号与金额/);
    });
    it('带垫款单号但单不存在 → 404', async () => {
      const { svc } = makeService({ transfer: null });
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900', sourceAdvanceTransferNo: 'ITR9' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('垫款单 purpose 不是 CLIENT_ADVANCE → 400', async () => {
      const { svc } = makeService({ transfer: { transferNo: 'ITR9', purpose: 'CLIENT_COMPENSATION' } });
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900', sourceAdvanceTransferNo: 'ITR9' }, ops)).rejects.toThrow(/不是垫款单/);
    });
    it('正路径：不带垫款单号也能登记（欠款可先无锚）', async () => {
      const { svc } = makeService();
      const r = await svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });
    it('正路径：带合法垫款单号锚定', async () => {
      const { svc } = makeService({ transfer: { transferNo: 'ITR9', purpose: 'CLIENT_ADVANCE' } });
      const r = await svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900', sourceAdvanceTransferNo: 'ITR9' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });
  });

  describe('startInvestigation', () => {
    it('REGISTERED → INVESTIGATING + 审计 fromStatus/toStatus 顶层', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.startInvestigation('INC1', ops);
      expect(r.status).toBe(S.INVESTIGATING);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({ where: { incidentNo: 'INC1' }, data: expect.objectContaining({ status: S.INVESTIGATING }) }));
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_INVESTIGATION_STARTED', fromStatus: S.REGISTERED, toStatus: S.INVESTIGATING });
      expect(call.requestId).toMatch(/^INCIDENT_INVESTIGATION_STARTED_INC1_/);
    });
    it('非 REGISTERED 起手 → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.WITHDRAWN } });
      await expect(svc.startInvestigation('INC1', ops)).rejects.toThrow(/非法状态迁移/);
    });
  });

  describe('addNote', () => {
    it('落 IncidentNote{kind:NOTE} + 审计 body 顶层', async () => {
      const { svc, prisma, auditLogs } = makeService();
      await svc.addNote('INC1', '查托管流水，未见异常', ops);
      expect(prisma.incidentNote.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'NOTE', body: '查托管流水，未见异常' }) });
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_NOTE_ADDED', body: '查托管流水，未见异常' });
    });
    it('空内容 → 400', async () => {
      const { svc } = makeService();
      await expect(svc.addNote('INC1', '', ops)).rejects.toThrow(BadRequestException);
    });
  });

  describe('escalate', () => {
    it('落 IncidentNote{kind:ESCALATION,escalatedTo} + 审计 escalatedTo 顶层与 metadata', async () => {
      const { svc, prisma, auditLogs } = makeService();
      await svc.escalate('INC1', { to: 'MLRO', note: '升级给 MLRO 定性' }, ops);
      expect(prisma.incidentNote.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'ESCALATION', escalatedTo: 'MLRO', body: '升级给 MLRO 定性' }) });
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_ESCALATED', escalatedTo: 'MLRO' });
      expect(call.metadata).toMatchObject({ escalatedTo: 'MLRO' });
    });
  });

  describe('withdraw', () => {
    it('必填 reason', async () => {
      const { svc } = makeService();
      await expect(svc.withdraw('INC1', '', ops)).rejects.toThrow(BadRequestException);
    });
    it('只许从 REGISTERED', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING } });
      await expect(svc.withdraw('INC1', '误登记', ops)).rejects.toThrow(/非法状态迁移/);
    });
    it('正路径：REGISTERED → WITHDRAWN + withdrawnReason 落库 + 审计 reason 顶层', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.withdraw('INC1', '误登记，重复案子', ops);
      expect(r.status).toBe(S.WITHDRAWN);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: S.WITHDRAWN, withdrawnReason: '误登记，重复案子' }) }));
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_WITHDRAWN', reason: '误登记，重复案子' });
    });
  });

  describe('linkRemediation —— 校验 referenceNo 在对应域存在（状态须 ASSESSED/RESOLVING，见下方 Task 7 守卫用例）', () => {
    it('ADJUSTMENT 不存在 → 404', async () => {
      const { svc } = makeService({ adjustment: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('TRANSFER 不存在 → 404', async () => {
      const { svc } = makeService({ transfer: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'TRANSFER', referenceNo: 'ITR1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('SUPPLEMENT 不存在 → 404', async () => {
      const { svc } = makeService({ deposit: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'SUPPLEMENT', referenceNo: 'DEP1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('CLAIM 不存在 → 404', async () => {
      const { svc } = makeService({ deposit: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'CLAIM', referenceNo: 'DEP2' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('正路径：ADJUSTMENT 存在 → 挂载 + 审计 referenceNo 顶层', async () => {
      const { svc, prisma, auditLogs } = makeService({ adjustment: { adjustmentNo: 'ADJ1' }, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING } });
      await svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }) });
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'ADJ1' });
    });
  });

  describe('linkRemediation —— 挂载状态守卫 + 迁移承载（Task 7 裁决修复：ASSESSED→RESOLVING 无处触发的缺口）', () => {
    it('ASSESSED 状态挂载 → 状态推到 RESOLVING + 挂载成功 + 审计 metadata.statusAdvanced', async () => {
      const { svc, prisma, auditLogs } = makeService({
        adjustment: { adjustmentNo: 'ADJ1' },
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED },
      });
      await svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { incidentNo: 'INC1' }, data: expect.objectContaining({ status: S.RESOLVING }),
      }));
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }) });
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'ADJ1', fromStatus: S.ASSESSED, toStatus: S.RESOLVING });
      expect(call.metadata).toMatchObject({ statusAdvanced: 'ASSESSED→RESOLVING' });
    });

    it('RESOLVING 状态挂载 → 状态不动、纯追加，审计 metadata 不带 statusAdvanced', async () => {
      const { svc, prisma, auditLogs } = makeService({
        transfer: { transferNo: 'ITR1' },
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING },
      });
      await svc.linkRemediation('INC1', { kind: 'TRANSFER', referenceNo: 'ITR1' }, ops);
      expect(prisma.incident.update).not.toHaveBeenCalled();
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'TRANSFER', referenceNo: 'ITR1' }) });
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'ITR1' });
      expect(call.metadata?.statusAdvanced).toBeUndefined();
      expect(call.fromStatus).toBeUndefined();
      expect(call.toStatus).toBeUndefined();
    });

    it('REGISTERED 状态挂载 → 400（还没定损，善后单挂不上）', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.REGISTERED } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
    });

    it('INVESTIGATING 状态挂载 → 400（还没定损，善后单挂不上）', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
    });
  });

  describe('每个动作一条审计（recordByActor + 显式 requestId）', () => {
    it('register/startInvestigation/addNote/escalate/withdraw/linkRemediation 各只调一次 recordByActor', async () => {
      const { svc: s1, auditLogs: a1 } = makeService();
      await s1.register({ type: T.MANUAL, title: 't', description: 'd' }, ops);
      expect(a1.recordByActor).toHaveBeenCalledTimes(1);

      const { svc: s2, auditLogs: a2 } = makeService();
      await s2.startInvestigation('INC1', ops);
      expect(a2.recordByActor).toHaveBeenCalledTimes(1);

      const { svc: s3, auditLogs: a3 } = makeService();
      await s3.addNote('INC1', 'x', ops);
      expect(a3.recordByActor).toHaveBeenCalledTimes(1);

      const { svc: s4, auditLogs: a4 } = makeService();
      await s4.escalate('INC1', { to: 'CFO', note: 'x' }, ops);
      expect(a4.recordByActor).toHaveBeenCalledTimes(1);

      const { svc: s5, auditLogs: a5 } = makeService();
      await s5.withdraw('INC1', 'x', ops);
      expect(a5.recordByActor).toHaveBeenCalledTimes(1);

      const { svc: s6, auditLogs: a6 } = makeService({
        adjustment: { adjustmentNo: 'ADJ1' },
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED },
      });
      await s6.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(a6.recordByActor).toHaveBeenCalledTimes(1);
    });
  });

  describe('INCIDENT_REPORT_BASES —— 依据条款目录（数字来源监管条款一手核，不得改动）', () => {
    it('TIR_K_H 有 72h 法定钟，两条 CRM 依据无钟（hours=null）', () => {
      expect(REPORT_BASES.TIR_K_H.hours).toBe(72);
      expect(REPORT_BASES.CRM_IV_E_5.hours).toBeNull();
      expect(REPORT_BASES.CRM_V_D_2.hours).toBeNull();
      expect(Object.keys(REPORT_BASES)).toEqual(['TIR_K_H', 'CRM_IV_E_5', 'CRM_V_D_2']);
    });
  });

  describe('assess —— 定损 + 依据码 + 72h 倒计时（Task 6）', () => {
    it('只许从 INVESTIGATING（400）', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.REGISTERED, createdAt: new Date('2026-09-01T00:00:00.000Z') } });
      await expect(svc.assess('INC1', { assessedAmount: '100', assessmentBasis: 'NO_LOSS', reportRequired: false }, ops)).rejects.toThrow(/非法状态迁移/);
    });

    it('缺 assessedAmount/assessmentBasis → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '', assessmentBasis: 'NO_LOSS', reportRequired: false } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportRequired=true 但 reportBasisCodes 为空 → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: [] }, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportBasisCodes 含目录外的码 → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: ['NOT_A_BASIS'] }, ops)).rejects.toThrow(BadRequestException);
    });

    it('正路径：单选 TIR_K_H → reportDeadlineAt = createdAt + 72h（变异靶子②）+ 审计顶层 assessmentBasis', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt } });
      const r = await svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: ['TIR_K_H'] }, ops);
      expect(r.status).toBe(S.ASSESSED);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(S.ASSESSED);
      expect(updateCall.data.reportDeadlineAt.getTime()).toBe(createdAt.getTime() + 72 * 3600 * 1000);
      expect(r.reportDeadlineAt!.getTime()).toBe(createdAt.getTime() + 72 * 3600 * 1000);
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_ASSESSED', assessmentBasis: 'FIRM_LOSS', fromStatus: S.INVESTIGATING, toStatus: S.ASSESSED });
    });

    it('只选无钟依据（CRM_IV_E_5）→ reportDeadlineAt 保持 null（不杜撰时限）', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt } });
      await svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'CLIENT_COLLECTION', reportRequired: true, reportBasisCodes: ['CRM_IV_E_5'] }, ops);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportDeadlineAt).toBeNull();
    });

    it('reportRequired=false → reportBasisCodes/reportDeadlineAt 均落 null', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await svc.assess('INC1', { assessedAmount: '0', assessmentBasis: 'RECOVERED', reportRequired: false }, ops);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportRequired).toBe(false);
      expect(updateCall.data.reportBasisCodes).toBeNull();
      expect(updateCall.data.reportDeadlineAt).toBeNull();
    });
  });

  describe('saveReportDraft —— 首次记草案审计，再次只更新草案（spec 已核结论）', () => {
    it('首次落草案：reportDraftedAt + 审计 INCIDENT_REGULATOR_REPORT_DRAFTED', async () => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportDraft: null } });
      await svc.saveReportDraft('INC1', '通报稿 v1', ops);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { incidentNo: 'INC1' },
        data: expect.objectContaining({ reportDraft: '通报稿 v1', reportDraftedAt: expect.any(Date) }),
      }));
      expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_REGULATOR_REPORT_DRAFTED' });
    });

    it('再次保存：只更新草案字段，不再记该审计码', async () => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportDraft: '已有草案' } });
      await svc.saveReportDraft('INC1', '通报稿 v2', ops);
      expect(prisma.incident.update).toHaveBeenCalledWith({ where: { incidentNo: 'INC1' }, data: { reportDraft: '通报稿 v2' } });
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });
  });

  describe('markReported —— 前置 reportRequired && reportDraft 非空', () => {
    it('reportRequired=false → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportRequired: false, reportDraft: '稿' } });
      await expect(svc.markReported('INC1', {}, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportDraft 为空 → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportRequired: true, reportDraft: null } });
      await expect(svc.markReported('INC1', {}, ops)).rejects.toThrow(BadRequestException);
    });

    it('正路径：落 reportedAt/reportedByUserId/reportReference + 审计 metadata.basisCodes', async () => {
      const { svc, prisma, auditLogs } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportRequired: true, reportDraft: '稿', reportBasisCodes: 'TIR_K_H' },
      });
      await svc.markReported('INC1', { reference: 'VARA-2026-001' }, ops);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { incidentNo: 'INC1' },
        data: expect.objectContaining({ reportedAt: expect.any(Date), reportedByUserId: 'ADM-OPS', reportReference: 'VARA-2026-001' }),
      }));
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REGULATOR_REPORTED', basisCodes: 'TIR_K_H' });
      expect(call.metadata).toMatchObject({ basisCodes: 'TIR_K_H' });
    });
  });

  describe('结案支持方法（Task 7）—— 纯数据方法，不审计（workflow 记账）', () => {
    it('findRemediations：返回善后单号清单（只取 referenceNo）', async () => {
      const { svc, prisma } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING },
        remediations: [{ id: 'rem-1', referenceNo: 'ADJ1' }, { id: 'rem-2', referenceNo: 'ITR9' }],
      });
      const refs = await svc.findRemediations('INC1');
      expect(refs).toEqual(['ADJ1', 'ITR9']);
      expect(prisma.incidentRemediation.findMany).toHaveBeenCalledWith({ where: { incidentId: 'uuid-inc' } });
    });

    it('findRemediations：无挂载 → 空数组', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED }, remediations: [] });
      await expect(svc.findRemediations('INC1')).resolves.toEqual([]);
    });

    it('markCloseRequested：只写 approvalNo 一列，不动 status，不审计', async () => {
      const { svc, prisma, auditLogs } = makeService();
      await svc.markCloseRequested('INC1', 'AC1');
      expect(prisma.incident.update).toHaveBeenCalledWith({ where: { incidentNo: 'INC1' }, data: { approvalNo: 'AC1' } });
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('close：ASSESSED → CLOSED + closedAt，不审计', async () => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      const r = await svc.close('INC1');
      expect(r.status).toBe(S.CLOSED);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({ where: { incidentNo: 'INC1' }, data: expect.objectContaining({ status: S.CLOSED, closedAt: expect.any(Date) }) }));
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('close：RESOLVING → CLOSED', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING } });
      const r = await svc.close('INC1');
      expect(r.status).toBe(S.CLOSED);
    });

    it('close：非法来源状态（如 REGISTERED）→ 400（迁移表兜底）', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.REGISTERED } });
      await expect(svc.close('INC1')).rejects.toThrow(/非法状态迁移/);
    });
  });

  describe('list / getView（Task 8：HTTP 层薄转发用的纯投影，铁律⑥零 id）', () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');

    it('list：按 status/type/customerNo/sourceCaseNo 过滤并投影为业务键视图', async () => {
      const row = {
        incidentNo: 'INC1', type: T.MANUAL, status: S.REGISTERED, title: 't',
        customerNo: null, assetCode: null, amount: null, sourceCaseNo: null,
        reportRequired: false, reportedAt: null, reportDeadlineAt: null, createdAt,
      };
      const { svc, prisma } = makeService({ listRows: [row], listTotal: 1 });
      const r = await svc.list({ status: S.REGISTERED, take: 10, skip: 0 });
      expect(r.total).toBe(1);
      expect(r.items).toEqual([{
        incidentNo: 'INC1', type: T.MANUAL, status: S.REGISTERED, title: 't',
        customerNo: null, assetCode: null, amount: null, sourceCaseNo: null,
        reportRequired: false, reportedAt: null, reportDeadlineAt: null, createdAt: createdAt.toISOString(),
      }]);
      expect(prisma.incident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: S.REGISTERED }, skip: 0, take: 10 }));
      expect((prisma.incident.findMany.mock.calls[0][0] as any).where).not.toHaveProperty('id');
    });

    it('getView：主体字段 + notes + remediations，零 id/incidentId', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.INVESTIGATING,
        title: 't', description: 'd', customerNo: null, sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, walletRef: null, assetCode: null, amount: null,
        assessedAmount: null, assessmentBasis: null, reportRequired: false, reportBasisCodes: null,
        reportDeadlineAt: null, reportDraft: null, reportDraftedAt: null, reportedAt: null,
        reportReference: null, approvalNo: null, registeredByUserId: 'ADM-OPS',
        closedAt: null, withdrawnReason: null, createdAt,
      };
      const notes = [{ kind: 'NOTE', escalatedTo: null, body: '记录一条', authorUserId: 'ADM-OPS', createdAt }];
      const remediations = [{ kind: 'ADJUSTMENT', referenceNo: 'ADJ1', linkedByUserId: 'ADM-OPS', createdAt }];
      const adjustments = [{ adjustmentNo: 'ADJ1', status: 'POSTED' }];
      const { svc } = makeService({ incidentRow, notes, remediations, adjustments });
      const view = await svc.getView('INC1');
      expect(view.incidentNo).toBe('INC1');
      expect(view.notes).toEqual([{ kind: 'NOTE', escalatedTo: null, body: '记录一条', authorBy: 'ADM-OPS', createdAt: createdAt.toISOString() }]);
      // Task 12：ADJUSTMENT 善后单要带上调账单现状——事故页「发起补款」按钮据此判断
      // 「已落账（POSTED）」，remediations 表本身不存这个会过期的状态快照。
      expect(view.remediations).toEqual([{ kind: 'ADJUSTMENT', referenceNo: 'ADJ1', linkedBy: 'ADM-OPS', createdAt: createdAt.toISOString(), status: 'POSTED' }]);
      expect(view).not.toHaveProperty('id');
      expect(JSON.stringify(view)).not.toContain('uuid-inc');
    });

    it('getView：非 ADJUSTMENT 善后单不查调账单状态，status 恒 null', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING,
        title: 't', description: 'd', customerNo: null, sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, walletRef: null, assetCode: null, amount: null,
        assessedAmount: null, assessmentBasis: null, reportRequired: false, reportBasisCodes: null,
        reportDeadlineAt: null, reportDraft: null, reportDraftedAt: null, reportedAt: null,
        reportReference: null, approvalNo: null, registeredByUserId: 'ADM-OPS',
        closedAt: null, withdrawnReason: null, createdAt,
      };
      const remediations = [{ kind: 'TRANSFER', referenceNo: 'ITR1', linkedByUserId: 'ADM-OPS', createdAt }];
      const { svc, prisma } = makeService({ incidentRow, remediations });
      const view = await svc.getView('INC1');
      expect(view.remediations).toEqual([{ kind: 'TRANSFER', referenceNo: 'ITR1', linkedBy: 'ADM-OPS', createdAt: createdAt.toISOString(), status: null }]);
      expect(prisma.reconciliationAdjustment.findMany).not.toHaveBeenCalled();
    });

    it('getView：事故不存在 → 404', async () => {
      const { svc, prisma } = makeService();
      prisma.incident.findUnique.mockResolvedValueOnce(null);
      await expect(svc.getView('NOPE')).rejects.toThrow(NotFoundException);
    });

    it('getView：walletRef 非空（UUID 形状）→ 翻译成 walletNo 业务键，输出零 UUID（铁律⑥评审修复）', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING,
        title: 't', description: 'd', customerNo: 'CU1', sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, walletRef: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', assetCode: 'USDT', amount: null,
        assessedAmount: null, assessmentBasis: null, reportRequired: false, reportBasisCodes: null,
        reportDeadlineAt: null, reportDraft: null, reportDraftedAt: null, reportedAt: null,
        reportReference: null, approvalNo: null, registeredByUserId: 'ADM-OPS',
        closedAt: null, withdrawnReason: null, createdAt,
      };
      const { svc, prisma } = makeService({ incidentRow, wallet: { walletNo: 'W-000123' } });
      const view = await svc.getView('INC1') as any;
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({ where: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, select: { walletNo: true } });
      expect(view.walletNo).toBe('W-000123');
      expect(view).not.toHaveProperty('walletRef');
      expect(JSON.stringify(view)).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });
  });
});
