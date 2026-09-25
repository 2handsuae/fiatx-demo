import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegulatoryFilingService } from './regulatory-filing.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';

const ops: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['COMPLIANCE_OFFICER'] };

describe('RegulatoryFilingService (Task 3)', () => {
  let prisma: PrismaService;
  let service: RegulatoryFilingService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };
  const createdFilingNos: string[] = [];
  const createdIncidentNos: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (createdFilingNos.length) {
      await prisma.auditLogEvent.deleteMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: { in: createdFilingNos } } });
      await prisma.regulatoryFilingEntry.deleteMany({ where: { filing: { filingNo: { in: createdFilingNos } } } });
      await prisma.regulatoryFiling.deleteMany({ where: { filingNo: { in: createdFilingNos } } });
    }
    if (createdIncidentNos.length) {
      await prisma.incident.deleteMany({ where: { incidentNo: { in: createdIncidentNos } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    auditLogs = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        RegulatoryFilingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(RegulatoryFilingService);
  });

  function actionsOf(): string[] {
    return [...auditLogs.recordByActor.mock.calls, ...auditLogs.recordSystem.mock.calls].map((c) => c[0].action);
  }

  async function makeIncident(overrides: Partial<{ type: string; customerNo: string | null; createdAt: Date }> = {}): Promise<string> {
    const incidentNo = `INC_T3_${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.incident.create({
      data: {
        incidentNo, type: overrides.type ?? 'DATA_BREACH', status: 'ASSESSED',
        title: 't3', description: 'd3', customerNo: overrides.customerNo ?? null,
        registeredByUserId: 'U_T3', traceId: randomUUID(),
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
    createdIncidentNos.push(incidentNo);
    return incidentNo;
  }

  async function openDraftFiling(): Promise<string> {
    const { filingNo } = await service.openManual({ type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'Change of registered address' }, ops);
    createdFilingNos.push(filingNo);
    return filingNo;
  }

  async function toSubmittedFiling(): Promise<string> {
    const filingNo = await openDraftFiling();
    await service.markSignoffRequested(filingNo, `APR_${filingNo}`, ops);
    await service.applySignoffDecision(filingNo, 'APPROVED', { approvalNo: `APR_${filingNo}`, approvalId: `apid_${filingNo}` });
    await service.markSubmitted(filingNo, { externalRef: `EXT_${filingNo}` }, ops);
    return filingNo;
  }

  // ── ① openForIncident：两码开两单 ──────────────────────────────────
  describe('openForIncident', () => {
    it('opens one filing per basis code, with per-code deadline (TIR_K_H = createdAt+72h, TIR_II_C_24H = null pending chain)', async () => {
      const createdAt = new Date('2026-09-20T10:00:00.000Z');
      const incident = { incidentNo: 'INC_FAKE_OPEN_1', type: 'DATA_BREACH', title: 'Data breach', createdAt, customerNo: 'CU_T3_1', traceId: randomUUID() };
      const { filingNos } = await service.openForIncident(incident, ['TIR_K_H', 'TIR_II_C_24H'], ops);
      createdFilingNos.push(...filingNos);
      expect(filingNos).toHaveLength(2);

      const rows = await Promise.all(filingNos.map((no) => service.findByNo(no)));
      const tirKH = rows.find((r) => r.basisCode === 'TIR_K_H')!;
      const tirIIC = rows.find((r) => r.basisCode === 'TIR_II_C_24H')!;

      expect(tirKH.deadlineAt?.toISOString()).toBe(new Date(createdAt.getTime() + 72 * 3600 * 1000).toISOString());
      expect(tirKH.authority).toBe('VARA');
      expect(tirKH.direction).toBe('OUTBOUND');
      expect(tirKH.incidentNo).toBe(incident.incidentNo);
      expect(tirIIC.deadlineAt).toBeNull();
      expect(tirIIC.authority).toBe('VARA');

      expect(actionsOf()).toEqual(['FILING_OPENED', 'FILING_OPENED']);
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ actionDomain: 'GOVERNANCE', primarySubjectType: 'REGULATORY_FILING', type: 'INCIDENT_REPORT' });
    });
  });

  // ── ② openManual：INBOUND 类型 deadline + authority 必给且在目录内 ────
  describe('openManual — non-incident types', () => {
    it('INBOUND (REG_INFO_REQUEST_RESPONSE) computes receivedAt+48h and stores the given authority', async () => {
      const receivedAt = '2026-09-20T00:00:00.000Z';
      const { filingNo } = await service.openManual({ type: 'REG_INFO_REQUEST_RESPONSE', authority: 'UAE_FIU', receivedAt }, ops);
      createdFilingNos.push(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.direction).toBe('INBOUND');
      expect(row.authority).toBe('UAE_FIU');
      expect(row.deadlineAt?.toISOString()).toBe(new Date(new Date(receivedAt).getTime() + 48 * 3600 * 1000).toISOString());
    });

    it('rejects REG_INFO_REQUEST_RESPONSE with no authority given (no registry default for this type)', async () => {
      await expect(service.openManual({ type: 'REG_INFO_REQUEST_RESPONSE', receivedAt: '2026-09-20T00:00:00.000Z' } as any, ops))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects an authority outside the regulator directory', async () => {
      await expect(service.openManual({ type: 'REG_INFO_REQUEST_RESPONSE', authority: 'FBI', receivedAt: '2026-09-20T00:00:00.000Z' } as any, ops))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── ③ openManual('INCIDENT_REPORT')：校验全在 service 内 ─────────────
  describe('openManual — INCIDENT_REPORT (validated in service, no workflow)', () => {
    it('rejects a missing incidentNo', async () => {
      await expect(service.openManual({ type: 'INCIDENT_REPORT', basisCode: 'PDPL_ART_9' } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing basisCode', async () => {
      const incidentNo = await makeIncident();
      await expect(service.openManual({ type: 'INCIDENT_REPORT', incidentNo } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('rejects when the incident does not exist', async () => {
      await expect(service.openManual({ type: 'INCIDENT_REPORT', incidentNo: 'INC_NOPE_999', basisCode: 'PDPL_ART_9' } as any, ops))
        .rejects.toThrow(NotFoundException);
    });

    it('rejects a basisCode that is not a reportBasisCandidate for the incident type (DATA_BREACH does not carry TIR_K_H)', async () => {
      const incidentNo = await makeIncident({ type: 'DATA_BREACH' });
      await expect(service.openManual({ type: 'INCIDENT_REPORT', incidentNo, basisCode: 'TIR_K_H' } as any, ops))
        .rejects.toThrow(BadRequestException);
    });

    it('accepts a valid basisCode for the incident type and opens a filing carrying the basis authority', async () => {
      const incidentNo = await makeIncident({ type: 'DATA_BREACH' });
      const { filingNo } = await service.openManual({ type: 'INCIDENT_REPORT', incidentNo, basisCode: 'PDPL_ART_9' }, ops);
      createdFilingNos.push(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.authority).toBe('UAE_DATA_OFFICE');
      expect(row.incidentNo).toBe(incidentNo);
    });
  });

  // ── ④ saveDraft：首次记审计，再存不重记 ───────────────────────────
  describe('saveDraft', () => {
    it('records FILING_DRAFT_SAVED only on the first save', async () => {
      const filingNo = await openDraftFiling();
      await service.saveDraft(filingNo, 'draft v1', ops);
      await service.saveDraft(filingNo, 'draft v2', ops);
      const draftSaves = auditLogs.recordByActor.mock.calls.filter((c) => c[0].action === 'FILING_DRAFT_SAVED');
      expect(draftSaves).toHaveLength(1);
      const row = await service.findByNo(filingNo);
      expect(row.body).toBe('draft v2');
    });
  });

  // ── ⑤ 非法跃迁显式拒 ──────────────────────────────────────────────
  describe('illegal transitions are explicitly rejected', () => {
    it('DRAFT cannot jump straight to markSubmitted', async () => {
      const filingNo = await openDraftFiling();
      await expect(service.markSubmitted(filingNo, { externalRef: 'EXT_ILLEGAL' }, ops)).rejects.toThrow(/Invalid filing transition/);
    });

    it('cancel is rejected once the filing has left DRAFT', async () => {
      const filingNo = await openDraftFiling();
      await service.markSignoffRequested(filingNo, `APR_${filingNo}`, ops);
      await expect(service.cancel(filingNo, 'too late', ops)).rejects.toThrow(/Invalid filing transition/);
    });

    it('close is rejected before the filing is SUBMITTED', async () => {
      const filingNo = await openDraftFiling();
      await expect(service.close(filingNo, ops)).rejects.toThrow(/Invalid filing transition/);
    });
  });

  // ── ⑥ markSubmitted：缺 externalRef 拒；同事故 NOTICE 钟链单落定 ────
  describe('markSubmitted', () => {
    it('rejects a missing externalRef', async () => {
      const filingNo = await openDraftFiling();
      await service.markSignoffRequested(filingNo, `APR_${filingNo}`, ops);
      await service.applySignoffDecision(filingNo, 'APPROVED', { approvalNo: `APR_${filingNo}`, approvalId: `apid_${filingNo}` });
      await expect(service.markSubmitted(filingNo, {} as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('sets the sibling NOTICE-chain deadline (submittedAt+24h) and returns chainDeadlineSetFor', async () => {
      const createdAt = new Date('2026-09-10T08:00:00.000Z');
      const incident = { incidentNo: `INC_CHAIN_${randomUUID().slice(0, 8)}`, type: 'DATA_BREACH', title: 't', createdAt, customerNo: null, traceId: randomUUID() };
      const { filingNos } = await service.openForIncident(incident, ['PDPL_ART_9', 'TIR_II_C_24H'], ops);
      createdFilingNos.push(...filingNos);
      const both = await Promise.all(filingNos.map((no) => service.findByNo(no)));
      const primary = both.find((r) => r.basisCode === 'PDPL_ART_9')!;
      const chainFiling = both.find((r) => r.basisCode === 'TIR_II_C_24H')!;
      expect(chainFiling.deadlineAt).toBeNull();

      await service.markSignoffRequested(primary.filingNo, 'APR_CHAIN', ops);
      await service.applySignoffDecision(primary.filingNo, 'APPROVED', { approvalNo: 'APR_CHAIN', approvalId: 'apid-chain' });
      const result = await service.markSubmitted(primary.filingNo, { externalRef: 'EXT_CHAIN' }, ops);
      expect(result.chainDeadlineSetFor).toEqual([chainFiling.filingNo]);

      const updatedChain = await service.findByNo(chainFiling.filingNo);
      const updatedPrimary = await service.findByNo(primary.filingNo);
      expect(updatedChain.deadlineAt?.toISOString()).toBe(new Date(updatedPrimary.submittedAt!.getTime() + 24 * 3600 * 1000).toISOString());
    });
  });

  // ── ⑦ addEntry：非 SUBMITTED 拒、kind 越枚举拒 ──────────────────────
  describe('addEntry', () => {
    it('rejects logging a correspondence entry when the filing is not SUBMITTED', async () => {
      const filingNo = await openDraftFiling();
      await expect(service.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'x' }, ops)).rejects.toThrow(BadRequestException);
    });

    it('rejects a kind outside the enum, and accepts a valid kind once SUBMITTED (entries projection carries no id)', async () => {
      const filingNo = await toSubmittedFiling();
      await expect(service.addEntry(filingNo, { kind: 'BOGUS_KIND', body: 'x' } as any, ops)).rejects.toThrow(BadRequestException);
      const r = await service.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'Received by VARA' }, ops);
      expect(r.filingNo).toBe(filingNo);
      const view = await service.getView(filingNo);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0]).toMatchObject({ kind: 'RECEIPT_ACK', body: 'Received by VARA' });
      expect(view.entries[0]).not.toHaveProperty('id');
    });
  });

  // ── ⑧ cancel：仅 DRAFT ───────────────────────────────────────────
  describe('cancel', () => {
    it('cancels a DRAFT filing and records the reason', async () => {
      const filingNo = await openDraftFiling();
      const r = await service.cancel(filingNo, 'Filed in error', ops);
      expect(r.filingNo).toBe(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelledReason).toBe('Filed in error');
    });
  });

  // ── ⑨ close：仅 SUBMITTED ─────────────────────────────────────────
  describe('close', () => {
    it('closes a SUBMITTED filing', async () => {
      const filingNo = await toSubmittedFiling();
      const r = await service.close(filingNo, ops, 'Correspondence complete');
      expect(r.filingNo).toBe(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('CLOSED');
      expect(row.closedAt).not.toBeNull();
    });
  });

  // ── applySignoffDecision 反向分支（DECLINED → DRAFT，system 记账）────
  describe('applySignoffDecision — non-approved decisions bounce back to DRAFT', () => {
    it('DECLINED returns the filing to DRAFT and records FILING_SIGNOFF_REJECTED via recordSystem (no actor)', async () => {
      const filingNo = await openDraftFiling();
      await service.markSignoffRequested(filingNo, `APR_${filingNo}`, ops);
      await service.applySignoffDecision(filingNo, 'DECLINED', { approvalNo: `APR_${filingNo}`, approvalId: `apid_${filingNo}`, decisionReason: 'Wording incomplete' });
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('DRAFT');
      expect(auditLogs.recordSystem).toHaveBeenCalledWith(expect.objectContaining({ action: 'FILING_SIGNOFF_REJECTED', reason: 'Wording incomplete' }));
    });
  });

  // ── findByNo ───────────────────────────────────────────────────────
  describe('findByNo', () => {
    it('throws NotFoundException for an unknown filingNo', async () => {
      await expect(service.findByNo('FIL_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── 审计信封真实过闸（真 AuditLogsService，不 mock）：mock 版 recordByActor 是行为化
  // spy，不跑 assertActionSpec——REG_FILING_AUDIT_ACTIONS 的 requiredFields/causation/
  // correlationMode 声明是否真的被本服务的调用点喂对，只有让真校验跑一遍才知道
  // （第 2 条纪律：报绿之前先确认检查真的会红——若某码漏了必填字段，这里会抛 400）。
  describe('audit envelope satisfies the real REG_FILING_AUDIT_ACTIONS contract (real AuditLogsService, no mock)', () => {
    let realService: RegulatoryFilingService;

    beforeEach(async () => {
      const mod = await Test.createTestingModule({
        providers: [
          RegulatoryFilingService,
          { provide: PrismaService, useValue: prisma },
          AuditLogsService,
        ],
      }).compile();
      realService = mod.get(RegulatoryFilingService);
    });

    it('walks the full lifecycle (open→draft→signoff requested→signed off→submitted→entry→close) without the real assertActionSpec rejecting any of the six codes', async () => {
      const { filingNo } = await realService.openManual({ type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'Real-audit lifecycle smoke' }, ops);
      createdFilingNos.push(filingNo);
      await realService.saveDraft(filingNo, 'real draft body', ops);
      await realService.markSignoffRequested(filingNo, `APR_REAL_${filingNo}`, ops);
      await realService.applySignoffDecision(filingNo, 'APPROVED', { approvalNo: `APR_REAL_${filingNo}`, approvalId: `apid_real_${filingNo}` });
      await realService.markSubmitted(filingNo, { externalRef: `EXT_REAL_${filingNo}` }, ops);
      await realService.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'Real receipt' }, ops);
      await realService.close(filingNo, ops, 'Real close');

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual([
        'FILING_OPENED', 'FILING_DRAFT_SAVED', 'FILING_SIGNOFF_REQUESTED',
        'FILING_SIGNED_OFF', 'FILING_SUBMITTED', 'FILING_ENTRY_LOGGED', 'FILING_CLOSED',
      ]);
      // 全部继承同一条旅程（correlationId=traceId），首码 correlationId 铸出的值贯穿到底。
      const correlationIds = new Set(events.map((e) => e.correlationId));
      expect(correlationIds.size).toBe(1);
    });

    it('walks the DECLINED signoff branch (FILING_SIGNOFF_REJECTED, requiredFields=[approvalNo,reason]) and the DRAFT-only cancel branch (FILING_CANCELLED) without rejection', async () => {
      const { filingNo } = await realService.openManual({ type: 'AUDITOR_APPOINTMENT_NOTICE' }, ops);
      createdFilingNos.push(filingNo);
      await realService.markSignoffRequested(filingNo, `APR_DECL_${filingNo}`, ops);
      await realService.applySignoffDecision(filingNo, 'DECLINED', { approvalNo: `APR_DECL_${filingNo}`, approvalId: `apid_decl_${filingNo}`, decisionReason: 'Needs rework' });
      await realService.cancel(filingNo, 'Withdrawn after rework decision', ops);

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual(['FILING_OPENED', 'FILING_SIGNOFF_REQUESTED', 'FILING_SIGNOFF_REJECTED', 'FILING_CANCELLED']);
    });
  });
});
