import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RegulatoryFilingService } from './regulatory-filing.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccessControlService } from '../../identity/access-control/access-control.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { addBusinessDays } from './business-days';

const ops: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['COMPLIANCE_OFFICER'] };
// T3：族独占的第二个 actor——MLRO，只持 cap.filing.aml（见下方 makeAccessControl）。
const mlro: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-mlro', userNo: 'ADM-MLRO', roleCodes: ['MLRO'] };

/** T3：mock 必须按 (userId, code) 真判断（照 incidents 先例，甲波一 T5 修2）——不能无脑
 * 放行，否则把服务层的 family 判据改错、或把两个能力码搞反，测试照样全绿（自证型绿灯）。
 * ops=合规官只持 cap.filing.general；mlro=MLRO 只持 cap.filing.aml；其余 userId 零权限。 */
function makeAccessControl(): { hasPermission: jest.Mock } {
  return {
    hasPermission: jest.fn(async (userId: string, code: string) => {
      if (userId === ops.userId) return code === 'cap.filing.general';
      if (userId === mlro.userId) return code === 'cap.filing.aml';
      return false;
    }),
  };
}

describe('RegulatoryFilingService (Task 3)', () => {
  let prisma: PrismaService;
  let service: RegulatoryFilingService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };
  let accessControl: { hasPermission: jest.Mock };
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
    accessControl = makeAccessControl();
    const mod = await Test.createTestingModule({
      providers: [
        RegulatoryFilingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: AccessControlService, useValue: accessControl },
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

  /** T3：MLRO 手工开一张 AML 族 DRAFT 单（默认 STR，allowNoFilingClose+requiresExternalCaseRef）。 */
  async function openAmlDraftFiling(type: string = 'STR'): Promise<string> {
    const { filingNo } = await service.openManual({ type, title: `${type} case`, externalCaseRef: `CASE_${type}_${randomUUID().slice(0, 6)}` }, mlro);
    createdFilingNos.push(filingNo);
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

  // ── T5（spec §5）：addEntry 分 kind 规则表 FILING_ENTRY_KIND_RULES 矩阵 ─────────
  // 两新 kind（CUSTOMER_COMM/AUTHORITY_INSTRUCTION）×两族×终态/非终态；commDraftedBy
  // 必填闸（仅 CUSTOMER_COMM）；旧三 kind 两族皆可仍仅 SUBMITTED（回归，锁住行为原样）。
  describe('addEntry — FILING_ENTRY_KIND_RULES matrix (T5, spec §5 tipping-off 登记本 + EOCN 指令留痕)', () => {
    describe('CUSTOMER_COMM / AUTHORITY_INSTRUCTION are AML-family-only', () => {
      it('a SUBMITTED GENERAL filing rejects CUSTOMER_COMM (400) — GENERAL 族零角色', async () => {
        const filingNo = await toSubmittedFiling(); // GENERAL, SUBMITTED
        await expect(service.addEntry(filingNo, { kind: 'CUSTOMER_COMM', body: 'x', commDraftedBy: 'Jane (MLRO)' }, ops))
          .rejects.toThrow(BadRequestException);
      });

      it('a SUBMITTED GENERAL filing rejects AUTHORITY_INSTRUCTION (400) — GENERAL 监管指令维持既有 REGULATOR_INQUIRY（评审白项口径）', async () => {
        const filingNo = await toSubmittedFiling();
        await expect(service.addEntry(filingNo, { kind: 'AUTHORITY_INSTRUCTION', body: 'x' }, ops)).rejects.toThrow(BadRequestException);
        // 既有 kind 原样可用——不是「GENERAL 族指令没地方记」，是维持既有口径。
        const r = await service.addEntry(filingNo, { kind: 'REGULATOR_INQUIRY', body: 'Regulator asked for clarification' }, ops);
        expect(r.filingNo).toBe(filingNo);
      });

      it('an AML DRAFT filing accepts CUSTOMER_COMM with commDraftedBy — 非终态即可追加，不必等 SUBMITTED', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        const row0 = await service.findByNo(filingNo);
        expect(row0.status).toBe('DRAFT');
        const r = await service.addEntry(
          filingNo,
          { kind: 'CUSTOMER_COMM', body: 'You are cleared to proceed — standard onboarding language', commDraftedBy: 'Jane Doe (MLRO)' },
          mlro,
        );
        expect(r.filingNo).toBe(filingNo);
        const view = await service.getView(filingNo);
        expect(view.entries[0]).toMatchObject({ kind: 'CUSTOMER_COMM', commDraftedBy: 'Jane Doe (MLRO)', recordedByUserId: mlro.userNo });
      });

      it('an AML SUBMITTED filing accepts AUTHORITY_INSTRUCTION with no commDraftedBy (records, does not push state)', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        await service.markSubmitted(filingNo, { externalRef: 'GOAML_AUTH_1' }, mlro);
        const r = await service.addEntry(filingNo, { kind: 'AUTHORITY_INSTRUCTION', body: 'EOCN: maintain freeze pending further notice' }, mlro);
        expect(r.filingNo).toBe(filingNo);
        const view = await service.getView(filingNo);
        expect(view.entries[0]).toMatchObject({ kind: 'AUTHORITY_INSTRUCTION', commDraftedBy: null });
        // 记录不推状态——单据仍是 SUBMITTED（解除/升级走 T4 的链，不在本方法）。
        const row = await service.findByNo(filingNo);
        expect(row.status).toBe('SUBMITTED');
      });

      it('an AML filing CLOSED via closeNoFiling (terminal) rejects both new kinds — 非终态放宽不含终态', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        await service.closeNoFiling(filingNo, 'Insufficient grounds to suspect after review', mlro);
        await expect(service.addEntry(filingNo, { kind: 'CUSTOMER_COMM', body: 'x', commDraftedBy: 'Jane' }, mlro)).rejects.toThrow(BadRequestException);
        await expect(service.addEntry(filingNo, { kind: 'AUTHORITY_INSTRUCTION', body: 'x' }, mlro)).rejects.toThrow(BadRequestException);
      });

      it('an AML filing CANCELLED (terminal) rejects CUSTOMER_COMM', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        await service.cancel(filingNo, 'Filed in error', mlro);
        await expect(service.addEntry(filingNo, { kind: 'CUSTOMER_COMM', body: 'x', commDraftedBy: 'Jane' }, mlro)).rejects.toThrow(BadRequestException);
      });
    });

    describe('commDraftedBy gate — CUSTOMER_COMM only, MLRO 亲录预审留痕', () => {
      it('CUSTOMER_COMM without commDraftedBy is rejected (400)', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        await expect(service.addEntry(filingNo, { kind: 'CUSTOMER_COMM', body: 'x' }, mlro)).rejects.toThrow(BadRequestException);
        await expect(service.addEntry(filingNo, { kind: 'CUSTOMER_COMM', body: 'x' }, mlro)).rejects.toThrow(/commDraftedBy/);
      });

      it.each(['RECEIPT_ACK', 'REGULATOR_INQUIRY', 'OUR_SUPPLEMENT', 'AUTHORITY_INSTRUCTION'])(
        '%s carrying commDraftedBy is rejected (400) — 防字段串味到不该有它的 kind 上',
        async (kind) => {
          const filingNo = await openAmlDraftFiling('STR');
          await service.markSubmitted(filingNo, { externalRef: 'GOAML_CROSS_1' }, mlro);
          await expect(service.addEntry(filingNo, { kind, body: 'x', commDraftedBy: 'Should not be here' }, mlro)).rejects.toThrow(BadRequestException);
        },
      );
    });

    describe('legacy three kinds: unchanged — both families, SUBMITTED-only (regression)', () => {
      it('RECEIPT_ACK on a SUBMITTED AML filing (goAML receipt) still works', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        await service.markSubmitted(filingNo, { externalRef: 'GOAML_ACK_REG' }, mlro);
        const r = await service.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'goAML acknowledgement receipt' }, mlro);
        expect(r.filingNo).toBe(filingNo);
      });

      it('RECEIPT_ACK on a DRAFT AML filing is still rejected — SUBMITTED_ONLY unchanged for legacy kinds', async () => {
        const filingNo = await openAmlDraftFiling('STR');
        await expect(service.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'x' }, mlro)).rejects.toThrow(BadRequestException);
      });
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

    // T3 评审黄项：DRAFT→CLOSED 是 AML 族表级合法边（供 closeNoFiling 走），但 close()
    // 是另一个动作，动作级只认 SUBMITTED——防「法定必报单被无理由 Close」。
    it('rejects closing a DRAFT AML filing via close() even though DRAFT→CLOSED is a legal family edge (action-level guard, not table-level)', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await expect(service.close(filingNo, mlro)).rejects.toThrow(BadRequestException);
      await expect(service.close(filingNo, mlro)).rejects.toThrow(/Invalid filing transition/);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('DRAFT');
    });
  });

  // ── T3 ①：服务层按族独占（cap.filing.general/cap.filing.aml）双向 403 ──────
  describe('family exclusivity (cap.filing.general / cap.filing.aml) — cross-family writes are explicitly rejected', () => {
    it('a compliance officer (cap.filing.general only) cannot openManual an AML type (STR) — T1 review white-4', async () => {
      await expect(service.openManual({ type: 'STR', title: 'Should be blocked', externalCaseRef: 'CASE_X' }, ops))
        .rejects.toThrow(ForbiddenException);
      expect(accessControl.hasPermission).toHaveBeenCalledWith(ops.userId, 'cap.filing.aml');
    });

    it('MLRO (cap.filing.aml only) cannot openManual a GENERAL type (MATERIAL_CHANGE_NOTIFICATION)', async () => {
      await expect(service.openManual({ type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'Should be blocked' }, mlro))
        .rejects.toThrow(ForbiddenException);
      expect(accessControl.hasPermission).toHaveBeenCalledWith(mlro.userId, 'cap.filing.general');
    });

    // T3修1（评审黄3）：标题原列了 close，正文没测——补上（用 DRAFT 单即可：assertFamily
    // 在 close() 里跑在 SUBMITTED 状态检查之前，DRAFT 单一样能验证族门先拦）。
    it('MLRO cannot saveDraft/markSubmitted/addEntry/close/cancel a GENERAL filing (403, not the actor who opened it)', async () => {
      const filingNo = await openDraftFiling(); // GENERAL, opened by ops
      await expect(service.saveDraft(filingNo, 'x', mlro)).rejects.toThrow(ForbiddenException);
      await expect(service.markSubmitted(filingNo, { externalRef: 'E' }, mlro)).rejects.toThrow(ForbiddenException);
      await expect(service.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'x' }, mlro)).rejects.toThrow(ForbiddenException);
      await expect(service.close(filingNo, mlro)).rejects.toThrow(ForbiddenException);
      await expect(service.cancel(filingNo, 'x', mlro)).rejects.toThrow(ForbiddenException);
    });

    // T3修1（评审黄3）：标题原列了 addEntry/close，正文没测——补上。
    it('a compliance officer cannot saveDraft/markSubmitted/addEntry/close/cancel an AML filing', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await expect(service.saveDraft(filingNo, 'x', ops)).rejects.toThrow(ForbiddenException);
      await expect(service.markSubmitted(filingNo, { externalRef: 'E' }, ops)).rejects.toThrow(ForbiddenException);
      await expect(service.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'x' }, ops)).rejects.toThrow(ForbiddenException);
      await expect(service.close(filingNo, ops)).rejects.toThrow(ForbiddenException);
      await expect(service.cancel(filingNo, 'x', ops)).rejects.toThrow(ForbiddenException);
    });

    // T3修1（评审黄3）：补两方向的送签（markSignoffRequested）跨族断言——此前只有
    // 「AML 全生命周期」块里用 mlro 打 AML 单验证族边非法跃迁（400），没有验证族门本身
    // （403）在两个方向上都真挡；两条都用 DRAFT 单（assertSignoffAllowed 里 assertFamily
    // 跑在族边校验之前，DRAFT 状态本身对两族都是 PENDING_SIGNOFF 的合法/非法出发点之一，
    // 不影响先命中族门）。
    it('MLRO cannot request signoff for a GENERAL filing (403, family gate before the transition table)', async () => {
      const filingNo = await openDraftFiling(); // GENERAL, opened by ops
      await expect(service.markSignoffRequested(filingNo, 'APR_X', mlro)).rejects.toThrow(ForbiddenException);
    });

    it('a compliance officer cannot request signoff for an AML filing (403, family gate before the transition table)', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await expect(service.markSignoffRequested(filingNo, 'APR_X', ops)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── T3 ②③：AML 族全生命周期——自 DRAFT 直达 SUBMITTED，无签发链 ──────────
  describe('AML family lifecycle (spec §3 点 2: DRAFT→SUBMITTED direct, no signoff chain)', () => {
    it('MLRO opens an STR and marks it submitted straight from DRAFT (no signoff step)', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      const row0 = await service.findByNo(filingNo);
      expect(row0.status).toBe('DRAFT');
      const result = await service.markSubmitted(filingNo, { externalRef: 'GOAML_ACK_1' }, mlro);
      expect(result.filingNo).toBe(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('SUBMITTED');
      expect(row.externalRef).toBe('GOAML_ACK_1');
    });

    it('signoff on an AML filing is an explicit illegal transition (no signoff chain for AML — spec §2 A line)', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await expect(service.markSignoffRequested(filingNo, 'APR_AML_1', mlro)).rejects.toThrow(BadRequestException);
      await expect(service.markSignoffRequested(filingNo, 'APR_AML_1', mlro)).rejects.toThrow(/Invalid filing transition/);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('DRAFT');
    });

    it('close() after a real SUBMITTED AML filing still works (SUBMITTED→CLOSED is legal for both families)', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await service.markSubmitted(filingNo, { externalRef: 'GOAML_ACK_2' }, mlro);
      const r = await service.close(filingNo, mlro, 'Correspondence complete');
      expect(r.filingNo).toBe(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('CLOSED');
    });
  });

  // ── T3 ③：closeNoFiling ────────────────────────────────────────────────
  describe('closeNoFiling (spec §3 点 2: DRAFT→CLOSED "decided not to file", noFilingReason required gate)', () => {
    it('rejects an empty noFilingReason (400, before even looking up the filing)', async () => {
      await expect(service.closeNoFiling('FIL_DOES_NOT_MATTER', '', mlro)).rejects.toThrow(BadRequestException);
      await expect(service.closeNoFiling('FIL_DOES_NOT_MATTER', '', mlro)).rejects.toThrow(/noFilingReason/);
    });

    // T3修1（评审黄2）：DB 落库值（noFilingReason 走 transition() 的 patch，本就落库，
    // 该断言此前已在）+ 视图投影值（getView 此前不吐 noFilingReason/externalCaseRef，
    // T9 报送台前端没有数据源——本轮新增）双重核对。
    it('closes an STR (allowNoFilingClose=true) from DRAFT with a reason, persists it, and surfaces it (with externalCaseRef) via getView', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      const r = await service.closeNoFiling(filingNo, 'Insufficient grounds to suspect after review', mlro);
      expect(r.filingNo).toBe(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('CLOSED');
      expect(row.noFilingReason).toBe('Insufficient grounds to suspect after review');
      expect(row.closedAt).not.toBeNull();

      const view = await service.getView(filingNo);
      expect(view.noFilingReason).toBe('Insufficient grounds to suspect after review');
      expect(view.externalCaseRef).toMatch(/^CASE_STR_/);

      const listItems = await service.list({});
      const listItem = listItems.find((it) => it.filingNo === filingNo)!;
      expect(listItem.externalCaseRef).toBe(view.externalCaseRef);
    });

    // T3修1（评审黄1）：DRAFT→CLOSED 是 AML 族表级合法边（供本方法走），但 AML 族表里
    // SUBMITTED→CLOSED 同样合法（供既有 close() 走）——若 closeNoFiling 不加动作级
    // DRAFT-only 守卫，一张已提交带回执的 STR 也能被「决定不报」结案，跟"已提交"这个
    // 事实自相矛盾（审计上一边说已提交、一边说决定不报）。
    it('rejects closeNoFiling on a SUBMITTED STR (already filed — must use close() instead) with 400', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await service.markSubmitted(filingNo, { externalRef: 'GOAML_ACK_NOFILE' }, mlro);
      await expect(service.closeNoFiling(filingNo, 'Too late, already submitted', mlro)).rejects.toThrow(BadRequestException);
      await expect(service.closeNoFiling(filingNo, 'Too late, already submitted', mlro)).rejects.toThrow(/Invalid filing transition/);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('SUBMITTED');
      expect(row.noFilingReason).toBeNull();
    });

    // T1 评审白5：CNMR/PNMR/HRC/HRCA 都不是 allowNoFilingClose 类型——法定必报单不许用
    // 「决定不报」这条边溜走。
    it.each(['CNMR', 'PNMR', 'HRC', 'HRCA'])('rejects %s (allowNoFilingClose is not set) with 400', async (type) => {
      const filingNo = await openAmlDraftFiling(type);
      await expect(service.closeNoFiling(filingNo, 'Trying to dodge a mandatory filing', mlro)).rejects.toThrow(BadRequestException);
      await expect(service.closeNoFiling(filingNo, 'Trying to dodge a mandatory filing', mlro)).rejects.toThrow(/does not allow a no-filing close/);
      const row = await service.findByNo(filingNo);
      expect(row.status).toBe('DRAFT');
    });

    it('a compliance officer cannot closeNoFiling an AML filing (family-exclusive, 403 before the allowNoFilingClose check)', async () => {
      const filingNo = await openAmlDraftFiling('STR');
      await expect(service.closeNoFiling(filingNo, 'x', ops)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── T3 ④：openForSanction（供 T4 workflow 调用，本任务不建 workflow）────────
  describe('openForSanction (spec §2 B line PARTIAL/CONFIRMED outlets; EXTERNAL anchor + business-day clock)', () => {
    it('opens a CNMR anchored on anchorAt, deadline = anchorAt + 5 business days (EOCN TFS Guidelines 2025)', async () => {
      const anchorAt = new Date('2026-09-24T09:00:00.000Z'); // 迪拜周四
      const { filingNo } = await service.openForSanction('CNMR', 'CU_SANCTION_1', 'EOCN_LIST_ENTRY_1', anchorAt, `REQ_${randomUUID()}`, mlro);
      createdFilingNos.push(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.type).toBe('CNMR');
      expect(row.authority).toBe('EOCN');
      expect(row.externalCaseRef).toBe('EOCN_LIST_ENTRY_1');
      expect(row.status).toBe('DRAFT');
      expect(row.deadlineAt?.toISOString()).toBe(addBusinessDays(anchorAt, 5).toISOString());
    });

    it('opens a PNMR the same way (self-certified partial match, 5 business days from suspension)', async () => {
      const anchorAt = new Date('2026-09-24T09:00:00.000Z');
      const { filingNo } = await service.openForSanction('PNMR', 'CU_SANCTION_2', 'EOCN_LIST_ENTRY_2', anchorAt, `REQ_${randomUUID()}`, mlro);
      createdFilingNos.push(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.type).toBe('PNMR');
      expect(row.deadlineAt?.toISOString()).toBe(addBusinessDays(anchorAt, 5).toISOString());
    });

    it('rejects a type other than CNMR/PNMR', async () => {
      await expect(service.openForSanction('STR', 'CU_X', 'REF', new Date(), 'REQ_X', mlro)).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing externalCaseRef', async () => {
      await expect(service.openForSanction('CNMR', 'CU_X', '', new Date(), 'REQ_X', mlro)).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing requestId', async () => {
      await expect(service.openForSanction('CNMR', 'CU_X', 'REF', new Date(), '', mlro)).rejects.toThrow(BadRequestException);
    });

    it('rejects a compliance officer (family-exclusive: openForSanction opens AML types only)', async () => {
      await expect(service.openForSanction('CNMR', 'CU_X', 'REF', new Date(), 'REQ_X', ops)).rejects.toThrow(ForbiddenException);
    });

    it('propagates the caller-supplied requestId onto the FILING_OPENED audit write verbatim (not auto-minted) — ties the sanction disposition and the filing write together', async () => {
      const anchorAt = new Date('2026-09-24T09:00:00.000Z');
      const requestId = `REQ_SANCTION_${randomUUID()}`;
      const { filingNo } = await service.openForSanction('CNMR', 'CU_SANCTION_3', 'EOCN_LIST_ENTRY_3', anchorAt, requestId, mlro);
      createdFilingNos.push(filingNo);
      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].primarySubjectNo === filingNo);
      expect(call[0].requestId).toBe(requestId);
      expect(call[0].action).toBe('FILING_OPENED');
      const customerSubject = call[0].subjects.find((s: any) => s.subjectType === 'CUSTOMER');
      expect(customerSubject).toMatchObject({ subjectNo: 'CU_SANCTION_3', subjectRole: 'OWNER' });
    });
  });

  // ── T3 ④：computeDeadline EXTERNAL 分支 + 手工开单不传锚留 null（不杜撰）───────
  describe('computeDeadline EXTERNAL branch (manual open vs. workflow-anchored open)', () => {
    it('openManual on an EXTERNAL-anchor type (CNMR) leaves deadlineAt null — no anchorAt to compute from, not fabricated', async () => {
      const filingNo = await openAmlDraftFiling('CNMR');
      const row = await service.findByNo(filingNo);
      expect(row.deadlineAt).toBeNull();
      expect(row.externalCaseRef).not.toBeNull();
    });

    // 回归断言（T3 交付要求）：GENERAL 族既有小时钟行为零漂移——EXTERNAL 分支的加入
    // 不改变 REG_INFO_REQUEST_RESPONSE 的 receivedAt+48h 既有算法（见上方②描述块的
    // 同名断言；此处只重申回归口径，不重复整条用例）。
    it('regression: GENERAL family hour-clock (REG_INFO_REQUEST_RESPONSE, receivedAt+48h) is unaffected by the EXTERNAL branch', async () => {
      const receivedAt = '2026-09-20T00:00:00.000Z';
      const { filingNo } = await service.openManual({ type: 'REG_INFO_REQUEST_RESPONSE', authority: 'UAE_FIU', receivedAt }, ops);
      createdFilingNos.push(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.deadlineAt?.toISOString()).toBe(new Date(new Date(receivedAt).getTime() + 48 * 3600 * 1000).toISOString());
    });
  });

  // ── T3：openManual 的 requiresExternalCaseRef 缺失即 400 ─────────────────
  describe('openManual — requiresExternalCaseRef gate (STR/SAR/CNMR/PNMR)', () => {
    it.each(['STR', 'SAR', 'CNMR', 'PNMR'])('rejects %s with no externalCaseRef', async (type) => {
      await expect(service.openManual({ type, title: `${type} missing case ref` }, mlro)).rejects.toThrow(BadRequestException);
      await expect(service.openManual({ type, title: `${type} missing case ref` }, mlro)).rejects.toThrow(/externalCaseRef/);
    });

    it.each(['HRC', 'HRCA'])('%s does not require externalCaseRef', async (type) => {
      const { filingNo } = await service.openManual({ type, title: `${type} case` }, mlro);
      createdFilingNos.push(filingNo);
      const row = await service.findByNo(filingNo);
      expect(row.type).toBe(type);
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
          { provide: AccessControlService, useValue: makeAccessControl() },
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

    // T3：AML 族全生命周期走真 assertActionSpec——DRAFT 直达 SUBMITTED（无签发三码）。
    it('walks the AML lifecycle (open→submitted direct from DRAFT→entry→close) without the real assertActionSpec rejecting any code (no signoff codes in the sequence)', async () => {
      const { filingNo } = await realService.openManual({ type: 'STR', title: 'Real-audit AML lifecycle', externalCaseRef: 'CASE_REAL_1' }, mlro);
      createdFilingNos.push(filingNo);
      await realService.markSubmitted(filingNo, { externalRef: `GOAML_REAL_${filingNo}` }, mlro);
      await realService.addEntry(filingNo, { kind: 'RECEIPT_ACK', body: 'goAML receipt' }, mlro);
      await realService.close(filingNo, mlro, 'Real AML close');

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual(['FILING_OPENED', 'FILING_SUBMITTED', 'FILING_ENTRY_LOGGED', 'FILING_CLOSED']);
    });

    // T3：FILING_CLOSED_NO_FILING 的四属性（domain/correlationMode/requiredFields=
    // [noFilingReason]/requiresCausation）真的被 closeNoFiling 的调用点喂对。
    it('walks the no-filing-decision branch (FILING_CLOSED_NO_FILING, requiredFields=[noFilingReason]) without rejection', async () => {
      const { filingNo } = await realService.openManual({ type: 'SAR', title: 'Real-audit no-filing decision', externalCaseRef: 'CASE_REAL_2' }, mlro);
      createdFilingNos.push(filingNo);
      await realService.closeNoFiling(filingNo, 'Reviewed and found no suspicion after all', mlro);

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual(['FILING_OPENED', 'FILING_CLOSED_NO_FILING']);
      const closeEvent = events[1] as any;
      expect(closeEvent.actionDomain).toBe('GOVERNANCE');
      // T3修1（评审黄2）：不只过 assertActionSpec 的顶层字段检查——noFilingReason 得真的
      // 落进 AuditLogEvent.reason 这一真实列（不落库的话审计台的 reason 列查这条事件是空的）。
      expect(closeEvent.reason).toBe('Reviewed and found no suspicion after all');
    });

    // T3：openForSanction 的 FILING_OPENED 走 EXTERNAL 锚 + 调用方显式 requestId，真的
    // 落库且未被 assertActionSpec 拒绝（type 仍是必填顶层字段）。
    it('walks openForSanction (EXTERNAL-anchored CNMR, caller-supplied requestId) without rejection', async () => {
      const anchorAt = new Date('2026-09-24T09:00:00.000Z');
      const requestId = `REQ_REAL_${randomUUID()}`;
      const { filingNo } = await realService.openForSanction('CNMR', 'CU_REAL_SANCTION', 'EOCN_REAL_ENTRY', anchorAt, requestId, mlro);
      createdFilingNos.push(filingNo);

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual(['FILING_OPENED']);
      expect((events[0] as any).requestId).toBe(requestId);
      const row = await realService.findByNo(filingNo);
      expect(row.deadlineAt?.toISOString()).toBe(addBusinessDays(anchorAt, 5).toISOString());
    });
  });
});
