import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { IncidentStatus as S, IncidentTypes as T } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeService(o: Partial<Record<'incidentRow' | 'disposition' | 'kase' | 'transfer' | 'adjustment' | 'deposit', any>> = {}) {
  const incidentRow = o.incidentRow ?? {
    id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.REGISTERED,
    title: 't', description: 'd', customerNo: null, sourceCaseNo: null, traceId: 'trace-seed',
  };
  const prisma: any = {
    incident: {
      create: jest.fn(async ({ data }: any) => ({ ...incidentRow, ...data })),
      findUnique: jest.fn(async () => incidentRow),
      update: jest.fn(async ({ data }: any) => ({ ...incidentRow, ...data })),
    },
    incidentNote: { create: jest.fn(async ({ data }: any) => ({ id: 'note-1', ...data })) },
    incidentRemediation: { create: jest.fn(async ({ data }: any) => ({ id: 'rem-1', ...data })) },
    reconciliationDisposition: { findUnique: jest.fn(async () => o.disposition ?? null) },
    reconciliationCase: { findUnique: jest.fn(async () => o.kase ?? null) },
    internalTransfer: { findUnique: jest.fn(async () => o.transfer ?? null) },
    reconciliationAdjustment: { findUnique: jest.fn(async () => o.adjustment ?? null) },
    depositTransaction: { findUnique: jest.fn(async () => o.deposit ?? null) },
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

  describe('linkRemediation —— 校验 referenceNo 在对应域存在', () => {
    it('ADJUSTMENT 不存在 → 404', async () => {
      const { svc } = makeService({ adjustment: null });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('TRANSFER 不存在 → 404', async () => {
      const { svc } = makeService({ transfer: null });
      await expect(svc.linkRemediation('INC1', { kind: 'TRANSFER', referenceNo: 'ITR1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('SUPPLEMENT 不存在 → 404', async () => {
      const { svc } = makeService({ deposit: null });
      await expect(svc.linkRemediation('INC1', { kind: 'SUPPLEMENT', referenceNo: 'DEP1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('CLAIM 不存在 → 404', async () => {
      const { svc } = makeService({ deposit: null });
      await expect(svc.linkRemediation('INC1', { kind: 'CLAIM', referenceNo: 'DEP2' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('正路径：ADJUSTMENT 存在 → 挂载 + 审计 referenceNo 顶层', async () => {
      const { svc, prisma, auditLogs } = makeService({ adjustment: { adjustmentNo: 'ADJ1' } });
      await svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }) });
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'ADJ1' });
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

      const { svc: s6, auditLogs: a6 } = makeService({ adjustment: { adjustmentNo: 'ADJ1' } });
      await s6.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(a6.recordByActor).toHaveBeenCalledTimes(1);
    });
  });
});
