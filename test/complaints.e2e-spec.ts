import * as path from 'path';
import * as dotenv from 'dotenv';

// 同 regulatory-filing.e2e-spec.ts / compliance-office.e2e-spec.ts：Node 18 polyfill
// （@nestjs/schedule 需要 globalThis.crypto，Node 19+ 才稳），main.ts 不在本 harness 里跑，
// 这里补一遍。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// PrismaService / TigerBeetleService 要在任何其它 import 之前看到本 worktree 的
// DATABASE_URL / TB_ADDRESS（同上两份先例头注释）。
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { ComplaintsService } from '../src/modules/governance/complaints/complaints.service';
import { ComplaintResolutionWorkflowService } from '../src/modules/governance/complaints/complaint-resolution-workflow.service';
import { ComplaintEscalationWorkflowService } from '../src/modules/governance/complaints/complaint-escalation-workflow.service';
import { IncidentService } from '../src/modules/governance/incidents/incident.service';
import { IncidentRegistrationWorkflowService } from '../src/modules/governance/incidents/incident-registration-workflow.service';
import { IncidentCloseWorkflowService } from '../src/modules/governance/incidents/incident-close-workflow.service';
import { IncidentTypes } from '../src/modules/governance/incidents/incident.constants';
import { ComplianceClockWallService } from '../src/modules/governance/compliance-office/compliance-clock-wall.service';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * 战役甲波五 · 投诉全链（Task 8）e2e：真 AppModule 零 mock，与既有 e2e 串行（同一 SQLite
 * 库，见 jest-e2e.json 头注释）。使命：把 T2-T7 的缝合面在真 AppModule 下走通——尤其审批
 * decided 事件经 ApprovalHandlerBase 子类真正打到 workflow（这是单测层 mock 掉的接线，
 * mock 测过的每个环节单独成立不代表接起来也通）。
 *
 * 四段对应 task-8-brief.md：① 主弧（submit→ack→investigation→(延期)→propose→合规官批→
 * RESOLVED，三类 CLIENT_MESSAGE 齐、审计链逐码在、客户读面零 INTERNAL_NOTE）② 延期分支
 * + 变异（死线计算、二次 extend 400、RECEIVED 直接 propose 400、驳回两条回退边）
 * ③ 升级线（⚡拨钟→clock-wall→escalate→事件全弧→结案→回填、二次/RESOLVED 后升级 400）
 * ④ 门与归属（手工登记 400、跨客户查无）。①③④ 共享 complaint1No（① 的主弧投诉最终
 * RESOLVED，③④ 续用同一张单验证终态守卫），jest 在同一 describe 内按声明顺序串行执行。
 *
 * 造数（brief 判断依据）：不依赖 T7 种子行——本文件自己 submit 新投诉，customerNo 用合成
 * 字符串（Complaint.ownerCustomerNo 是无 FK 的业务键列，见 schema.prisma:1801，submit()
 * 内部也不校验客户是否真实存在），避免与种子态耦合；也不清库、不动种子行。
 *
 * actor 工厂（照 regulatory-filing.e2e-spec.ts / compliance-office.e2e-spec.ts 先例）：
 *   - ops() 真查种子管理员 id（ops_officer@fiatx.com）——IncidentService.assertOperator
 *     经 AccessControlService.hasPermission(userId, cap.incident.ops) 真查 DB 角色绑定
 *     （T4/T5 报告确认 OPS_OFFICER 是 INCIDENT_OPS_WRITE 与 COMPLAINT_WRITE 的共同现持有
 *     职务，见 rbac.catalog.ts:1372-1373），捏造 id 查不到任何绑定。ComplaintsService 自己
 *     的写方法零权限校验（T2 报告"疑虑"已载明），复用同一个 ops 身份即可，不必另造角色。
 *   - compliance() 只经 ApprovalsService.approve/reject 的候选角色数组比对，不查真实 DB
 *     行绑定（COMPLAINT_RESOLUTION/INCIDENT_CLOSE_CUSTOMER 均为合规官单步，approval.
 *     constants.ts:431-437）——随机造 id 即可，同 smo()/ciso() 先例。
 */
