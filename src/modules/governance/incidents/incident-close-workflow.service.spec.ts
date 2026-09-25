import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IncidentCloseWorkflowService } from './incident-close-workflow.service';
import { IncidentStatus as S, IncidentTypes as T } from './incident.constants';

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TRS', roleCodes: ['TREASURY_OFFICER'] };

function makeWorkflow(o: Partial<Record<'incidentRow' | 'remediations', any>> = {}) {
  const incidentRow = o.incidentRow ?? {
    id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED,
    assessmentBasis: 'NO_LOSS', assessedAmount: null, reportRequired: false, reportedAt: null,
    customerNo: 'CU1', sourceCaseNo: 'REC1', traceId: 'trace-1',
  };
  const remediations = o.remediations ?? [];
  const incidents: any = {
    findByNo: jest.fn(async () => incidentRow),
    // 甲波一 T5 连锁修复：requestClose 现在复用 IncidentService.assertOperator（经办桶
    // 断言）——本文件测的是结案编排本身（Task 7），不重测断言行为（那是
    // incident.service.spec.ts 的职责），故恒放行。
    assertOperator: jest.fn(async () => undefined),
    findRemediations: jest.fn(async () => remediations),
    markCloseRequested: jest.fn(async () => undefined),
    close: jest.fn(async () => ({ incidentNo: incidentRow.incidentNo, status: S.CLOSED })),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'AC1' })) };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  const wf = new IncidentCloseWorkflowService(incidents, approvals, auditLogs);
  return { wf, incidents, approvals, auditLogs, incidentRow };
}

