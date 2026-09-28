import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { IncidentStatus as S, IncidentTypes as T, INCIDENT_REPORT_BASES as REPORT_BASES } from './incident.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };

function makeService(o: Partial<Record<'incidentRow' | 'disposition' | 'kase' | 'transfer' | 'adjustment' | 'adjustments' | 'deposit' | 'remediations' | 'notes' | 'listRows' | 'listTotal' | 'heldMarkers' | 'filingsSummary', any>> = {}) {
  const incidentRow = o.incidentRow ?? {
    id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.REGISTERED,
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
  // 甲波一 T5 修2（复审新 Important：族区分性质零红测）：mock 必须按 code 参数真判断，
  // 不能无脑放行——否则把 assertOperator 的实参改成常量、或把注册表某族的 marker 码改错，
  // 176 条测试照样全绿（自证型绿灯）。默认持有 'cap.incident.funds'（存量三类的码）——
  // 大多数既有用例走存量类型，不需要逐个显式喂；新族类型的用例必须显式传 heldMarkers
  // 覆盖成该族自己的码，否则会在 assertOperator 这一步就被拦下（而不是走到它们真正想测的
  // 锚校验/状态机分支）。
  const accessControl: any = {
    hasPermission: jest.fn(async (_userId: string, code: string) => (o.heldMarkers ?? ['cap.incident.funds']).includes(code)),
  };
  // 甲波二 T6：getView 横向只读 RegulatoryFilingService.summaryForIncident（铁律③读放行）——
  // 事故自己不再存 reportedAt/reportDeadlineAt 等六列，通报现状改查报送单主体。
  const filings: any = { summaryForIncident: jest.fn(async () => o.filingsSummary ?? []) };
  const svc = new IncidentService(prisma, auditLogs, accessControl, filings);
  return { svc, prisma, auditLogs, accessControl, filings, incidentRow };
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

  describe('register — MANUAL retired / audit envelope', () => {
    it('missing title/description → 400 (checked before the type switch, any type hits it)', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: T.CLIENT_SHORTFALL, title: '', description: 'd' } as any, ops)).rejects.toThrow(BadRequestException);
    });

    // 甲波一 T2：MANUAL 退役——switch 不再有它的分支，落 default → 400（brief 要求确认）。
    it('MANUAL is retired: falls to default → 400 Unknown incident type', async () => {
      const { svc } = makeService();
      await expect(svc.register({ type: 'MANUAL', title: 't', description: 'd' } as any, ops)).rejects.toThrow(/Unknown incident type/);
    });

    it('happy path (CLIENT_SHORTFALL, minimal DTO): generates an INC number, REGISTERED, audit type top-level + correlationId=traceId', async () => {
      const { svc, prisma, auditLogs } = makeService();
      const r = await svc.register({ type: T.CLIENT_SHORTFALL, title: 'Service disruption', description: 'Custodian security notice', customerNo: 'CU1', amount: '900' }, ops);
      expect(r.incidentNo).toMatch(/^INC\d+/);
      expect(prisma.incident.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: T.CLIENT_SHORTFALL, status: S.REGISTERED, title: 'Service disruption', description: 'Custodian security notice' }),
      }));
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REGISTERED', actionDomain: 'GOVERNANCE', type: T.CLIENT_SHORTFALL, correlationId: r.traceId });
      expect(call.requestId).toMatch(/^INCIDENT_REGISTERED_/);
    });
  });

  // 甲波一 T5（高危面）：新七类走注册表锚键校验 + 经办桶断言（服务层，路由层五桶 OR
  // 只做粗门，见 task-5-brief）。四条测试逐字落地 brief Step 1（修1 Ruling-6 起改吃
  // hasPermission mock；修2 起 mock 真按 code 判断，见 heldMarkers）。
  describe('register — wave1 new types: registry anchors + operator capability assertion (Task 5, 修1 C1/I3, 修2 族区分)', () => {
    const dpoActor = { actorType: 'ADMIN' as const, userId: 'uuid-dpo', userNo: 'ADM-DPO', roleCodes: ['DPO'] };
    const treasuryActor = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TREASURY', roleCodes: ['TREASURY_OFFICER'] };
    const techActor = { actorType: 'ADMIN' as const, userId: 'uuid-tech', userNo: 'ADM-TECH', roleCodes: ['TECH_OFFICER'] };
    const validCyberDto = { type: T.CYBER_BCDR, title: 't', description: 'd', subjectRefs: { affectedSystem: 'core-ledger', bcdrTriggered: false } };

    it('rejects DATA_BREACH registration missing affectedCustomerCount', async () => {
      const { svc } = makeService({ heldMarkers: ['cap.incident.data'] });
      await expect(svc.register({ type: 'DATA_BREACH', title: 't', description: 'd',
        subjectRefs: { dataCategories: 'ID_DOCUMENT' } } as any, dpoActor))
        .rejects.toThrow(/requires anchor "affectedCustomerCount" in subjectRefs/);
    });

    it('rejects registration when actor lacks the family operator capability (create/audit untouched)', async () => {
      // 金库真实持有的是 cap.incident.funds（存量三类），不是 cap.incident.tech——mock 按码真判断，
      // 喂它真实的持有集，而不是"什么都没有"，才证明门确实在按族区分，不是无差别拦截。
      const { svc, prisma, auditLogs, accessControl } = makeService({ heldMarkers: ['cap.incident.funds'] });
      await expect(svc.register(validCyberDto as any, treasuryActor)).rejects.toThrow(ForbiddenException);
      expect(accessControl.hasPermission).toHaveBeenCalledWith(treasuryActor.userId, 'cap.incident.tech');
      expect(prisma.incident.create).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    // 复审 I3（族区分正向）：技术官登记 CYBER_BCDR——断言 hasPermission 真的是拿
    // 'cap.incident.tech'（该类型的 operatorMarkerCode）去查，不是拿常量或别的族的码。
    it('registers CYBER_BCDR with anchors persisted into subjectRefs (tech officer, positive: hasPermission called with cap.incident.tech)', async () => {
      const { svc, prisma, accessControl } = makeService({ heldMarkers: ['cap.incident.tech'] });
      const r = await svc.register(validCyberDto as any, techActor);
      expect(r.incidentNo).toMatch(/^INC/);
      expect(accessControl.hasPermission).toHaveBeenCalledWith(techActor.userId, 'cap.incident.tech');
      const createCall = prisma.incident.create.mock.calls[0][0];
      expect(JSON.parse(createCall.data.subjectRefs)).toMatchObject({ affectedSystem: 'core-ledger', bcdrTriggered: false });
    });

    // 战役甲波五 T4：MANUAL 仍落 default → getIncidentTypeConfig 抛"unknown"；COMPLAINT_ESCALATION
    // 现已 enabled，但 register()（人工登记入口）显式拒绝清单挡在 getIncidentTypeConfig 之前——
    // 门不可绕，手工登记拒绝清单本身是演示内容。actor 持 cap.incident.ops（若门缺失会被
    // assertOperator 放行、误判"门在生效"，故显式喂它持有该族权限，证明挡的是清单本身）。
    it('register() (manual entry): MANUAL is unknown, COMPLAINT_ESCALATION is explicitly blocked (create/audit untouched)', async () => {
      const { svc, prisma, auditLogs } = makeService({ heldMarkers: ['cap.incident.ops'] });
      await expect(svc.register({ type: 'MANUAL', title: 't', description: 'd' } as any, ops)).rejects.toThrow(BadRequestException);
      await expect(svc.register({ type: T.COMPLAINT_ESCALATION, title: 't', description: 'd' } as any, ops))
        .rejects.toThrow(/cannot be registered manually/);
      expect(prisma.incident.create).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });
  });

  // 战役甲波五 T4：投诉升级专用入口——register() 的人工登记拒绝清单不适用于它
  // （门只挡人工登记，不挡 workflow 编排的内部落库路径）。
  describe('registerFromComplaint (Task 4: complaint escalation internal entry)', () => {
    const complaintDto = { complaintNo: 'CMP260101000001', ownerCustomerNo: 'CU1', title: 'Complaint escalation — CMP260101000001', description: 'Order disputed, escalating' };

    it('creates a COMPLAINT_ESCALATION incident: customerNo from ownerCustomerNo (top-level column), complaintNo anchored in subjectRefs, audit reuses INCIDENT_REGISTERED with complaintNo in metadata', async () => {
      const { svc, prisma, auditLogs, accessControl } = makeService({ heldMarkers: ['cap.incident.ops'] });
      const r = await svc.registerFromComplaint(ops, complaintDto);
      expect(r.incidentNo).toMatch(/^INC/);
      expect(accessControl.hasPermission).toHaveBeenCalledWith(ops.userId, 'cap.incident.ops');

      const createCall = prisma.incident.create.mock.calls[0][0];
      expect(createCall.data.type).toBe(T.COMPLAINT_ESCALATION);
      expect(createCall.data.customerNo).toBe('CU1');
      expect(JSON.parse(createCall.data.subjectRefs)).toEqual({ complaintNo: 'CMP260101000001' });

      const auditCall = auditLogs.recordByActor.mock.calls[0][0];
      expect(auditCall.action).toBe('INCIDENT_REGISTERED');
      expect(auditCall.metadata.complaintNo).toBe('CMP260101000001');
    });

    it('rejects when the operator lacks cap.incident.ops (door still guards the internal entry)', async () => {
      const { svc, prisma } = makeService({ heldMarkers: ['cap.incident.funds'] });
      await expect(svc.registerFromComplaint(ops, complaintDto)).rejects.toThrow(ForbiddenException);
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });

    it('rejects when a required field is missing', async () => {
      const { svc } = makeService({ heldMarkers: ['cap.incident.ops'] });
      await expect(svc.registerFromComplaint(ops, { ...complaintDto, ownerCustomerNo: '' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  // 甲波一 T5 修1（Ruling-8，I2 修复）：requiredAnchors 里与存量列同名的键
  // （assetCode/customerNo/amount）必须从 DTO 顶层读、落存量列——不许塞进 subjectRefs。
  // ASSET_NONCOMPLIANCE/STUCK_TRANSACTION_MAJOR 都是 OPERATIONS 族（cap.incident.ops），
  // assertOperator 先于锚校验跑，故本描述块所有用例都要喂 heldMarkers: ['cap.incident.ops']。
  describe('register — same-name anchors are sourced from the DTO top level, not subjectRefs (Task 5 修1 I2)', () => {
    it('ASSET_NONCOMPLIANCE: assetCode anchor sourced from top-level field, persisted to the assetCode column (not subjectRefs)', async () => {
      const { svc, prisma } = makeService({ heldMarkers: ['cap.incident.ops'] });
      const r = await svc.register({ type: T.ASSET_NONCOMPLIANCE, title: 't', description: 'd', assetCode: 'USDT-TRON' } as any, ops);
      expect(r.incidentNo).toMatch(/^INC/);
      const createCall = prisma.incident.create.mock.calls[0][0];
      expect(createCall.data.assetCode).toBe('USDT-TRON');
      expect(createCall.data.subjectRefs).toBeNull();
    });

    it('ASSET_NONCOMPLIANCE: assetCode only in subjectRefs (not top-level) still counts as missing → 400 "missing required field" (Ruling-8 修订, 小修b)', async () => {
      const { svc } = makeService({ heldMarkers: ['cap.incident.ops'] });
      await expect(svc.register({ type: T.ASSET_NONCOMPLIANCE, title: 't', description: 'd', subjectRefs: { assetCode: 'USDT-TRON' } } as any, ops))
        .rejects.toThrow(/missing required field assetCode/);
    });

    it('STUCK_TRANSACTION_MAJOR: customerNo/amount from top level, orderNo from subjectRefs', async () => {
      const { svc, prisma } = makeService({ heldMarkers: ['cap.incident.ops'] });
      const r = await svc.register({ type: T.STUCK_TRANSACTION_MAJOR, title: 't', description: 'd', customerNo: 'CU1', amount: '100', subjectRefs: { orderNo: 'ORD1' } } as any, ops);
      expect(r.incidentNo).toMatch(/^INC/);
      const createCall = prisma.incident.create.mock.calls[0][0];
      expect(createCall.data.customerNo).toBe('CU1');
      expect(createCall.data.amount.toString()).toBe('100');
      expect(JSON.parse(createCall.data.subjectRefs)).toEqual({ orderNo: 'ORD1' });
    });

    it('STUCK_TRANSACTION_MAJOR: missing top-level customerNo → 400 "missing required field customerNo" (orderNo present in subjectRefs does not paper over it)', async () => {
      const { svc } = makeService({ heldMarkers: ['cap.incident.ops'] });
      await expect(svc.register({ type: T.STUCK_TRANSACTION_MAJOR, title: 't', description: 'd', amount: '100', subjectRefs: { orderNo: 'ORD1' } } as any, ops))
        .rejects.toThrow(/missing required field customerNo/);
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
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.WITHDRAWN } });
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
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING } });
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
      const { svc } = makeService({ adjustment: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('TRANSFER not found → 404', async () => {
      const { svc } = makeService({ transfer: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'TRANSFER', referenceNo: 'ITR1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('SUPPLEMENT not found → 404', async () => {
      const { svc } = makeService({ deposit: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'SUPPLEMENT', referenceNo: 'DEP1' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('CLAIM not found → 404', async () => {
      const { svc } = makeService({ deposit: null, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED } });
      await expect(svc.linkRemediation('INC1', { kind: 'CLAIM', referenceNo: 'DEP2' }, ops)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('happy path: ADJUSTMENT exists → linked + audit referenceNo top-level', async () => {
      const { svc, prisma, auditLogs } = makeService({ adjustment: { adjustmentNo: 'ADJ1' }, incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING } });
      await svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops);
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }) });
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'ADJ1' });
    });
  });

  describe('linkRemediation — link status guard + transition carrier (Task 7 fix: the gap where ASSESSED→RESOLVING was never triggered)', () => {
    it('linking while ASSESSED → status advances to RESOLVING + link succeeds + audit metadata.statusAdvanced', async () => {
      const { svc, prisma, auditLogs } = makeService({
        adjustment: { adjustmentNo: 'ADJ1' },
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED },
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
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING },
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
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.REGISTERED } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
    });

    it('linking while INVESTIGATING → 400 (not assessed yet, remediation cannot be linked)', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING } });
      await expect(svc.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
    });
  });

  // 战役甲波一 Task 7：处置动作白名单 +2——每类型按注册表 allowedRemediationKinds 收窄
  // linkRemediation 可挂的 kind；ASSET_SUSPENSION_REF/CUSTOMER_NOTICE_LOGGED 不校验引用是否
  // 真存在（brief 行为合同）。
  describe('linkRemediation — allowedRemediationKinds whitelist (Task 7 +2)', () => {
    it('CYBER_BCDR (allowedRemediationKinds: []) + SUPPLEMENT → 400, no create/audit', async () => {
      const { svc, prisma, auditLogs } = makeService({
        heldMarkers: ['cap.incident.tech'],
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CYBER_BCDR, status: S.ASSESSED },
      });
      await expect(svc.linkRemediation('INC1', { kind: 'SUPPLEMENT', referenceNo: 'DEP1' }, ops)).rejects.toThrow(BadRequestException);
      expect(prisma.incidentRemediation.create).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('ASSET_NONCOMPLIANCE + ASSET_SUSPENSION_REF → linked (no existence lookup) + audit metadata.kind', async () => {
      const { svc, prisma, auditLogs } = makeService({
        heldMarkers: ['cap.incident.ops'],
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.ASSET_NONCOMPLIANCE, status: S.ASSESSED },
      });
      await svc.linkRemediation('INC1', { kind: 'ASSET_SUSPENSION_REF', referenceNo: 'APR-SUSP-1' }, ops);
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'ASSET_SUSPENSION_REF', referenceNo: 'APR-SUSP-1' }),
      });
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_REMEDIATION_LINKED', referenceNo: 'APR-SUSP-1' });
      expect(call.metadata).toMatchObject({ kind: 'ASSET_SUSPENSION_REF' });
    });

    it('regression: UNAUTHORIZED_OUTFLOW (存量四钱单) + TRANSFER still passes the whitelist', async () => {
      const { svc, prisma } = makeService({
        transfer: { transferNo: 'ITR1' },
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.UNAUTHORIZED_OUTFLOW, status: S.ASSESSED },
      });
      await svc.linkRemediation('INC1', { kind: 'TRANSFER', referenceNo: 'ITR1' }, ops);
      expect(prisma.incidentRemediation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ incidentId: 'uuid-inc', kind: 'TRANSFER', referenceNo: 'ITR1' }),
      });
    });
  });

  describe('one audit entry per action (recordByActor + explicit requestId)', () => {
    it('register/startInvestigation/addNote/escalate/withdraw/linkRemediation each call recordByActor exactly once', async () => {
      const { svc: s1, auditLogs: a1 } = makeService();
      await s1.register({ type: T.CLIENT_SHORTFALL, title: 't', description: 'd', customerNo: 'CU1', amount: '900' }, ops);
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
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED },
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
      expect(Object.keys(REPORT_BASES)).toEqual([
        'TIR_K_H', 'CRM_IV_E_5', 'CRM_V_D_2', 'PDPL_ART_9', 'TIR_II_C_24H', 'COMPANY_IV_H_1', 'COMPANY_VI_C_F',
      ]);
    });
  });

  describe('assess — assessment + basis codes + 72h countdown (Task 6)', () => {
    it('only allowed from INVESTIGATING (400)', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.REGISTERED, createdAt: new Date('2026-09-01T00:00:00.000Z') } });
      await expect(svc.assess('INC1', { assessedAmount: '100', assessmentBasis: 'NO_LOSS', reportRequired: false }, ops)).rejects.toThrow(/Illegal incident status transition/);
    });

    it('missing assessedAmount/assessmentBasis → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '', assessmentBasis: 'NO_LOSS', reportRequired: false } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportRequired=true but reportBasisCodes is empty → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: [] }, ops)).rejects.toThrow(BadRequestException);
    });

    it('reportBasisCodes contains a code outside the directory → 400', async () => {
      const { svc } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING, createdAt: new Date() } });
      await expect(svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: ['NOT_A_BASIS'] }, ops)).rejects.toThrow(BadRequestException);
    });

    // 甲波二 T6：钟锚计算已随 reportDeadlineAt 列一并迁到 RegulatoryFilingService.
    // openForIncident/computeDeadline（Task 3，见 regulatory-filing.service.spec.ts），
    // IncidentService.assess 不再落这一列、也不再回传它——本描述块下方四条保留的是
    // assess() 自己仍要管的事：按类型收窄 reportBasisCandidates、basisCodes 落库、
    // 状态机与审计。
    //
    // 甲波一 T6：改用 STUCK_TRANSACTION_MAJOR（reportBasisCandidates=['TIR_K_H']）——
    // CLIENT_SHORTFALL 的候选集只有 ['CRM_IV_E_5','CRM_V_D_2']，勾 TIR_K_H 在新增的口径②
    // （reportBasisCodes ⊆ cfg.reportBasisCandidates）下会变成 400，原用例的类型/码组合
    // 已不成立，换一个合法组合延续同一断言意图（审计顶层 assessmentBasis）。
    it('happy path: STUCK_TRANSACTION_MAJOR + TIR_K_H accepted → ASSESSED + basisCodes persisted + audit top-level assessmentBasis', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma, auditLogs } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.STUCK_TRANSACTION_MAJOR, status: S.INVESTIGATING, createdAt },
        heldMarkers: ['cap.incident.ops'],
      });
      const r = await svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: ['TIR_K_H'] }, ops);
      expect(r.status).toBe(S.ASSESSED);
      expect(r).not.toHaveProperty('reportDeadlineAt');
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(S.ASSESSED);
      expect(updateCall.data.reportBasisCodes).toBe('TIR_K_H');
      expect(updateCall.data).not.toHaveProperty('reportDeadlineAt');
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_ASSESSED', assessmentBasis: 'FIRM_LOSS', fromStatus: S.INVESTIGATING, toStatus: S.ASSESSED });
    });

    it('selecting a clockless basis (CRM_IV_E_5) → reportBasisCodes persists, assess does not compute a deadline at all', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING, createdAt } });
      await svc.assess('INC1', { assessedAmount: '5000', assessmentBasis: 'CLIENT_COLLECTION', reportRequired: true, reportBasisCodes: ['CRM_IV_E_5'] }, ops);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportBasisCodes).toBe('CRM_IV_E_5');
      expect(updateCall.data).not.toHaveProperty('reportDeadlineAt');
    });

    it('reportRequired=false → reportBasisCodes persists as null', async () => {
      const { svc, prisma } = makeService({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING, createdAt: new Date() } });
      await svc.assess('INC1', { assessedAmount: '0', assessmentBasis: 'RECOVERED', reportRequired: false }, ops);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportRequired).toBe(false);
      expect(updateCall.data.reportBasisCodes).toBeNull();
    });

    // 甲波一 T6（brief 行为合同①②③④）：三档口径按类型 assessmentScheme 收窄 + 码候选集过滤
    // + 钟链码不入 deadline。五条：四条新行为 + 一条存量回归锚。
    it('ASSET_NONCOMPLIANCE (empty reportBasisCandidates) — checking any basis code → 400 (behavior contract ②, empty candidate set)', async () => {
      const { svc } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.ASSET_NONCOMPLIANCE, status: S.INVESTIGATING, createdAt: new Date() },
        heldMarkers: ['cap.incident.ops'],
      });
      await expect(svc.assess('INC1', {
        assessmentBasis: 'SERVICE_IMPACT', impactSummary: 'Asset suspended pending review',
        reportRequired: true, reportBasisCodes: ['TIR_K_H'],
      }, ops)).rejects.toThrow(BadRequestException);
    });

    it('DATA_BREACH — checking both PDPL_ART_9 and TIR_II_C_24H (chainStart=NOTICE) → both basis codes accepted and persisted, no deadline column touched', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.DATA_BREACH, status: S.INVESTIGATING, createdAt },
        heldMarkers: ['cap.incident.data'],
      });
      // 目录条目本身携带 chainStart='NOTICE'（钟链起点是通知发出，不是本次定损起算点）——
      // 该语义只影响 RegulatoryFilingService.computeDeadline（Task 3），本文件不重测。
      expect(REPORT_BASES.TIR_II_C_24H.chainStart).toBe('NOTICE');
      expect(REPORT_BASES.TIR_II_C_24H.hours).toBe(24);
      const r = await svc.assess('INC1', {
        assessmentBasis: 'DATA_IMPACT', impactSummary: 'Customer PII exposed',
        reportRequired: true, reportBasisCodes: ['PDPL_ART_9', 'TIR_II_C_24H'],
      }, ops);
      expect(r.status).toBe(S.ASSESSED);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportBasisCodes).toBe('PDPL_ART_9,TIR_II_C_24H');
      expect(updateCall.data).not.toHaveProperty('reportDeadlineAt');
    });

    it('CYBER_BCDR — checking TIR_K_H → accepted and persisted (behavior contract ③, deadline computation lives in RegulatoryFilingService now)', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CYBER_BCDR, status: S.INVESTIGATING, createdAt },
        heldMarkers: ['cap.incident.tech'],
      });
      const r = await svc.assess('INC1', {
        assessmentBasis: 'SERVICE_IMPACT', impactSummary: 'Trading platform outage',
        reportRequired: true, reportBasisCodes: ['TIR_K_H'],
      }, ops);
      expect(r.status).toBe(S.ASSESSED);
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.reportBasisCodes).toBe('TIR_K_H');
      expect(updateCall.data).not.toHaveProperty('reportDeadlineAt');
    });

    it('PRUDENTIAL_BREACH — SHORTFALL scheme missing assessedAmount → 400 (behavior contract ④)', async () => {
      const { svc } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.PRUDENTIAL_BREACH, status: S.INVESTIGATING, createdAt: new Date() },
        heldMarkers: ['cap.incident.fin'],
      });
      await expect(svc.assess('INC1', { assessmentBasis: 'SHORTFALL', reportRequired: false } as any, ops)).rejects.toThrow(BadRequestException);
    });

    it('regression anchor: legacy UNAUTHORIZED_OUTFLOW MONETARY scheme still assesses cleanly under the new type-scoped rules', async () => {
      const createdAt = new Date('2026-09-01T00:00:00.000Z');
      const { svc, prisma, auditLogs } = makeService({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.UNAUTHORIZED_OUTFLOW, status: S.INVESTIGATING, createdAt },
      });
      const r = await svc.assess('INC1', {
        assessedAmount: '2500', assessmentBasis: 'FIRM_LOSS', reportRequired: true, reportBasisCodes: ['CRM_IV_E_5'],
      }, ops);
      expect(r.status).toBe(S.ASSESSED);
      expect(r).not.toHaveProperty('reportDeadlineAt'); // 甲波二 T6：钟锚计算已迁到 RegulatoryFilingService
      const updateCall = prisma.incident.update.mock.calls[0][0];
      expect(updateCall.data.assessmentBasis).toBe('FIRM_LOSS');
      expect(updateCall.data.assessedAmount.toString()).toBe('2500');
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ action: 'INCIDENT_ASSESSED', assessmentBasis: 'FIRM_LOSS' });
    });
  });

  // 甲波二 T6：saveReportDraft/markReported 整体退役——事故不再自己收草案/落已通报，
  // 通报改统一走报送单主体（RegulatoryFilingService.saveDraft/markSubmitted，Task 3，
  // 已在 regulatory-filing.service.spec.ts 覆盖同款「首次记审计/续存不重记」「前置校验」
  // 行为），本文件不再保留这两个 describe。

  // 甲波一 T5 修1（Ruling-6/7，I3 修复；甲波二 T6 更新）：入口失效验证——覆盖
  // investigation/notes/escalate/assess/remediations/withdraw 六个入口（register 在上面
  // 自己的 describe 里已断言 create/审计未调；close 走 requestClose，在
  // incident-close-workflow.service.spec.ts 单独断言 createAndSubmit 未调）。预铺一条
  // CYBER_BCDR 行，hasPermission mock 返回 false，断言抛 Forbidden 且相应的 create/update
  // 均未被调。失效验证证据（先证红）见 task-5-report.md：临时注掉 IncidentService 六处
  // assertOperatorForIncident 调用，本 it.each 全红；恢复后全绿。
  describe('ten-gate failure mode: Forbidden closes the door before any write (甲波一T5修1 I3)', () => {
    const cyberRow = {
      id: 'uuid-cyber', incidentNo: 'INC-CYBER', type: T.CYBER_BCDR, status: S.INVESTIGATING,
      createdAt: new Date('2026-09-01T00:00:00.000Z'), reportRequired: false,
    };

    const cases: Array<[string, (svc: IncidentService) => Promise<unknown>, (prisma: any) => void]> = [
      ['startInvestigation', (svc) => svc.startInvestigation('INC-CYBER', ops), (prisma) => expect(prisma.incident.update).not.toHaveBeenCalled()],
      ['addNote', (svc) => svc.addNote('INC-CYBER', 'note body', ops), (prisma) => expect(prisma.incidentNote.create).not.toHaveBeenCalled()],
      ['escalate', (svc) => svc.escalate('INC-CYBER', { to: 'MLRO', note: 'x' }, ops), (prisma) => expect(prisma.incidentNote.create).not.toHaveBeenCalled()],
      ['assess', (svc) => svc.assess('INC-CYBER', { assessedAmount: '10', assessmentBasis: 'NO_LOSS', reportRequired: false }, ops), (prisma) => expect(prisma.incident.update).not.toHaveBeenCalled()],
      ['linkRemediation', (svc) => svc.linkRemediation('INC-CYBER', { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' }, ops), (prisma) => expect(prisma.incidentRemediation.create).not.toHaveBeenCalled()],
      ['withdraw', (svc) => svc.withdraw('INC-CYBER', 'Registered in error', ops), (prisma) => expect(prisma.incident.update).not.toHaveBeenCalled()],
    ];

    it.each(cases)('%s: actor lacks operator capability → Forbidden, no write, no audit', async (_name, invoke, assertWriteUntouched) => {
      const { svc, prisma, auditLogs } = makeService({ incidentRow: cyberRow, heldMarkers: [] });
      await expect(invoke(svc)).rejects.toThrow(ForbiddenException);
      assertWriteUntouched(prisma);
      expect(prisma.incident.create).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
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
        incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.REGISTERED, title: 't',
        customerNo: null, assetCode: null, amount: null, sourceCaseNo: null,
        reportRequired: false, createdAt,
      };
      const { svc, prisma } = makeService({ listRows: [row], listTotal: 1 });
      const r = await svc.list({ status: S.REGISTERED, take: 10, skip: 0 });
      expect(r.total).toBe(1);
      expect(r.items).toEqual([{
        incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.REGISTERED, title: 't',
        customerNo: null, assetCode: null, amount: null, sourceCaseNo: null,
        reportRequired: false, createdAt: createdAt.toISOString(),
      }]);
      expect(prisma.incident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: S.REGISTERED }, skip: 0, take: 10 }));
      expect((prisma.incident.findMany.mock.calls[0][0] as any).where).not.toHaveProperty('id');
    });

    // 甲波二 T6：单槽六列（reportDeadlineAt/reportDraft/reportDraftedAt/reportedAt/
    // reportedByUserId/reportReference）退役——getView 改横向只读
    // RegulatoryFilingService.summaryForIncident 投影通报现状，挂 filings 键。
    it('getView: entity fields + notes + remediations + filings summary, zero id/incidentId', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING,
        title: 't', description: 'd', customerNo: null, sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, assetCode: null, amount: null,
        assessedAmount: null, assessmentBasis: null, reportRequired: true, reportBasisCodes: 'CRM_IV_E_5',
        approvalNo: null, registeredByUserId: 'ADM-OPS',
        closedAt: null, withdrawnReason: null, createdAt,
      };
      const notes = [{ kind: 'NOTE', escalatedTo: null, body: 'Logged a note', authorUserId: 'ADM-OPS', createdAt }];
      const remediations = [{ kind: 'ADJUSTMENT', referenceNo: 'ADJ1', linkedByUserId: 'ADM-OPS', createdAt }];
      const adjustments = [{ adjustmentNo: 'ADJ1', status: 'POSTED' }];
      const filingsSummary = [{
        filingNo: 'FIL1', status: 'SUBMITTED', authority: 'VARA', basisCode: 'CRM_IV_E_5',
        deadlineAt: null, overdueMarkedAt: null, submittedAt: '2026-09-26T00:00:00.000Z',
      }];
      const { svc, filings } = makeService({ incidentRow, notes, remediations, adjustments, filingsSummary });
      const view = await svc.getView('INC1');
      expect(view.incidentNo).toBe('INC1');
      expect(view.notes).toEqual([{ kind: 'NOTE', escalatedTo: null, body: 'Logged a note', authorBy: 'ADM-OPS', createdAt: createdAt.toISOString() }]);
      // Task 12：ADJUSTMENT 善后单要带上调账单现状——事故页「发起补款」按钮据此判断
      // 「已落账（POSTED）」，remediations 表本身不存这个会过期的状态快照。
      expect(view.remediations).toEqual([{ kind: 'ADJUSTMENT', referenceNo: 'ADJ1', linkedBy: 'ADM-OPS', createdAt: createdAt.toISOString(), status: 'POSTED' }]);
      expect(view.filings).toEqual(filingsSummary);
      expect(filings.summaryForIncident).toHaveBeenCalledWith('INC1');
      expect(view).not.toHaveProperty('id');
      expect(view).not.toHaveProperty('reportDeadlineAt');
      expect(view).not.toHaveProperty('reportedAt');
      expect(JSON.stringify(view)).not.toContain('uuid-inc');
    });

    it('getView: a non-ADJUSTMENT remediation does not query adjustment status, status is always null', async () => {
      const incidentRow = {
        id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING,
        title: 't', description: 'd', customerNo: null, sourceCaseNo: null, sourceDispositionNo: null,
        sourceAdvanceTransferNo: null, assetCode: null, amount: null,
        assessedAmount: null, assessmentBasis: null, reportRequired: false, reportBasisCodes: null,
        approvalNo: null, registeredByUserId: 'ADM-OPS',
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

describe('INCIDENT_REPORT_BASES catalog (wave1)', () => {
  it('carries the four new obligation codes with correct clock semantics', () => {
    expect(REPORT_BASES.PDPL_ART_9.hours).toBeNull();
    expect(REPORT_BASES.PDPL_ART_9.immediate).toBeUndefined();
    expect(REPORT_BASES.TIR_II_C_24H.hours).toBe(24);
    // 甲波一 T6：钟链起点是通知发出而非定损时刻——本码不参与钟锚计算（甲波二 T6：该计算
    // 已迁到 RegulatoryFilingService.computeDeadline，事故自己不再落这只钟）。
    expect(REPORT_BASES.TIR_II_C_24H.chainStart).toBe('NOTICE');
    expect(REPORT_BASES.TIR_K_H.chainStart).toBeUndefined();
    expect(REPORT_BASES.COMPANY_IV_H_1.immediate).toBe(true);
    expect(REPORT_BASES.COMPANY_IV_H_1.hours).toBeNull();
    expect(REPORT_BASES.COMPANY_VI_C_F.immediate).toBe(true);
  });
  it('TIR_K_H remains a single 72h obligation covering both cyber and stuck-order triggers', () => {
    expect(REPORT_BASES.TIR_K_H.hours).toBe(72);
    expect(REPORT_BASES.TIR_K_H.label).toContain('72');
  });
});