describe('Complaints e2e (战役甲波五 · 投诉全链, Task 8)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let complaints: ComplaintsService;
  let resolutionWorkflow: ComplaintResolutionWorkflowService;
  let escalationWorkflow: ComplaintEscalationWorkflowService;
  let incidents: IncidentService;
  let registrationWorkflow: IncidentRegistrationWorkflowService;
  let closeWorkflow: IncidentCloseWorkflowService;
  let clockWall: ComplianceClockWallService;
  let approvalsService: ApprovalsService;

  let opsUserId: string;
  const ops = () => makeActor(opsUserId, 'E2E_CMP_OPS', 'OPS_OFFICER');
  const complianceUserId = randomUUID();
  const compliance = () => makeActor(complianceUserId, 'E2E_CMP_COMPLIANCE', 'COMPLIANCE_OFFICER');

  // 合成客户号，不落种子——两个不同客户，供 ④ 的跨客户「查无」用。
  const custA = 'E2E-CMP-CUSTOMER-A';
  const custB = 'E2E-CMP-CUSTOMER-B';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    complaints = app.get(ComplaintsService);
    resolutionWorkflow = app.get(ComplaintResolutionWorkflowService);
    escalationWorkflow = app.get(ComplaintEscalationWorkflowService);
    incidents = app.get(IncidentService);
    registrationWorkflow = app.get(IncidentRegistrationWorkflowService);
    closeWorkflow = app.get(IncidentCloseWorkflowService);
    clockWall = app.get(ComplianceClockWallService);
    approvalsService = app.get(ApprovalsService);

    const opsUser = await (prisma as any).user.findFirst({ where: { email: 'ops_officer@fiatx.com' } });
    if (!opsUser) throw new Error('Fixture role-seed admin (OPS_OFFICER) not seeded — run `bash scripts/stack.sh reset self` first.');
    opsUserId = opsUser.id;
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

  async function complaintAuditRows(complaintNo: string): Promise<any[]> {
    return (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectType: 'COMPLAINT', primarySubjectNo: complaintNo },
      orderBy: { seq: 'asc' },
    });
  }

  // ── 共享状态（① 的主弧投诉最终 RESOLVED，③④ 续用同一张单验证终态守卫）───────
  let complaint1No: string;

  // ── scenarios ────────────────────────────────────────────────────────────

  it('① 主弧：submit→acknowledge→investigation→(延期，凑三类 CLIENT_MESSAGE)→proposeResolution(经workflow)→合规官经ApprovalsService批→RESOLVED；三类CLIENT_MESSAGE齐；审计链逐码在(含fromStatus/toStatus)；客户读面entries无INTERNAL_NOTE', async () => {
    const { complaintNo } = await complaints.submit(custA, {
      category: 'SERVICE', subject: 'e2e 主弧：客服响应迟缓', description: '客户反馈支持工单三次跟进无回应',
    });
    complaint1No = complaintNo;
    expect(complaintNo).toMatch(/^CMP/);
    expect((await complaints.findByNo(complaintNo)).currentStatus).toBe('RECEIVED');

    await complaints.acknowledge(ops(), complaintNo, { message: 'e2e 已收悉，正在核实' });
    expect((await complaints.findByNo(complaintNo)).currentStatus).toBe('ACKNOWLEDGED');

    await complaints.startInvestigation(ops(), complaintNo);
    expect((await complaints.findByNo(complaintNo)).currentStatus).toBe('INVESTIGATING');

    // 内部备注：不产生 CLIENT_MESSAGE，只用来证明客户读面确实把它过滤掉了（见下方断言）。
    await complaints.addNote(ops(), complaintNo, 'e2e 内部调查记录：已联系相关团队核实响应时长');

    // 延期一次——本主弧顺带走一次延期，是为了让三类 CLIENT_MESSAGE（ACK/EXTENSION_NOTICE/
    // FINAL_RESPONSE）在同一张单的主弧上"齐"；延期本身的死线计算/二次延期 400 等专属行为
    // 由 ② 段用独立投诉验证，这里不重复断言，只借它产生一条 EXTENSION_NOTICE entry。
    const beforeExtend = await complaints.findByNo(complaintNo);
    await complaints.extend(ops(), complaintNo, { explanation: 'e2e 延期说明：需等待第三方渠道确认' });
    const afterExtend = await complaints.findByNo(complaintNo);
    expect(afterExtend.currentStatus).toBe('INVESTIGATING_EXTENDED');
    expect(afterExtend.resolveDeadlineAt.getTime()).toBe(beforeExtend.submittedAt.getTime() + 56 * 86400000);

    const { approvalNo } = await resolutionWorkflow.propose(ops(), complaintNo, {
      outcome: 'UPHELD', resolutionText: 'e2e 裁决：核实属实，已加急处理并补偿等值点差',
    });
    expect((await complaints.findByNo(complaintNo)).currentStatus).toBe('RESOLUTION_PENDING');
    const approvalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo } });
    expect(approvalRow.actionType).toBe(ApprovalActionTypes.COMPLAINT_RESOLUTION);

    await approvalsService.approve(approvalNo, { reason: 'e2e 合规官批准裁决' }, compliance());
    await waitUntil(async () => (await complaints.findByNo(complaintNo)).currentStatus === 'RESOLVED');
    const resolved = await complaints.findByNo(complaintNo);
    expect(resolved.resolutionOutcome).toBe('UPHELD');
    expect(resolved.resolvedAt).not.toBeNull();

    // 三类 CLIENT_MESSAGE 齐 + 客户读面零 INTERNAL_NOTE + 零内部字段。
    const clientView = await complaints.getForCustomer(custA, complaintNo);
    expect(clientView.entries).toHaveLength(3);
    expect(clientView.entries.map((e) => e.messageType).sort()).toEqual(['ACK', 'EXTENSION_NOTICE', 'FINAL_RESPONSE']);
    expect(clientView.entries.some((e) => e.kind === 'INTERNAL_NOTE')).toBe(false);
    expect(clientView).not.toHaveProperty('pendingApprovalNo');
    expect(clientView).not.toHaveProperty('escalatedIncidentNo');

    // 管理台面对照：4 条 entries（多一条 INTERNAL_NOTE），证明客户面的过滤是真过滤、
    // 不是这条数据压根没写进去。
    const adminView = await complaints.getAdmin(complaintNo);
    expect(adminView.entries).toHaveLength(4);
    expect(adminView.entries.some((e) => e.kind === 'INTERNAL_NOTE')).toBe(true);

    // 审计链逐码在，含 fromStatus/toStatus。
    const auditRows = await complaintAuditRows(complaintNo);
    expect(auditRows.map((r) => r.action)).toEqual([
      AuditActions.COMPLAINT_SUBMITTED, AuditActions.COMPLAINT_ACKNOWLEDGED, AuditActions.COMPLAINT_INVESTIGATION_STARTED,
      AuditActions.COMPLAINT_NOTE_ADDED, AuditActions.COMPLAINT_EXTENDED, AuditActions.COMPLAINT_RESOLUTION_PROPOSED,
      AuditActions.COMPLAINT_RESOLUTION_APPLIED,
    ]);
    const byAction = (action: string) => auditRows.find((r) => r.action === action);
    expect(byAction(AuditActions.COMPLAINT_ACKNOWLEDGED)).toMatchObject({ fromStatus: 'RECEIVED', toStatus: 'ACKNOWLEDGED' });
    expect(byAction(AuditActions.COMPLAINT_INVESTIGATION_STARTED)).toMatchObject({ fromStatus: 'ACKNOWLEDGED', toStatus: 'INVESTIGATING' });
    expect(byAction(AuditActions.COMPLAINT_EXTENDED)).toMatchObject({ fromStatus: 'INVESTIGATING', toStatus: 'INVESTIGATING_EXTENDED' });
    expect(byAction(AuditActions.COMPLAINT_RESOLUTION_PROPOSED)).toMatchObject({ fromStatus: 'INVESTIGATING_EXTENDED', toStatus: 'RESOLUTION_PENDING' });
    expect(byAction(AuditActions.COMPLAINT_RESOLUTION_APPLIED)).toMatchObject({ fromStatus: 'RESOLUTION_PENDING', toStatus: 'RESOLVED' });
  });

  it('② 延期分支 + 变异：死线=submittedAt+56d、EXTENSION_NOTICE落entry；二次extend 400；RECEIVED直接propose 400；驳回回INVESTIGATING_EXTENDED（延期过）与INVESTIGATING（未延期）两边各验', async () => {
    // a) 延期死线计算 + entry（独立投诉，与 ① 的延期互不干扰）。
    const { complaintNo: cNo } = await complaints.submit(custA, {
      category: 'FEES', subject: 'e2e 延期分支：费用争议', description: '客户对手续费计算方式提出异议',
    });
    await complaints.acknowledge(ops(), cNo, { message: 'e2e 已收悉' });
    await complaints.startInvestigation(ops(), cNo);
    const beforeExtend = await complaints.findByNo(cNo);
    await complaints.extend(ops(), cNo, { explanation: 'e2e 延期：需财务组复核费用计算' });
    const afterExtend = await complaints.findByNo(cNo);
    expect(afterExtend.currentStatus).toBe('INVESTIGATING_EXTENDED');
    expect(afterExtend.extendedAt).not.toBeNull();
    expect(afterExtend.resolveDeadlineAt.getTime()).toBe(beforeExtend.submittedAt.getTime() + 56 * 86400000);
    const viewAfterExtend = await complaints.getAdmin(cNo);
    expect(viewAfterExtend.entries.filter((e) => e.messageType === 'EXTENSION_NOTICE')).toHaveLength(1);

    // b) 二次 extend 400。
    await expect(complaints.extend(ops(), cNo, { explanation: 'e2e 二次延期（应拒）' }))
      .rejects.toThrow(/already been extended/);

    // c) RECEIVED 直接 propose 400（未 acknowledge/investigation 的全新一张单）。
    const { complaintNo: freshNo } = await complaints.submit(custA, {
      category: 'OTHER', subject: 'e2e RECEIVED 直接提裁决（应拒）', description: '未确认即尝试裁决',
    });
    await expect(resolutionWorkflow.propose(ops(), freshNo, { outcome: 'UPHELD', resolutionText: 'e2e 不应落地' }))
      .rejects.toThrow(/must be under investigation/);

    // d) 驳回回 INVESTIGATING_EXTENDED（延期过——复用 a 的 cNo，此刻仍在 INVESTIGATING_EXTENDED）。
    const { approvalNo: apExtended } = await resolutionWorkflow.propose(ops(), cNo, {
      outcome: 'REJECTED', resolutionText: 'e2e 拟驳回裁决草案',
    });
    await approvalsService.reject(apExtended, { reason: 'e2e 合规官驳回：证据不足' }, compliance());
    await waitUntil(async () => (await complaints.findByNo(cNo)).currentStatus === 'INVESTIGATING_EXTENDED');
    const rejectedRowExtended = (await complaintAuditRows(cNo)).find((r) => r.action === AuditActions.COMPLAINT_RESOLUTION_REJECTED);
    expect(rejectedRowExtended).toMatchObject({ fromStatus: 'RESOLUTION_PENDING', toStatus: 'INVESTIGATING_EXTENDED' });

    // e) 驳回回 INVESTIGATING（未延期过——全新一张单，从未调用过 extend）。
    const { complaintNo: cNo2 } = await complaints.submit(custA, {
      category: 'SERVICE', subject: 'e2e 驳回分支（未延期）', description: '未延期直接提裁决后被驳回',
    });
    await complaints.acknowledge(ops(), cNo2, { message: 'e2e 已收悉' });
    await complaints.startInvestigation(ops(), cNo2);
    const { approvalNo: apPlain } = await resolutionWorkflow.propose(ops(), cNo2, {
      outcome: 'REJECTED', resolutionText: 'e2e 拟驳回裁决草案（未延期分支）',
    });
    await approvalsService.reject(apPlain, { reason: 'e2e 合规官驳回：需补充材料' }, compliance());
    await waitUntil(async () => (await complaints.findByNo(cNo2)).currentStatus === 'INVESTIGATING');
    const rejectedRowPlain = (await complaintAuditRows(cNo2)).find((r) => r.action === AuditActions.COMPLAINT_RESOLUTION_REJECTED);
    expect(rejectedRowPlain).toMatchObject({ fromStatus: 'RESOLUTION_PENDING', toStatus: 'INVESTIGATING' });
  });

  it('③ 升级线：⚡simulateTimeout(RESOLVE)→clock-wall行overdue=true→escalate→事件生成(type=COMPLAINT_ESCALATION、anchors齐)→事件调查→结案经INCIDENT_CLOSE_CUSTOMER合规官批→事件关闭；escalatedIncidentNo回填；二次升级400；RESOLVED后升级400', async () => {
    const { complaintNo } = await complaints.submit(custA, {
      category: 'ORDER_EXECUTION', subject: 'e2e 升级线：兑换报价争议', description: '客户对兑换执行价格提出投诉',
    });
    await complaints.acknowledge(ops(), complaintNo, { message: 'e2e 已收悉' });
    await complaints.startInvestigation(ops(), complaintNo);

    // ⚡ 拨快确认后的裁决钟——simulateTimeout 只拨钟，不改状态。
    await complaints.simulateTimeout(ops(), complaintNo, 'RESOLVE');
    const afterFastForward = await complaints.findByNo(complaintNo);
    expect(afterFastForward.currentStatus).toBe('INVESTIGATING');
    expect(afterFastForward.resolveDeadlineAt.getTime()).toBeLessThan(Date.now());

    const wall = await clockWall.getWall();
    const wallRow = wall.find((r) => r.refNo === complaintNo);
    expect(wallRow).toBeDefined();
    expect(wallRow!.kind).toBe('COMPLAINT');
    expect(wallRow!.overdue).toBe(true);

    // 升级：建 COMPLAINT_ESCALATION 事故单 + 投诉侧 markEscalated 回填引用列。
    const { incidentNo } = await escalationWorkflow.escalate(ops(), complaintNo);
    expect(incidentNo).toMatch(/^INC/);
    const incidentRow = await incidents.findByNo(incidentNo);
    expect(incidentRow.type).toBe(IncidentTypes.COMPLAINT_ESCALATION);
    expect(incidentRow.status).toBe('REGISTERED');
    // anchors 齐：ownerCustomerNo 落存量 customerNo 列，complaintNo 落 subjectRefs。
    expect(incidentRow.customerNo).toBe(custA);
    expect(JSON.parse(incidentRow.subjectRefs as string)).toEqual({ complaintNo });
    expect((await complaints.findByNo(complaintNo)).escalatedIncidentNo).toBe(incidentNo);

    // 事件调查 → 定损（IMPACT 口径，零通报——不依赖报送台）→ 结案（合规官单步）。
    await incidents.startInvestigation(incidentNo, ops());
    expect((await incidents.findByNo(incidentNo)).status).toBe('INVESTIGATING');

    await incidents.assess(incidentNo, {
      assessmentBasis: 'SERVICE_IMPACT', impactSummary: 'e2e：客户报价执行争议已核实', reportRequired: false,
    }, ops());
    expect((await incidents.findByNo(incidentNo)).status).toBe('ASSESSED');

    const { approvalNo: closeApprovalNo } = await closeWorkflow.requestClose(incidentNo, ops());
    const closeApprovalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: closeApprovalNo } });
    expect(closeApprovalRow.actionType).toBe(ApprovalActionTypes.INCIDENT_CLOSE_CUSTOMER);

    await approvalsService.approve(closeApprovalNo, { reason: 'e2e 合规官批准结案' }, compliance());
    await waitUntil(async () => (await incidents.findByNo(incidentNo)).status === 'CLOSED');
    expect((await incidents.findByNo(incidentNo)).closedAt).not.toBeNull();

    // 二次升级 400（escalatedIncidentNo 已非空）。
    await expect(escalationWorkflow.escalate(ops(), complaintNo)).rejects.toThrow(/must be in an investigating status/);

    // RESOLVED 后升级 400（复用 ① 的 complaint1No，① 已把它跑到 RESOLVED 终态）。
    expect(complaint1No).toBeDefined();
    expect((await complaints.findByNo(complaint1No)).currentStatus).toBe('RESOLVED');
    await expect(escalationWorkflow.escalate(ops(), complaint1No)).rejects.toThrow(/must be in an investigating status/);
  });

  it('④ 门与归属：/admin/incidents 手工登记 COMPLAINT_ESCALATION 400（门不可绕）；别的客户查不到不属于自己的投诉（查无，非403）', async () => {
    // 手工登记入口（HTTP 层真正入口 IncidentRegistrationWorkflowService.register）——
    // 门在 assertOperator 之前（T4 修复轮 1），任意 actor 都拒，不因经办桶而漏过。
    await expect(registrationWorkflow.register({
      type: IncidentTypes.COMPLAINT_ESCALATION, title: 'e2e 手工登记（应拒）', description: '尝试绕过升级 workflow 手工建 CUSTOMER 族事故',
    }, ops())).rejects.toThrow(/cannot be registered manually/);

    // 跨客户查无：complaint1No 归 custA 所有，custB 用自己的号查它——统一收成 404，
    // 不是 403（不向非归属客户确认"这个号真实存在"，同 material-requests 惯例，见
    // ComplaintsService.getForCustomer 注释）。这与 brief「客户A查客户B投诉」是同一条
    // 归属边界性质的验证：任何非归属客户号都查不到不属于自己的单。
    expect(complaint1No).toBeDefined();
    await expect(complaints.getForCustomer(custB, complaint1No)).rejects.toThrow(/Complaint not found/);
  });
});
