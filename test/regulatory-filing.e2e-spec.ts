import * as path from 'path';
import * as dotenv from 'dotenv';

// 同 incident-register.e2e-spec.ts：Node 18 polyfill（@nestjs/schedule 需要
// globalThis.crypto，Node 19+ 才稳），main.ts 不在本 harness 里跑，这里补一遍。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// PrismaService / TigerBeetleService 要在任何其它 import 之前看到本 worktree 的
// DATABASE_URL / TB_ADDRESS（同 incident-register.e2e-spec.ts 头注释）。
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { IncidentService } from '../src/modules/governance/incidents/incident.service';
import { IncidentRegistrationWorkflowService } from '../src/modules/governance/incidents/incident-registration-workflow.service';
import { IncidentAssessmentWorkflowService } from '../src/modules/governance/incidents/incident-assessment-workflow.service';
import { IncidentCloseWorkflowService } from '../src/modules/governance/incidents/incident-close-workflow.service';
import { IncidentRemediationKinds, IncidentTypes } from '../src/modules/governance/incidents/incident.constants';
import { RegulatoryFilingService } from '../src/modules/governance/regulatory-filings/regulatory-filing.service';
import { RegulatoryFilingWorkflowService } from '../src/modules/governance/regulatory-filings/regulatory-filing-workflow.service';
import { RegulatoryFilingSweepService } from '../src/modules/governance/regulatory-filings/regulatory-filing-sweep.service';
import { FilingEntryKinds } from '../src/modules/governance/regulatory-filings/regulatory-filing.constants';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * 战役甲波二 · 报送台骨架（Task 8）e2e：真 AppModule 零 mock，与既有 e2e 串行
 * （同一 SQLite 库，见 jest-e2e.json 头注释）。报送台本身不碰账本/TigerBeetle，本文件
 * 不需要资产/钱包夹具，比 incident-register.e2e-spec.ts 精简得多。
 *
 * 六段用例对应 task-8-brief.md：① 出站全链（含七码审计序列）② 驳回环 ③ 钟链
 * ④ 入站超时 sweep ⑤ 结案联动（续③） ⑥ 手工越界。①~③~⑤ 三段共享各自的事故/单号
 * （③ 的状态延续到 ⑤），jest 在同一 describe 内按声明顺序串行执行。
 *
 * ⚠ actor 工厂照 incident-register.e2e-spec.ts 的 treasury()/smo() 两种形状：
 *   - techOfficer()/dpo() 会经 IncidentService.assertOperator 真查
 *     AccessControlService.hasPermission(userId, cap.incident.*)——必须是种子里真实绑定
 *     TECH_OFFICER/DPO 角色的管理员 id（tech_admin@fiatx.com / dpo@fiatx.com）。
 *   - compliance()/smo()/ciso() 只经过 RegulatoryFilingService（不查权限）或
 *     ApprovalsService.approve/reject（只比对 actor.roleCodes 与候选角色集，不查真实 DB
 *     行）——随机造 id 即可，同 smo() 先例。
 */