describe('IncidentCloseWorkflowService (Task 7)', () => {
  describe('requestClose — preconditions', () => {
    it('REGISTERED → 400 (mutation target 1: removing this guard must turn this case red)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.REGISTERED, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(BadRequestException);
    });

    it('INVESTIGATING → 400 (mutation target 1)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.INVESTIGATING, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(BadRequestException);
    });

    it('CLOSED (already terminal) → 400', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.CLOSED, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(BadRequestException);
    });

    // 战役甲波一 T8 修复轮 1（评审 M5）：WITHDRAWN 此前没有专属用例——只被 CLOSED 那条覆盖到
    // "终态一律拒绝"的笼统断言，没验证 WITHDRAWN 走的是它自己的分支（不同文案，见 :83-85）。
    it('WITHDRAWN → 400, distinct branch/message from CLOSED (T8 修复轮 1 M5)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.WITHDRAWN, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/has been withdrawn/);
    });

    it('ASSESSED but assessment basis is not NO_LOSS → 400 (must enter Resolving first)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED, assessmentBasis: 'FIRM_LOSS', traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/enter Resolving/);
    });

    it('ASSESSED and NO_LOSS but already has remediation linked → 400', async () => {
      const { wf } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', traceId: 't' },
        remediations: ['ADJ1'],
      });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/enter Resolving/);
    });

    it('ASSESSED + NO_LOSS + zero remediation → allowed (the CLOSE_NO_ACTION path)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', reportRequired: false, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
    });

    it('RESOLVING → allowed (assessmentBasis/remediation links are not checked)', async () => {
      const { wf } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING, assessmentBasis: 'FIRM_LOSS', reportRequired: false, traceId: 't' },
        remediations: ['ADJ1'],
      });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
    });

    it('reportRequired=true but not yet markReported → 400 (cannot close without a reporting trace)', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING, reportRequired: true, reportedAt: null, traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/regulator reporting/);
    });

    it('reportRequired=true and already markReported → allowed', async () => {
      const { wf } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING, reportRequired: true, reportedAt: new Date(), traceId: 't' } });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
    });

    // 甲波一 T5 修1（Ruling-7/I3 修复）：close 是十入口第 7 个——assertOperator 拒绝时，
    // 结案入口必须在提交审批之前就短路，不许先造出一份审批实例再拒绝。
    it('actor lacks the operator capability → Forbidden, createAndSubmit untouched (十门失效验证之close)', async () => {
      const { wf, incidents, approvals } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING, assessmentBasis: 'NO_LOSS', reportRequired: false, traceId: 't' } });
      incidents.assertOperator.mockRejectedValueOnce(new ForbiddenException('no capability'));
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(ForbiddenException);
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
      expect(incidents.markCloseRequested).not.toHaveBeenCalled();
    });
  });

  // 战役甲波一 Task 8（变异测试点①的常驻化）：三元退役为注册表查链后，十类终盘每一类都要
  // 逐条验证路由到 INCIDENT_TYPE_REGISTRY 里点名的 closeActionType——不再是旧两支判断
  // （UNAUTHORIZED_OUTFLOW→SECURITY，其余全部→FINANCIAL）。CYBER_BCDR 此前被旧三元误判为
  // FINANCIAL，是本任务要修的错（见 incident-type-registry.ts closeActionType 字段）。
  //
  // 战役甲波一 T8 修复轮 1（评审 C1 附带修复）：状态/口径 fixture 改用真实可达组合——
  // allowedRemediationKinds 为空集的四类（CYBER_BCDR/OUTSOURCING_FAILURE/
  // STUCK_TRANSACTION_MAJOR/PRUDENTIAL_BREACH）永远走不到 RESOLVING（唯一入口
  // linkRemediation 会被白名单挡在门外，见 incident.service.ts:455-470），只能用
  // ASSESSED + 该类型真实口径（非 NO_LOSS）；非空白名单类型改用 RESOLVING + 真实口径
  // （不再用不属于该类型 assessmentScheme 的 NO_LOSS 占位）。
  describe('requestClose — type → close action type routing (registry-driven, Task 8; realistic states, T8 修复轮 1)', () => {
    it.each([
      [T.CYBER_BCDR, S.ASSESSED, 'SERVICE_IMPACT', 'INCIDENT_CLOSE_TECHSEC'],
      [T.OUTSOURCING_FAILURE, S.ASSESSED, 'SERVICE_IMPACT', 'INCIDENT_CLOSE_TECHSEC'],
      [T.DATA_BREACH, S.RESOLVING, 'DATA_IMPACT', 'INCIDENT_CLOSE_TECHSEC'],
      [T.ASSET_NONCOMPLIANCE, S.RESOLVING, 'SERVICE_IMPACT', 'INCIDENT_CLOSE_TECHSEC'],
      [T.STUCK_TRANSACTION_MAJOR, S.ASSESSED, 'FIRM_LOSS', 'INCIDENT_CLOSE_FINANCIAL'],
      [T.PRUDENTIAL_BREACH, S.ASSESSED, 'SHORTFALL', 'INCIDENT_CLOSE_PRUDENTIAL'],
      [T.UNAUTHORIZED_OUTFLOW, S.RESOLVING, 'FIRM_LOSS', 'INCIDENT_CLOSE_SECURITY'],
      [T.LARGE_UNEXPLAINED, S.RESOLVING, 'FIRM_LOSS', 'INCIDENT_CLOSE_FINANCIAL'],
      [T.CLIENT_SHORTFALL, S.RESOLVING, 'CLIENT_COLLECTION', 'INCIDENT_CLOSE_FINANCIAL'],
    ])('%s @ %s + %s requests closure via %s', async (type, status, assessmentBasis, expected) => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type, status, assessmentBasis, reportRequired: false, traceId: 't' },
      });
      await wf.requestClose('INC1', treasury);
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe(expected);
    });
  });

  // 战役甲波一 T8 修复轮 1（评审 C1·Critical，裁决 Ruling-10 采乙案）：三条指名行为用例——
  // 改动前（basis===NO_LOSS 才放行）这三条全部先证红（前两条见修复轮 1 报告"先证红"记录，
  // 第三条同理：STUCK_TRANSACTION_MAJOR + FIRM_LOSS 旧逻辑下必然落入"enter Resolving"分支）。
  describe('requestClose — ASSESSED→CLOSED reachability, empty-whitelist types (T8 修复轮 1 C1)', () => {
    it('CYBER_BCDR @ ASSESSED + SERVICE_IMPACT → allowed, generates an INCIDENT_CLOSE_TECHSEC approval (previously unreachable)', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CYBER_BCDR, status: S.ASSESSED, assessmentBasis: 'SERVICE_IMPACT', reportRequired: false, traceId: 't' },
      });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe('INCIDENT_CLOSE_TECHSEC');
    });

    // 乙案语义的守卫测试：DATA_BREACH 的白名单非空（CUSTOMER_NOTICE_LOGGED），不受本次放宽
    // 影响——必须先进 RESOLVING 挂客户通知留痕，不能直接从 ASSESSED 结案。
    it('DATA_BREACH @ ASSESSED + DATA_IMPACT → still rejected (non-empty whitelist: must link CUSTOMER_NOTICE_LOGGED via Resolving first)', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.DATA_BREACH, status: S.ASSESSED, assessmentBasis: 'DATA_IMPACT', reportRequired: false, traceId: 't' },
      });
      await expect(wf.requestClose('INC1', treasury)).rejects.toThrow(/enter Resolving/);
      expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    });

    it('STUCK_TRANSACTION_MAJOR @ ASSESSED + FIRM_LOSS → allowed, generates an INCIDENT_CLOSE_FINANCIAL approval (empty whitelist)', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.STUCK_TRANSACTION_MAJOR, status: S.ASSESSED, assessmentBasis: 'FIRM_LOSS', reportRequired: false, traceId: 't' },
      });
      await expect(wf.requestClose('INC1', treasury)).resolves.toBeDefined();
      expect(approvals.createAndSubmit.mock.calls[0][0].actionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    });
  });

  // 战役甲波一 Task 8 追加指令②：IMPACT/SHORTFALL 口径的人话动词此前缺失，退化成裸
  // assessmentBasis 生码（basisVerb ?? row.assessmentBasis 兜底分支）。补齐后断言摘要里
  // 出现人话短语、不出现生码本身。T8 修复轮 1：CYBER_BCDR/PRUDENTIAL_BREACH 的 fixture 状态
  // 从假 RESOLVING（当时未察觉该状态对这两类不可达）改回真实可达的 ASSESSED（同 C1）。
  describe('describeCloseImpact — IMPACT/SHORTFALL verbs no longer degrade to raw codes (Task 8)', () => {
    it.each([
      [T.CYBER_BCDR, S.ASSESSED, 'SERVICE_IMPACT', 'service impact assessed'],
      [T.DATA_BREACH, S.RESOLVING, 'DATA_IMPACT', 'data impact assessed'],
      [T.PRUDENTIAL_BREACH, S.ASSESSED, 'SHORTFALL', 'shortfall assessed'],
    ])('%s @ %s + %s → impact contains "%s", not the raw code', async (type, status, assessmentBasis, humanVerb) => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type, status,
          assessmentBasis, assessedAmount: null, reportRequired: false, traceId: 't',
        },
      });
      await wf.requestClose('INC1', treasury);
      const impact = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact;
      expect(impact).toContain(humanVerb);
      expect(impact).not.toContain(`Assessment: ${assessmentBasis}`);
    });
  });

  // 战役甲波一 T8 修复轮 1（评审 I1 d）：类型人话标签改从注册表派生后，断言此前没有条目的
  // 类型（十类终盘除旧三类外的另外六类）摘要里出现的是注册表 label，不是裸类型码。
  // LARGE_UNEXPLAINED 顺带验证措辞与注册表同步（此前手抄漏了 "discrepancy"）。
  describe('describeCloseImpact — type label sync with INCIDENT_TYPE_REGISTRY (T8 修复轮 1 I1 d)', () => {
    it.each([
      [T.CYBER_BCDR, S.ASSESSED, 'SERVICE_IMPACT', 'Cyber / BCDR incident'],
      [T.OUTSOURCING_FAILURE, S.ASSESSED, 'SERVICE_IMPACT', 'Outsourcing failure'],
      [T.ASSET_NONCOMPLIANCE, S.RESOLVING, 'SERVICE_IMPACT', 'Asset non-compliance'],
      [T.STUCK_TRANSACTION_MAJOR, S.ASSESSED, 'FIRM_LOSS', 'Major stuck transaction'],
      [T.PRUDENTIAL_BREACH, S.ASSESSED, 'SHORTFALL', 'Prudential (NLA) breach'],
      [T.LARGE_UNEXPLAINED, S.RESOLVING, 'FIRM_LOSS', 'Large unexplained discrepancy'],
    ])('%s @ %s + %s → impact carries the registry label "%s", not the raw type code', async (type, status, assessmentBasis, label) => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type, status, assessmentBasis, reportRequired: false, traceId: 't' },
      });
      await wf.requestClose('INC1', treasury);
      const impact = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact;
      expect(impact).toContain(`(${label})`);
      expect(impact).not.toContain(`(${type})`);
    });
  });

  // 战役甲波一 T8 修复轮 1（评审 I1 c，裁决 Ruling-11）：IMPACT 口径类型定损时落的
  // impactSummary/subjectRefs 此前结案快照不带，裁决人看不到定损细节/新类型锚键值。
  // "有值才带"：没值时键整个不出现（不是出现 null），subjectRefs 落库是 JSON 字符串，
  // 快照里应是解析回的结构化对象（业务值，非 UUID）。
  describe('requestClose — objectSnapshot carries impactSummary/subjectRefs when present (T8 修复轮 1 I1 c)', () => {
    it('impactSummary present → included as-is; subjectRefs absent → key entirely omitted', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.CYBER_BCDR, status: S.ASSESSED,
          assessmentBasis: 'SERVICE_IMPACT', reportRequired: false, traceId: 't',
          impactSummary: 'Core ledger degraded for 40 minutes',
        },
      });
      await wf.requestClose('INC1', treasury);
      const snap = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot;
      expect(snap.impactSummary).toBe('Core ledger degraded for 40 minutes');
      expect(snap).not.toHaveProperty('subjectRefs');
    });

    it('subjectRefs present (JSON string on the row, per Prisma column) → parsed into a structured object, business values only, no UUID', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.CYBER_BCDR, status: S.ASSESSED,
          assessmentBasis: 'SERVICE_IMPACT', reportRequired: false, traceId: 't',
          subjectRefs: JSON.stringify({ affectedSystem: 'core-ledger', bcdrTriggered: true }),
        },
      });
      await wf.requestClose('INC1', treasury);
      const snap = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot;
      expect(snap.subjectRefs).toEqual({ affectedSystem: 'core-ledger', bcdrTriggered: true });
      expect(snap).not.toHaveProperty('impactSummary');
      expect(JSON.stringify(snap)).not.toMatch(/uuid-/);
    });

    it('neither present → both keys entirely omitted from the snapshot', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.ASSESSED, assessmentBasis: 'NO_LOSS', reportRequired: false, traceId: 't' },
      });
      await wf.requestClose('INC1', treasury);
      const snap = approvals.createAndSubmit.mock.calls[0][0].objectSnapshot;
      expect(snap).not.toHaveProperty('impactSummary');
      expect(snap).not.toHaveProperty('subjectRefs');
    });
  });

  describe('requestClose — objectSnapshot has zero UUIDs + markCloseRequested + audit', () => {
    it('happy path: objectSnapshot carries type/amount/assessment basis/remediation reference list/reported flag, no UUIDs', async () => {
      const { wf, approvals, incidents, auditLogs } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING,
          assessmentBasis: 'CLIENT_COLLECTION', assessedAmount: { toString: () => '900' },
          reportRequired: true, reportedAt: new Date(), customerNo: 'CU1', sourceCaseNo: 'REC1', traceId: 'trace-9',
        },
        remediations: ['ITR9'],
      });
      const r = await wf.requestClose('INC1', treasury);
      expect(r).toEqual({ incidentNo: 'INC1', approvalNo: 'AC1' });

      const call = approvals.createAndSubmit.mock.calls[0][0];
      expect(call.entityRef).toBe('INC1');
      expect(call.traceId).toBe('trace-9');
      expect(call.objectSnapshot).toEqual({
        incidentNo: 'INC1', customerNo: 'CU1',
        type: T.CLIENT_SHORTFALL, amount: '900', assessmentBasis: 'CLIENT_COLLECTION',
        remediationReferenceNos: ['ITR9'], reported: true,
        impact: 'Closing incident INC1 (Client shortfall): Assessment: pursuing collection 900, 1 remediation item(s), reported to VARA',
      });
      expect(JSON.stringify(call.objectSnapshot)).not.toMatch(/uuid-/);

      expect(incidents.markCloseRequested).toHaveBeenCalledWith('INC1', 'AC1');
      const audit = auditLogs.recordByActor.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'INCIDENT_CLOSE_REQUESTED', approvalNo: 'AC1', correlationId: 'trace-9' });
    });

    it('an assessment row with assetCode → impact appends the currency (called out at final review: previously uncovered branch)', async () => {
      const { wf, approvals } = makeWorkflow({
        incidentRow: {
          id: 'uuid-inc', incidentNo: 'INC1', type: T.UNAUTHORIZED_OUTFLOW, status: S.RESOLVING,
          assessmentBasis: 'FIRM_LOSS', assessedAmount: { toString: () => '400' }, assetCode: 'USDT-TRON',
          reportRequired: false, reportedAt: null, customerNo: null, sourceCaseNo: 'REC1', traceId: 'trace-2',
        },
        remediations: ['ADJ2'],
      });
      await wf.requestClose('INC1', treasury);
      const call = approvals.createAndSubmit.mock.calls[0][0];
      expect(call.objectSnapshot.impact).toBe('Closing incident INC1 (Unauthorized outflow): Assessment: loss recognized 400 USDT-TRON, 1 remediation item(s), no reporting required');
    });
  });

  describe('onDecided — decision landing', () => {
    it('APPROVED → close() is called + INCIDENT_CLOSED audit (fromStatus/toStatus/approvalNo/causationId)', async () => {
      const { wf, incidents, auditLogs } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING, traceId: 'trace-1' } });
      await wf.onDecided({
        decision: 'APPROVED', actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1',
        approvalId: 'A1', approvalNo: 'AC1', traceId: 'trace-1', workflowType: 'INCIDENT',
        decisionByRole: 'CFO', metadata: {},
      } as any);
      expect(incidents.close).toHaveBeenCalledWith('INC1');
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit).toMatchObject({ action: 'INCIDENT_CLOSED', approvalNo: 'AC1', causationId: 'A1', fromStatus: S.RESOLVING, toStatus: S.CLOSED, correlationId: 'trace-1' });
    });

    // 战役甲波一 T8 修复轮 1（评审 M4）：CFO 不再是唯一裁决人（TECHSEC→CISO，
    // PRUDENTIAL→SENIOR_MANAGEMENT_OFFICER），事件缺 decisionByRole 时的兜底改从该链配置
    // 动态取，不再硬编码 'CFO'。
    it('APPROVED without decisionByRole on a TECHSEC-routed incident → audit reason falls back to the chain\'s actual decider (CISO), not a hardcoded "CFO" (T8 修复轮 1 M4)', async () => {
      const { wf, auditLogs } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CYBER_BCDR, status: S.RESOLVING, traceId: 'trace-1' } });
      await wf.onDecided({
        decision: 'APPROVED', actionType: 'INCIDENT_CLOSE_TECHSEC', entityRef: 'INC1',
        approvalId: 'A1', approvalNo: 'AC1', traceId: 'trace-1', workflowType: 'INCIDENT', metadata: {},
      } as any);
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit.reason).toBe('Close approved by CISO');
    });

    it('DECLINED → status left unchanged: close() is not called, no audit written', async () => {
      const { wf, incidents, auditLogs } = makeWorkflow({ incidentRow: { id: 'uuid-inc', incidentNo: 'INC1', type: T.CLIENT_SHORTFALL, status: S.RESOLVING, traceId: 'trace-1' } });
      await wf.onDecided({
        decision: 'DECLINED', actionType: 'INCIDENT_CLOSE_FINANCIAL', entityRef: 'INC1',
        approvalId: 'A1', approvalNo: 'AC1', traceId: 'trace-1', workflowType: 'INCIDENT', metadata: {},
      } as any);
      expect(incidents.close).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('EXPIRED/CANCELLED also leave status unchanged (anything but APPROVED is a no-op, no lookup)', async () => {
      const { wf, incidents } = makeWorkflow();
      await wf.onDecided({ decision: 'EXPIRED', entityRef: 'INC1' } as any);
      await wf.onDecided({ decision: 'CANCELLED', entityRef: 'INC1' } as any);
      expect(incidents.close).not.toHaveBeenCalled();
      expect(incidents.findByNo).not.toHaveBeenCalled();
    });
  });
});
