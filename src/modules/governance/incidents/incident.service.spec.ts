import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { IncidentStatus as S, IncidentTypes as T, INCIDENT_REPORT_BASES as REPORT_BASES } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeService(o: Partial<Record<'incidentRow' | 'disposition' | 'kase' | 'transfer' | 'adjustment' | 'adjustments' | 'deposit' | 'remediations' | 'notes' | 'listRows' | 'listTotal', any>> = {}) {
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
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})) };
  const svc = new IncidentService(prisma, auditLogs);
  return { svc, prisma, auditLogs, incidentRow };
}

describe('IncidentService (Task 5)', () => {
  describe('explicit transition table', () => {
    it.each([
      [S.REGISTERED, S.INVESTIGATING], [S.REGISTERED, S.WITHDRAWN],
      [S.INVESTIGATING, S.ASSESSED],
      [S.ASSESSED, S.RESOLVING], [S.ASSESSED, S.CLOSED],
      [S.RESOLVING, S.CLOSED],
    ])('%s → %s allowed', (from, to) => {
      const { svc } = makeService();
      expect(() => svc.assertTransition(from, to)).not.toThrow();
    });

    it.each([
      [S.REGISTERED, S.CLOSED], [S.REGISTERED, S.ASSESSED], [S.REGISTERED, S.RESOLVING],
      [S.INVESTIGATING, S.WITHDRAWN], [S.INVESTIGATING, S.RESOLVING],
      [S.CLOSED, S.REGISTERED], [S.WITHDRAWN, S.REGISTERED],
    ])('%s → %s rejected (illegal transition, 400)', (from, to) => {
      const { svc } = makeService();
      expect(() => svc.assertTransition(from, to)).toThrow(/Illegal incident status transition/);
    });
  });

  describe('register — MANUAL', () => {
    it('missing title/description → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.MANUAL, title: '', description: 'd' } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('happy path: generates an INC number, REGISTERED, audit type top-level + correlationId=traceId', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.register({ type: T.MANUAL, title: 'Service disruption', description: 'Custodian security notice' }, ops);
      expect(r.incidentNo).toMatch(/^INC\d+/);
      expect(prisma.incident.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: T.MANUAL, status: S.REGISTERED, title: 'Service disruption', description: 'Custodian security notice' }),
      }));
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REGISTERED', actionDomain: 'GOVERNANCE', type: T.MANUAL, correlationId: r.traceId });
      expect(call.requestId).toMatch(/^INCIDENT_REGISTERED_/);
    });
  });

  describe('register — UNAUTHORIZED_OUTFLOW', () => {
    it('missing sourceCaseNo/sourceDispositionNo → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd' }, ops)).rejects.toThrow(/source case number and disposition line number/);
    });
    it('disposition line not found → 404', async () => {
      const { svc } = makeService({ disposition: null });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('disposition line outlet is not INCIDENT → 400', async () => {
      const { svc } = makeService({ disposition: { outlet: 'DEFERRED', causeCode: 'UNAUTHORIZED_OUTFLOW', incidentNo: null } });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/not classified as unauthorized outflow/);
    });
    it('disposition line causeCode is not UNAUTHORIZED_OUTFLOW → 400', async () => {
      const { svc } = makeService({ disposition: { outlet: 'INCIDENT', causeCode: 'SOMETHING_ELSE', incidentNo: null } });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/not classified as unauthorized outflow/);
    });
    it('disposition line incidentNo already taken → 400 (prevents one line carrying two incidents)', async () => {
      const { svc } = makeService({ disposition: { outlet: 'INCIDENT', causeCode: 'UNAUTHORIZED_OUTFLOW', incidentNo: 'INC0' } });
      await expect(svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/one line cannot carry two incidents/);
    });
    it('happy path: allowed, does not write the disposition line back in this method (Rule 3 leaves that to the workflow)', async () => {
      const { svc, prisma } = makeService({ disposition: { outlet: 'INCIDENT', causeCode: 'UNAUTHORIZED_OUTFLOW', incidentNo: null } });
      const r = await svc.register({ type: T.UNAUTHORIZED_OUTFLOW, title: 't', description: 'd', sourceCaseNo: 'REC1', sourceDispositionNo: 'RCD1' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
      expect(prisma.reconciliationDisposition.update).toBeUndefined(); // 压根没 mock update——服务不许调它
    });
  });

  describe('register — LARGE_UNEXPLAINED', () => {
    it('missing sourceCaseNo → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd' }, ops)).rejects.toThrow(/requires a source case number/);
    });
    it('case not found → 404', async () => {
      const { svc } = makeService({ kase: null });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('case slaBreached=false → 400 (does not qualify for escalation)', async () => {
      const { svc } = makeService({ kase: { caseNo: 'REC2', slaBreached: false } });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2' }, ops)).rejects.toThrow(/aging deadline/);
    });
    it('happy path: slaBreached=true allowed', async () => {
      const { svc } = makeService({ kase: { caseNo: 'REC2', slaBreached: true } });
      const r = await svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });

    // 评审修复（C1 挂接链）：assertLargeUnexplained 新增可选行级校验——只在
    // dto.sourceDispositionNo 给了才查；不给则维持上面既有案级用例的行为（零破坏）。
    it('sourceDispositionNo given but not found → 404', async () => {
      const { svc } = makeService({ kase: { caseNo: 'REC2', slaBreached: true }, disposition: null });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2', sourceDispositionNo: 'RCD1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('sourceDispositionNo given but the line belongs to a different case → 400', async () => {
      const { svc } = makeService({
        kase: { caseNo: 'REC2', slaBreached: true },
        disposition: { dispositionNo: 'RCD1', caseNo: 'REC-OTHER', outlet: 'HOLD_INVESTIGATING' },
      });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/does not belong to case/);
    });
    it('sourceDispositionNo given but outlet is not HOLD_INVESTIGATING → 400', async () => {
      const { svc } = makeService({
        kase: { caseNo: 'REC2', slaBreached: true },
        disposition: { dispositionNo: 'RCD1', caseNo: 'REC2', outlet: 'DEFERRED' },
      });
      await expect(svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2', sourceDispositionNo: 'RCD1' }, ops)).rejects.toThrow(/not classified as "Hold · Investigating"/);
    });
    it('happy path with sourceDispositionNo: line belongs to the case and outlet=HOLD_INVESTIGATING → allowed', async () => {
      const { svc } = makeService({
        kase: { caseNo: 'REC2', slaBreached: true },
        disposition: { dispositionNo: 'RCD1', caseNo: 'REC2', outlet: 'HOLD_INVESTIGATING' },
      });
      const r = await svc.register({ type: T.LARGE_UNEXPLAINED, title: 't', description: 'd', sourceCaseNo: 'REC2', sourceDispositionNo: 'RCD1' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });
  });

  describe('register — CLIENT_SHORTFALL', () => {
    it('missing customerNo/amount → 400', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd' }, ops)).rejects.toThrow(/customer number and an amount/);
    });
    it('advance transfer number given but not found → 404', async () => {
      const { svc } = makeService({ transfer: null });
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900', sourceAdvanceTransferNo: 'ITR9' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('advance transfer purpose is not CLIENT_ADVANCE → 400', async () => {
      const { svc } = makeService({ transfer: { transferNo: 'ITR9', purpose: 'CLIENT_COMPENSATION' } });
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900', sourceAdvanceTransferNo: 'ITR9' }, ops)).rejects.toThrow(/not an advance transfer/);
    });
    it('happy path: can register without an advance transfer number (a shortfall can start unanchored)', async () => {
      const { svc } = makeService();
      const r = await svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });
    it('happy path: registers anchored to a valid advance transfer number', async () => {
      const { svc } = makeService({ transfer: { transferNo: 'ITR9', purpose: 'CLIENT_ADVANCE' } });
      const r = await svc.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900', sourceAdvanceTransferNo: 'ITR9' }, ops);
      expect(r.incidentNo).toMatch(/^INC/);
    });
  });

  describe('startInvestigation', () => {
    it('REGISTERED → INVESTIGATING + audit fromStatus/toStatus top-level', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.startInvestigation('INC1', ops);
      expect(r.status).toBe(S.INVESTIGATING);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({ where: { incidentNo: 'INC1' }, data: expect.objectContaining({ status: S.INVESTIGATING }) }));
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_INVESTIGATION_STARTED', fromStatus: S.REGISTERED, toStatus: S.INVESTIGATING });
      expect(call.requestId).toMatch(/^INCIDENT_INVESTIGATION_STARTED_INC1_/);
    });
    it('not starting from REGISTERED → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.WITHDRAWN } });
      await expect(svc.startInvestigation('INC1', ops)).rejects.toThrow(/Illegal incident status transition/);
    });
  });

  describe('addNote', () => {
    it('writes IncidentNote{kind:NOTE} + audit body top-level', async () => {
      const { svc, prisma, auditLogs } = makeService();
      await svc.addNote('INC1', 'Reviewed the custodian statement, nothing unusual', ops);
      expect(prisma.incidentNote.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'NOTE', body: 'Reviewed the custodian statement, nothing unusual' }) });
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_NOTE_ADDED', body: 'Reviewed the custodian statement, nothing unusual' });
    });
    it('empty content → 400', async () => {
      const { svc } = makeService();
      await expect(svc.addNote('INC1', '', ops)).rejects.toThrow(BadRequestException);
    });
  });

  describe('escalate', () => {
    it('writes IncidentNote{kind:ESCALATION,escalatedTo} + audit escalatedTo top-level and metadata', async () => {
      const { svc, prisma, auditLogs } = makeService();
      await svc.escalate('INC1', { to: 'MLRO', note: 'Escalating to MLRO for classification' }, ops);
      expect(prisma.incidentNote.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'ESCALATION', escalatedTo: 'MLRO', body: 'Escalating to MLRO for classification' }) });
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_ESCALATED', escalatedTo: 'MLRO' });
      expect(call.metadata).toMatchObject({ escalatedTo: 'MLRO' });
    });
  });

  describe('withdraw', () => {
    it('reason is required', async () => {
      const { svc } = makeService();
      await expect(svc.withdraw('INC1', '', ops)).rejects.toThrow(BadRequestException);
    });
    it('only allowed from REGISTERED', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING } });
      await expect(svc.withdraw('INC1', 'Registered in error', ops)).rejects.toThrow(/Illegal incident status transition/);
    });
    it('happy path: REGISTERED → WITHDRAWN + withdrawnReason persisted + audit reason top-level', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.withdraw('INC1', 'Registered in error, duplicate case', ops);
      expect(r.status).toBe(S.WITHDRAWN);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: S.WITHDRAWN, withdrawnReason: 'Registered in error, duplicate case' }) }));
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_WITHDRAWN', reason: 'Registered in error, duplicate case' });
    });
  });

  describe('linkRemediation — validates referenceNo exists in its own domain (status must be ASSESSED/RESOLVING, see the Task 7 guard cases below)', () => {
    it('ADJUSTMENT not found → 404', async () => {
      const { svc } = makeService({ adjustment: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('TRANSFER not found → 404', async () => {
      const { svc } = makeService({ transfer: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'TRANSFER', referenceNo: 'ITR1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('SUPPLEMENT not found → 404', async () => {
      const { svc } = makeService({ deposit: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'SUPPLEMENT', referenceNo: 'DEP1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('CLAIM not found → 404', async () => {
      const { svc } = makeService({ deposit: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'CLAIM', referenceNo: 'DEP2' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('happy path: ADJUSTMENT exists → linked + audit referenceNo top-level', async () => {
      const { svc, prisma, auditLogs } = makeService({ adjustment: { adjustmentNo: 'ADJ1' }, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING } });
      await svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }) });
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'ADJ1' });
    });
  });

  describe('linkRemediation — link status guard + transition carrier (Task 7 fix: the gap where ASSESSED→RESOLVING was never triggered)', () => {
    it('linking while ASSESSED → status advances to RESOLVING + link succeeds + audit metadata.statusAdvanced', async () => {
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

    it('linking while RESOLVING → status unchanged, pure append, audit metadata has no statusAdvanced', async () => {
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

    it('linking while REGISTERED → 400 (not assessed yet, remediation cannot be linked)', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.REGISTERED } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
    });

    it('linking while INVESTIGATING → 400 (not assessed yet, remediation cannot be linked)', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
    });
  });

  describe('one audit entry per action (recordByActor + explicit requestId)', () => {
    it('register/startInvestigation/addNote/escalate/withdraw/linkRemediation each call recordByActor exactly once', async () => {
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

  describe('INCIDENT_REPORT_BASES — reporting basis directory (hours are sourced directly from the regulatory clause, must not be changed)', () => {
    it('TIR_K_H has a statutory 72h clock, the two CRM bases have no clock (hours=null)', () => {
      expect(REPORT_BASES.TIR_K_H.hours).toBe(72);
      expect(REPORT_BASES.CRM_IV_E_5.hours).toBeNull();
      expect(REPORT_BASES.CRM_V_D_2.hours).toBeNull();
      expect(Object.keys(REPORT_BASES)).toEqual(['TIR_K_H', 'CRM_IV_E_5', 'CRM_V_D_2']);
    });
  });

  describe('assess — assessment + basis codes + 72h countdown (Task 6)', () => {
    it('only allowed from INVESTIGATING (400)', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.REGISTERED, createdAt: new Date('2026-09-01T00:00:00.000Z') } });
      await expect(svc.assess('INC1', { assessedAmount: '100', assessmentBasis: 'NO_LOSS', reportRequired: false }, ops)).rejects.toThrow(/Illegal incident status transition/);
    });

    it('missing assessedAmount/assessmentBasis → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '', assessmentBasis: 'NO_LOSS', reportRequired: false } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportRequired=true but reportBasisCodes is empty → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: [] }, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportBasisCodes contains a code outside the directory → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: ['NOT_A_BASIS'] }, ops)).rejects.toThrow(BadRequestException);
    });

    it('happy path: selecting only TIR_K_H → reportDeadlineAt = createdAt + 72h (mutation target 2) + audit top-level assessmentBasis', async () => {
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

    it('selecting only a clockless basis (CRM_IV_E_5) → reportDeadlineAt stays null (no invented deadline)', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt } });
      await svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'CLIENT_COLLECTION', reportRequired: true, reportBasisCodes: ['CRM_IV_E_5'] }, ops);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportDeadlineAt).toBeNull();
    });

    it('reportRequired=false → reportBasisCodes/reportDeadlineAt both persist as null', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.INVESTIGATING, createdAt: new Date() } });
      await svc.assess('INC1', { assessedAmount: '0', assessmentBasis: 'RECOVERED', reportRequired: false }, ops);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportRequired).toBe(false);
      expect(updateCall.data.reportBasisCodes).toBeNull();
      expect(updateCall.data.reportDeadlineAt).toBeNull();
    });
  });

  describe('saveReportDraft — first save records the draft audit, later saves only update the draft (per spec conclusion)', () => {
    it('first draft saved: reportDraftedAt + audit INCIDENT_REGULATOR_REPORT_DRAFTED', async () => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportDraft: null } });
      await svc.saveReportDraft('INC1', 'Report draft v1', ops);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { incidentNo: 'INC1' },
        data: expect.objectContaining({ reportDraft: 'Report draft v1', reportDraftedAt: expect.any(Date) }),
      }));
      expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_REGULATOR_REPORT_DRAFTED' });
    });

    it('saving again: only updates the draft field, does not record that audit code again', async () => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportDraft: 'Existing draft' } });
      await svc.saveReportDraft('INC1', 'Report draft v2', ops);
      expect(prisma.incident.update).toHaveBeenCalledWith({ where: { incidentNo: 'INC1' }, data: { reportDraft: 'Report draft v2' } });
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });
  });

  describe('markReported — precondition reportRequired && reportDraft non-empty', () => {
    it('reportRequired=false → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportRequired: false, reportDraft: 'Draft' } });
      await expect(svc.markReported('INC1', {}, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportDraft is empty → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportRequired: true, reportDraft: null } });
      await expect(svc.markReported('INC1', {}, ops)).rejects.toThrow(BadRequestException);
    });

    it('happy path: persists reportedAt/reportedByUserId/reportReference + audit metadata.basisCodes', async () => {
      const { svc, prisma, auditLogs } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED, reportRequired: true, reportDraft: 'Draft', reportBasisCodes: 'TIR_K_H' },
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

  describe('close-support methods (Task 7) — pure data methods, no audit (the workflow records it)', () => {
    it('findRemediations: returns the remediation reference list (referenceNo only)', async () => {
      const { svc, prisma } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING },
        remediations: [{ id: 'rem-1', referenceNo: 'ADJ1' }, { id: 'rem-2', referenceNo: 'ITR9' }],
      });
      const refs = await svc.findRemediations('INC1');
      expect(refs).toEqual(['ADJ1', 'ITR9']);
      expect(prisma.incidentRemediation.findMany).toHaveBeenCalledWith({ where: { incidentId: 'uuid-inc' } });
    });

    it('findRemediations: no links → empty array', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED }, remediations: [] });
      await expect(svc.findRemediations('INC1')).resolves.toEqual([]);
    });

    it('markCloseRequested: writes only the approvalNo column, does not touch status, no audit', async () => {
      const { svc, prisma, auditLogs } = makeService();
      await svc.markCloseRequested('INC1', 'AC1');
      expect(prisma.incident.update).toHaveBeenCalledWith({ where: { incidentNo: 'INC1' }, data: { approvalNo: 'AC1' } });
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('close: ASSESSED → CLOSED + closedAt, no audit', async () => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.ASSESSED } });
      const r = await svc.close('INC1');
      expect(r.status).toBe(S.CLOSED);
      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({ where: { incidentNo: 'INC1' }, data: expect.objectContaining({ status: S.CLOSED, closedAt: expect.any(Date) }) }));
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('close: RESOLVING → CLOSED', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.RESOLVING } });
      const r = await svc.close('INC1');
      expect(r.status).toBe(S.CLOSED);
    });

    it('close: illegal source status (e.g. REGISTERED) → 400 (transition table backstop)', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', status: S.REGISTERED } });
      await expect(svc.close('INC1')).rejects.toThrow(/Illegal incident status transition/);
    });
  });

  describe('list / getView (Task 8: thin-forwarding projections for the HTTP layer, Rule 6 zero id)', () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');

    it('list: filters by status/type/customerNo/sourceCaseNo and projects to the business-key view', async () => {
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

    it('getView: entity fields + notes + remediations, zero id/incidentId', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.INVESTIGATING,
        title: 't', description: 'd', customerNo: null, sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, assetCode: null, amount: null,
        assessedAmount: null, assessmentBasis: null, reportRequired: false, reportBasisCodes: null,
        reportDeadlineAt: null, reportDraft: null, reportDraftedAt: null, reportedAt: null,
        reportReference: null, approvalNo: null, registeredByUserId: 'ADM-OPS',
        closedAt: null, withdrawnReason: null, createdAt,
      };
      const notes = [{ kind: 'NOTE', escalatedTo: null, body: 'Logged a note', authorUserId: 'ADM-OPS', createdAt }];
      const remediations = [{ kind: 'ADJUSTMENT', referenceNo: 'ADJ1', linkedByUserId: 'ADM-OPS', createdAt }];
      const adjustments = [{ adjustmentNo: 'ADJ1', status: 'POSTED' }];
      const { svc } = makeService({ incidentRow, notes, remediations, adjustments });
      const view = await svc.getView('INC1');
      expect(view.incidentNo).toBe('INC1');
      expect(view.notes).toEqual([{ kind: 'NOTE', escalatedTo: null, body: 'Logged a note', authorBy: 'ADM-OPS', createdAt: createdAt.toISOString() }]);
      // Task 12：ADJUSTMENT 善后单要带上调账单现状——事故页「发起补款」按钮据此判断
      // 「已落账（POSTED）」，remediations 表本身不存这个会过期的状态快照。
      expect(view.remediations).toEqual([{ kind: 'ADJUSTMENT', referenceNo: 'ADJ1', linkedBy: 'ADM-OPS', createdAt: createdAt.toISOString(), status: 'POSTED' }]);
      expect(view).not.toHaveProperty('id');
      expect(JSON.stringify(view)).not.toContain('uuid-inc');
    });

    it('getView: a non-ADJUSTMENT remediation does not query adjustment status, status is always null', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.MANUAL, status: S.RESOLVING,
        title: 't', description: 'd', customerNo: null, sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, assetCode: null, amount: null,
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

    it('getView: incident not found → 404', async () => {
      const { svc, prisma } = makeService();
      prisma.incident.findUnique.mockResolvedValueOnce(null);
      await expect(svc.getView('NOPE')).rejects.toThrow(NotFoundException);
    });
  });
});