describe('Regulatory filing e2e (战役甲波二 · 报送台骨架, Task 8)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let incidents: IncidentService; let registrationWorkflow: IncidentRegistrationWorkflowService;
  let assessmentWorkflow: IncidentAssessmentWorkflowService; let closeWorkflow: IncidentCloseWorkflowService;
  let filings: RegulatoryFilingService; let filingWorkflow: RegulatoryFilingWorkflowService;
  let sweepService: RegulatoryFilingSweepService; let approvalsService: ApprovalsService;

  let techOfficerUserId: string; let dpoUserId: string;
  const techOfficer = () => makeActor(techOfficerUserId, 'E2E_FIL_TECH', 'TECH_OFFICER');
  const dpo = () => makeActor(dpoUserId, 'E2E_FIL_DPO', 'DPO');
  // 只经 ApprovalsService.approve/reject 的候选角色数组比对，不查真实 DB 行绑定——照
  // incident-register.e2e-spec.ts 的 smo() 先例，随机造 id。
  const smoUserId = randomUUID();
  const smo = () => makeActor(smoUserId, 'E2E_FIL_SMO', 'SENIOR_MANAGEMENT_OFFICER');
  const cisoUserId = randomUUID();
  const ciso = () => makeActor(cisoUserId, 'E2E_FIL_CISO', 'CISO');
  // 战役甲波三 T3 承接修订（T8）：原注释"只经 RegulatoryFilingService（不查权限）、
  // 随机造 id 即可"已被 T3 的服务层族独占门（assertFamily → hasPermission(userId,
  // 'cap.filing.general') 真查 DB 角色绑定）打穿——本文件所有直调
  // openManual/saveDraft/markSubmitted/close/cancel 的 GENERAL 族写动作现在都会先过
  // 这道真权限门，随机 uuid 查不到任何角色绑定，一律 403。契约变了（这是 T3 明文设计的
  // 族独占，不是缺陷），改用真实种子 COMPLIANCE_OFFICER（compliance_lead@fiatx.com），
  // 同 techOfficer()/dpo() 已有先例。
  let complianceUserId: string;
  const compliance = () => makeActor(complianceUserId, 'E2E_FIL_COMPLIANCE', 'COMPLIANCE_OFFICER');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    incidents = app.get(IncidentService);
    registrationWorkflow = app.get(IncidentRegistrationWorkflowService);
    assessmentWorkflow = app.get(IncidentAssessmentWorkflowService);
    closeWorkflow = app.get(IncidentCloseWorkflowService);
    filings = app.get(RegulatoryFilingService);
    filingWorkflow = app.get(RegulatoryFilingWorkflowService);
    sweepService = app.get(RegulatoryFilingSweepService);
    approvalsService = app.get(ApprovalsService);

    // 真查种子管理员 id（TECH_OFFICER/DPO/COMPLIANCE_OFFICER 三个邮箱）——assertOperator/
    // assertFamily 都走真实 DB 查询，捏造 id 查不到任何角色绑定（同
    // incident-register.e2e-spec.ts 判例；COMPLIANCE_OFFICER 一项是 T8 承接修订新增，见上）。
    const [techUser, dpoUser, complianceUser] = await Promise.all([
      (prisma as any).user.findFirst({ where: { email: 'tech_admin@fiatx.com' } }),
      (prisma as any).user.findFirst({ where: { email: 'dpo@fiatx.com' } }),
      (prisma as any).user.findFirst({ where: { email: 'compliance_lead@fiatx.com' } }),
    ]);
    if (!techUser || !dpoUser || !complianceUser) throw new Error('Fixture role-seed admins (TECH_OFFICER/DPO/COMPLIANCE_OFFICER) not seeded — run `bash scripts/stack.sh reset self` first.');
    techOfficerUserId = techUser.id; dpoUserId = dpoUser.id; complianceUserId = complianceUser.id;
  });
  afterAll(async () => { if (app) await app.close(); });

  function makeActor(userId: string, userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function auditActionsFor(filingNo: string): Promise<string[]> {
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r: any) => r.action as string);
  }

  // ── 共享状态（① 的 CYBER_BCDR 事故供 ⑥ 复用；③ 的 DATA_BREACH 事故 + 两张报送单
  //     供 ⑤ 续作，jest 按文件顺序串行）──────────────────────────────────────
  let cyberIncidentNo: string;
  let dataBreachIncidentNo: string;
  let pdplFilingNo: string;   // DATA_BREACH_REPORT（不带钟）
  let chainFilingNo: string;  // DATA_BREACH_RE_REPORT_24H（chainStart='NOTICE'，钟链单）

  // ── scenarios ────────────────────────────────────────────────────────────

  it('① 出站全链：CYBER_BCDR 登记→调查→定损勾 MAJOR_INCIDENT_72H→开单 deadline=+72h→草拟→送签(REG_FILING_SUBMIT)→高管批→SIGNED_OFF→标提交→往来记录→办结→七码审计序列', async () => {
    const reg = await registrationWorkflow.register({
      type: IncidentTypes.CYBER_BCDR, title: 'e2e 网络安全事件',
      description: '核心账本服务遭遇异常访问，触发 BCDR 预案',
      subjectRefs: { affectedSystem: 'core-ledger-service', bcdrTriggered: true },
    } as any, techOfficer());
    cyberIncidentNo = reg.incidentNo;
    expect(cyberIncidentNo).toMatch(/^INC/);

    await incidents.startInvestigation(cyberIncidentNo, techOfficer());

    const incidentRow = await incidents.findByNo(cyberIncidentNo);
    const assessed = await assessmentWorkflow.assess(cyberIncidentNo, {
      assessmentBasis: 'SERVICE_IMPACT', impactSummary: '核心账本服务短暂不可用，已启用 BCDR 预案',
      reportRequired: true, reportBasisCodes: ['MAJOR_INCIDENT_72H'],
    } as any, techOfficer());
    expect(assessed.filingsOpened).toHaveLength(1);
    const [filingNo] = assessed.filingsOpened;
    expect(filingNo).toMatch(/^FIL/);

    // deadline = 事故登记时刻（不是定损时刻）+ 72h（MAJOR_INCIDENT_72H）。
    const filingRow = await filings.findByNo(filingNo);
    expect(filingRow.deadlineAt).not.toBeNull();
    expect((filingRow.deadlineAt as Date).getTime()).toBe(incidentRow.createdAt.getTime() + 72 * 3600 * 1000);
    expect(filingRow.authority).toBe('VARA');
    expect(filingRow.status).toBe('DRAFT');

    // 战役甲波三 T3 承接修订（T8）：报送台经办唯合规官（rbac.catalog.ts :974 域块头，
    // 战役甲波二 Task 5 已定案），T3 的 assertFamily 头一次在服务层真正把这条规矩钉死——
    // techOfficer 开事故/定损，但草稿/送签/标已提交/往来/办结这五步落到合规官手上
    // （同一张 INCIDENT_REPORT 单，openForIncident 开单本身不受 cap.filing.general
    // 门限制，是给事故经办人的既有豁免；下游报送台操作不豁免）。
    await filings.saveDraft(filingNo, '事件时间线：核心账本服务于 T 时刻检测到异常访问，已启用 BCDR 预案。', compliance());

    const signoff = await filingWorkflow.submitForSignoff(filingNo, compliance());
    const approvalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: signoff.approvalNo } });
    expect(approvalRow.actionType).toBe(ApprovalActionTypes.REG_FILING_SUBMIT);

    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e SMO signoff filing 1' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'SIGNED_OFF');

    await filings.markSubmitted(filingNo, { externalRef: 'VARA-REG-E2E-001' }, compliance());
    expect((await filings.findByNo(filingNo)).status).toBe('SUBMITTED');

    await filings.addEntry(filingNo, { kind: FilingEntryKinds.RECEIPT_ACK, body: 'VARA 已确认收到本次通报' }, compliance());
    await filings.close(filingNo, compliance());
    expect((await filings.findByNo(filingNo)).status).toBe('CLOSED');

    const actions = await auditActionsFor(filingNo);
    expect(actions).toEqual([
      AuditActions.FILING_OPENED, AuditActions.FILING_DRAFT_SAVED, AuditActions.FILING_SIGNOFF_REQUESTED,
      AuditActions.FILING_SIGNED_OFF, AuditActions.FILING_SUBMITTED, AuditActions.FILING_ENTRY_LOGGED,
      AuditActions.FILING_CLOSED,
    ]);
  });

  it('② 驳回环：手工开单送签→高管 DECLINE→回 DRAFT + FILING_SIGNOFF_REJECTED→再送签成功', async () => {
    const { filingNo } = await filings.openManual({
      type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'e2e 重大变更通知（驳回环）',
    }, compliance());
    await filings.saveDraft(filingNo, '拟提交内容：公司股权结构变更说明（草案）', compliance());

    const signoff1 = await filingWorkflow.submitForSignoff(filingNo, compliance());
    await approvalsService.reject(signoff1.approvalNo, { reason: 'e2e SMO decline: 内容需补充' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'DRAFT');

    const actionsAfterReject = await auditActionsFor(filingNo);
    expect(actionsAfterReject).toEqual([
      AuditActions.FILING_OPENED, AuditActions.FILING_DRAFT_SAVED, AuditActions.FILING_SIGNOFF_REQUESTED,
      AuditActions.FILING_SIGNOFF_REJECTED,
    ]);

    // 再送签成功（同一张单，DRAFT→PENDING_SIGNOFF→SIGNED_OFF 边仍通）。
    const signoff2 = await filingWorkflow.submitForSignoff(filingNo, compliance());
    expect(signoff2.approvalNo).not.toBe(signoff1.approvalNo);
    await approvalsService.approve(signoff2.approvalNo, { reason: 'e2e SMO approve on retry' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'SIGNED_OFF');
  });

  it('③ 钟链：DATA_BREACH 登记→定损勾 DATA_BREACH_REPORT+DATA_BREACH_RE_REPORT_24H→两单开出、链单 deadline=null→提交 PDPL 单→链单 deadline=该 submittedAt+24h', async () => {
    const reg = await registrationWorkflow.register({
      type: IncidentTypes.DATA_BREACH, title: 'e2e 个人数据泄露',
      description: '客户 KYC 材料存储桶被短暂公开访问',
      subjectRefs: { affectedCustomerCount: 120, dataCategories: 'KYC_DOCS' },
    } as any, dpo());
    dataBreachIncidentNo = reg.incidentNo;
    expect(dataBreachIncidentNo).toMatch(/^INC/);

    await incidents.startInvestigation(dataBreachIncidentNo, dpo());
    const assessed = await assessmentWorkflow.assess(dataBreachIncidentNo, {
      assessmentBasis: 'DATA_IMPACT', impactSummary: '约 120 名客户的 KYC 材料存在被访问风险',
      reportRequired: true, reportBasisCodes: ['DATA_BREACH_REPORT', 'DATA_BREACH_RE_REPORT_24H'],
    } as any, dpo());
    expect(assessed.filingsOpened).toHaveLength(2);
    [pdplFilingNo, chainFilingNo] = assessed.filingsOpened;

    const pdplRow = await filings.findByNo(pdplFilingNo);
    const chainRow = await filings.findByNo(chainFilingNo);
    expect(pdplRow.basisCode).toBe('DATA_BREACH_REPORT');
    expect(chainRow.basisCode).toBe('DATA_BREACH_RE_REPORT_24H');
    // 两单在开单时都不落 deadline：DATA_BREACH_REPORT 本身无小时钟；DATA_BREACH_RE_REPORT_24H 虽带 hours=24，
    // 但 chainStart='NOTICE'——钟锚是兄弟单提交（通知发出）时刻，不是登记/定损时刻。
    expect(pdplRow.deadlineAt).toBeNull();
    expect(chainRow.deadlineAt).toBeNull();

    // 战役甲波三 T3 承接修订（T8，同①注释）：报送台操作改用合规官，DPO 只留在事故侧。
    await filings.saveDraft(pdplFilingNo, '事件说明：客户 KYC 材料存储桶配置错误导致短暂公开可访问。', compliance());
    const signoff = await filingWorkflow.submitForSignoff(pdplFilingNo, compliance());
    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e SMO signoff PDPL filing' }, smo());
    await waitUntil(async () => (await filings.findByNo(pdplFilingNo)).status === 'SIGNED_OFF');

    const submitResult = await filings.markSubmitted(pdplFilingNo, { externalRef: 'UAE-DATA-OFFICE-E2E-001' }, compliance());
    expect(submitResult.chainDeadlineSetFor).toEqual([chainFilingNo]);

    const pdplAfterSubmit = await filings.findByNo(pdplFilingNo);
    const chainAfterSubmit = await filings.findByNo(chainFilingNo);
    expect(chainAfterSubmit.deadlineAt).not.toBeNull();
    expect((chainAfterSubmit.deadlineAt as Date).getTime()).toBe((pdplAfterSubmit.submittedAt as Date).getTime() + 24 * 3600 * 1000);
  });

  it('④ 入站：手工开单 INFO_REQUEST_RESPONSE（authority VARA、receivedAt 46h 前）→ deadline=receivedAt+48h → sweep(now=+3h) → overdueMarkedAt 落地 + 一条 FILING_OVERDUE_MARKED → 再 sweep 不重复', async () => {
    const base = new Date();
    const receivedAt = new Date(base.getTime() - 46 * 3600 * 1000);
    const { filingNo } = await filings.openManual({
      type: 'INFO_REQUEST_RESPONSE', authority: 'VARA', title: 'e2e 监管问询答复',
      receivedAt: receivedAt.toISOString(),
    }, compliance());

    const row = await filings.findByNo(filingNo);
    expect(row.deadlineAt).not.toBeNull();
    expect((row.deadlineAt as Date).getTime()).toBe(receivedAt.getTime() + 48 * 3600 * 1000);
    expect(row.overdueMarkedAt).toBeNull();

    const sweepNow = new Date(base.getTime() + 3 * 3600 * 1000);
    const result1 = await sweepService.sweep(sweepNow);
    expect(result1.marked).toBeGreaterThanOrEqual(1);

    const afterFirstSweep = await filings.findByNo(filingNo);
    expect(afterFirstSweep.overdueMarkedAt).not.toBeNull();
    expect((afterFirstSweep.overdueMarkedAt as Date).getTime()).toBe(sweepNow.getTime());

    const overdueAudits1 = await (prisma as any).auditLogEvent.count({
      where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo, action: AuditActions.FILING_OVERDUE_MARKED },
    });
    expect(overdueAudits1).toBe(1);

    // 再 sweep（更晚的 now）：overdueMarkedAt 已非空，天然不再匹配扫描条件——不重复标记。
    await sweepService.sweep(new Date(sweepNow.getTime() + 3600 * 1000));
    const afterSecondSweep = await filings.findByNo(filingNo);
    expect((afterSecondSweep.overdueMarkedAt as Date).getTime()).toBe(sweepNow.getTime());
    const overdueAudits2 = await (prisma as any).auditLogEvent.count({
      where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo, action: AuditActions.FILING_OVERDUE_MARKED },
    });
    expect(overdueAudits2).toBe(1);
  });

  it('⑤ 结案联动（续③）：链单未提交时 requestClose 400；两单都提交后结案链走通（DATA_BREACH 走 INCIDENT_CLOSE_TECHSEC，CISO 单步批）', async () => {
    // DATA_BREACH 的 allowedRemediationKinds 非空集（CUSTOMER_NOTICE_LOGGED）——先挂一条
    // 善后（ASSESSED→RESOLVING 自动迁移），排除"该类型需要走善后"这另一支拒绝理由，让下面
    // 的 400 单纯来自"报送单未全部提交"这一支守卫。
    await incidents.linkRemediation(dataBreachIncidentNo, {
      kind: IncidentRemediationKinds.CUSTOMER_NOTICE_LOGGED, referenceNo: 'NOTICE-E2E-DATA-BREACH-001',
    } as any, dpo());
    expect((await incidents.findByNo(dataBreachIncidentNo)).status).toBe('RESOLVING');

    // 链单（chainFilingNo）此刻仍是 DRAFT（③ 只提交了 pdplFilingNo）——未全部提交，拒绝。
    expect((await filings.findByNo(chainFilingNo)).status).toBe('DRAFT');
    await expect(closeWorkflow.requestClose(dataBreachIncidentNo, dpo())).rejects.toThrow(/have not yet been submitted/);

    // 补齐链单的签发链：草拟 → 送签 → 高管批 → SIGNED_OFF → 标提交（同③注释，报送台操作用合规官）。
    await filings.saveDraft(chainFilingNo, '后续通知（24h 内）：PDPL 通报后的强制再报，补充影响范围核实结果。', compliance());
    const signoff = await filingWorkflow.submitForSignoff(chainFilingNo, compliance());
    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e SMO signoff chain filing' }, smo());
    await waitUntil(async () => (await filings.findByNo(chainFilingNo)).status === 'SIGNED_OFF');
    await filings.markSubmitted(chainFilingNo, { externalRef: 'VARA-REG-E2E-002' }, compliance());
    expect((await filings.findByNo(chainFilingNo)).status).toBe('SUBMITTED');

    // 两单均已提交：结案入口放行——DATA_BREACH.closeActionType===INCIDENT_CLOSE_TECHSEC，单步 CISO。
    const closeReq = await closeWorkflow.requestClose(dataBreachIncidentNo, dpo());
    const approvalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: closeReq.approvalNo } });
    expect(approvalRow.actionType).toBe(ApprovalActionTypes.INCIDENT_CLOSE_TECHSEC);

    await approvalsService.approve(closeReq.approvalNo, { reason: 'e2e CISO approve DATA_BREACH close' }, ciso());
    await waitUntil(async () => (await incidents.findByNo(dataBreachIncidentNo)).status === 'CLOSED');
    expect((await incidents.findByNo(dataBreachIncidentNo)).closedAt).not.toBeNull();
  });

  it('⑥ 手工越界：openManual INCIDENT_REPORT 带不属该事故类型候选集的 basisCode → 400', async () => {
    // cyberIncidentNo（① 的 CYBER_BCDR）候选集只有 ['MAJOR_INCIDENT_72H']；DATA_BREACH_REPORT 是已知依据码，
    // 但不是 CYBER_BCDR 类型的合法通报依据——越界。
    await expect(filings.openManual({
      type: 'INCIDENT_REPORT', incidentNo: cyberIncidentNo, basisCode: 'DATA_BREACH_REPORT',
    }, compliance())).rejects.toThrow(/not a valid reporting basis/);
  });
});
