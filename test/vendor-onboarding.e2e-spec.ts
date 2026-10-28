import * as path from 'path';
import * as dotenv from 'dotenv';

// 同 compliance-office.e2e-spec.ts：Node 18 polyfill（@nestjs/schedule 需要 globalThis.crypto），
// 且 PrismaService / TigerBeetleService 要在任何其它 import 之前看到本 worktree 的 DATABASE_URL / TB_ADDRESS。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { RegulatoryFilingService } from '../src/modules/governance/regulatory-filings/regulatory-filing.service';
import { RegulatoryFilingWorkflowService } from '../src/modules/governance/regulatory-filings/regulatory-filing-workflow.service';
import { OutsourcingVendorsService } from '../src/modules/governance/compliance-office/outsourcing-vendors.service';
import { OutsourcingVendorWorkflowService } from '../src/modules/governance/compliance-office/outsourcing-vendor-workflow.service';
import { ApplyVendorBodyDto } from '../src/modules/governance/compliance-office/dto/compliance-office.dto';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * 甲波六 T7 · 服务商 VARA 报备门 e2e：真 AppModule 零 mock，与既有 e2e 串行（同一 SQLite 库 + 同一 TigerBeetle，见 jest-e2e.json 头注释）。
 *
 * 自证原则（同 compliance-office.e2e-spec.ts）：本文件一律自造服务商 / 报送单自证，断言只锚定自己创建的 vendorNo / filingNo，
 * 不依赖种子行；告知单经服务商自己记的 notificationFilingNo 与审计 metadata（含 vendorNo）反查，不依赖行数。
 *
 * 两段：
 *   ① 重大服务商全程：申请 → 评估 + CISO → 送审 → CFO 批 → 高管批 → PENDING_NOTIFICATION + 报送台出现 DRAFT 告知单并盖章
 *      → 告知单走完 送签 → 高管批 → mark-submitted(带回执号) → 服务商 ACTIVE（付款门放开）→ 终止 → 报送台再出一张 termination 告知单，
 *      服务商仍 TERMINATED，那张终止单标已报送也不认领。
 *   ② 一般服务商：批准直接 ACTIVE，批准与终止都不开告知单。
 *
 * actor 工厂照 compliance-office.e2e-spec.ts：合规官必须是种子里真实绑定 COMPLIANCE_OFFICER 的管理员 id
 * （报送台 GENERAL 族 assertFamily 真查 cap.filing.general）；运营 / CISO / CFO / 高管只经 workflow 或 ApprovalsService 的
 * 候选角色比对，不查真实 DB 行绑定，随机造 id 即可。
 */
describe('Vendor onboarding VARA notification gate e2e (甲波六 · T7)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;

  let filings: RegulatoryFilingService; let filingWorkflow: RegulatoryFilingWorkflowService;
  let approvalsService: ApprovalsService;
  let vendors: OutsourcingVendorsService; let vendorWorkflow: OutsourcingVendorWorkflowService;

  let complianceUserId: string;
  const compliance = () => makeActor(complianceUserId, 'E2E_VO_COMPLIANCE', 'COMPLIANCE_OFFICER');
  const smoUserId = randomUUID(); const opsUserId = randomUUID(); const cisoUserId = randomUUID(); const cfoUserId = randomUUID();
  const smo = () => makeActor(smoUserId, 'E2E_VO_SMO', 'SENIOR_MANAGEMENT_OFFICER');
  const ops = () => makeActor(opsUserId, 'E2E_VO_OPS', 'OPS_OFFICER');
  const ciso = () => makeActor(cisoUserId, 'E2E_VO_CISO', 'CISO');
  const cfo = () => makeActor(cfoUserId, 'E2E_VO_CFO', 'CFO');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0); // 审批 handler 已逾默认 10 个监听上限，同 compliance-office.e2e-spec.ts
    await app.init();
    prisma = app.get(PrismaService);

    filings = app.get(RegulatoryFilingService);
    filingWorkflow = app.get(RegulatoryFilingWorkflowService);
    approvalsService = app.get(ApprovalsService);
    vendors = app.get(OutsourcingVendorsService);
    vendorWorkflow = app.get(OutsourcingVendorWorkflowService);

    const complianceUser = await (prisma as any).user.findFirst({ where: { email: 'compliance_lead@fiatx.com' } });
    if (!complianceUser) throw new Error('Fixture role-seed admin (COMPLIANCE_OFFICER) not seeded — run `bash scripts/stack.sh reset self` first.');
    complianceUserId = complianceUser.id;
  });
  afterAll(async () => { if (app) await app.close(); });

  function makeActor(userId: string, userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  const auditActionsFor = async (subjectType: string, subjectNo: string): Promise<string[]> => {
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectType: subjectType, primarySubjectNo: subjectNo },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r: any) => r.action as string);
  };
  /** 直读库里的服务商状态（断言的是 outsourcing_vendors 表本身，不是服务返回值）。 */
  const vendorRow = (vendorNo: string) => (prisma as any).outsourcingVendor.findUnique({ where: { vendorNo } });

  const vendorForm = (overrides: Partial<ApplyVendorBodyDto> = {}): ApplyVendorBodyDto => ({
    name: 'e2e T7 Office Printing Ltd', registeredIn: 'United Arab Emirates (Dubai)', registrationNo: 'DED-E2E-T7-0001',
    deliveryLocations: ['AE'], contactName: 'E2E Contact', contactEmail: 'contact@e2e-t7-vendor.example',
    beneficialOwners: [{ seq: 1, name: 'E2E T7 Owner One' }],
    serviceDescription: 'Outsourced printing and mailing', regulatedFunction: false, contractStart: '2026-11-01',
    involvesPersonalData: false, involvesConfidentialInfo: false, applicationReason: 'e2e T7 vendor onboarding',
    impactLicence: false, impactLegal: false, impactFinancial: false, impactContinuity: false, replaceability: 'EASY',
    ...overrides,
  });

  async function screenAndRate(vendorNo: string, form: ApplyVendorBodyDto) {
    await vendorWorkflow.recordScreening(vendorNo, { subjectKind: 'COMPANY', subjectName: form.name, listsChecked: ['UN', 'OFAC'], result: 'GREEN' }, compliance());
    for (const o of form.beneficialOwners ?? []) {
      await vendorWorkflow.recordScreening(vendorNo, { subjectKind: 'BENEFICIAL_OWNER', subjectName: o.name, uboSeq: o.seq, listsChecked: ['UN', 'OFAC', 'PEP'], result: 'GREEN' }, compliance());
    }
    await vendorWorkflow.saveAssessment(vendorNo, { riskTier: 'LOW', opinion: 'e2e T7: clean file' }, compliance());
  }

  /** 报送单沿既有 GENERAL 族报送链走到 SUBMITTED：送签 → 高管批 → 等 SIGNED_OFF → mark-submitted（带回执号）。 */
  async function takeFilingToSubmitted(filingNo: string, externalRef: string) {
    const signoff = await filingWorkflow.submitForSignoff(filingNo, compliance());
    const approvalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: signoff.approvalNo } });
    expect(approvalRow.actionType).toBe(ApprovalActionTypes.REG_FILING_SUBMIT);
    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e T7 SMO signoff vendor notification' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'SIGNED_OFF');
    await filings.markSubmitted(filingNo, { externalRef }, compliance());
  }

  /** 报送台里与某服务商有关的 FILING_OPENED 审计（metadata 含 vendorNo；vendorNo 每次运行唯一）。 */
  const filingOpenedFor = (vendorNo: string) => (prisma as any).auditLogEvent.findMany({
    where: { primarySubjectType: 'REGULATORY_FILING', action: AuditActions.FILING_OPENED, metadata: { contains: vendorNo } },
    orderBy: { seq: 'asc' },
  });

  it('① 重大服务商：批准 → 待报备 + 自动开告知单盖章 → 告知单走到「已报送」→ ACTIVE → 终止再开一张告知单且不认领', async () => {
    const form = vendorForm({ name: 'e2e T7 Core Ledger Hosting LLC', impactContinuity: true, deliveryLocations: ['AE', 'IE'] });
    const { vendorNo, criticality } = await vendorWorkflow.apply(form, ops());
    expect(criticality).toBe('MATERIAL');

    await screenAndRate(vendorNo, form);
    await vendorWorkflow.recordInfosec(vendorNo, {
      soc2: 'HAS', iso27001: 'HAS', dataLocationAcceptable: true, drPlanAcceptable: true, opinion: 'e2e T7: acceptable', verdict: 'ACCEPTABLE',
    }, ciso());
    const sent = await vendorWorkflow.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance());
    expect(sent.status).toBe('PENDING_APPROVAL');
    const approvalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: sent.approvalNo } });
    expect(approvalRow.actionType).toBe(ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL);

    // CFO → 高管两步；第一步批完还没落地
    await approvalsService.approve(sent.approvalNo!, { reason: 'e2e T7 CFO step' }, cfo());
    expect((await vendorRow(vendorNo)).status).toBe('PENDING_APPROVAL');
    await approvalsService.approve(sent.approvalNo!, { reason: 'e2e T7 SMO step' }, smo());

    // 批准落地：PENDING_NOTIFICATION，随后报送台开出告知单、单号盖回服务商（开单在迁状态之后，故等盖章）
    await waitUntil(async () => !!(await vendorRow(vendorNo)).notificationFilingNo);
    const stamped = await vendorRow(vendorNo);
    expect(stamped.status).toBe('PENDING_NOTIFICATION');
    const filingNo = stamped.notificationFilingNo as string;
    expect(filingNo).toMatch(/^FIL/);
    await expect(vendors.assertActiveByNo(vendorNo)).rejects.toThrow(/not ACTIVE/); // 报备门：待报备付不了款

    const onboardingFiling = await filings.findByNo(filingNo);
    expect(onboardingFiling).toMatchObject({
      type: 'MATERIAL_CHANGE_NOTIFICATION', status: 'DRAFT', createdByUserId: 'SYSTEM', authority: 'VARA', deadlineAt: null,
      title: 'Material outsourcing — e2e T7 Core Ledger Hosting LLC: onboarding',
    });
    expect(onboardingFiling.body).toBe([
      'Provider: e2e T7 Core Ledger Hosting LLC',
      'Scope: Outsourced printing and mailing',
      'Delivery & data locations: AE, IE',
      'Materiality: MATERIAL',
      'Contract start: 2026-11-01',
    ].join('\n'));
    const opened = await filingOpenedFor(vendorNo);
    expect(opened).toHaveLength(1);
    expect(opened[0].primarySubjectNo).toBe(filingNo);
    expect(JSON.parse(opened[0].metadata)).toMatchObject({ source: 'VENDOR_ONBOARDING', vendorNo, approvalNo: sent.approvalNo });
    expect(opened[0].approvalNo).toBe(sent.approvalNo);

    expect(await auditActionsFor('OUTSOURCING_VENDOR', vendorNo)).toEqual([
      AuditActions.VENDOR_APPLIED, AuditActions.VENDOR_SENT_FOR_APPROVAL, AuditActions.VENDOR_APPROVED, AuditActions.VENDOR_NOTIFICATION_OPENED,
    ]);

    // 告知单走到 SIGNED_OFF 还不够——只有 SUBMITTED 才认领；之前服务商一直待报备
    const signoff = await filingWorkflow.submitForSignoff(filingNo, compliance());
    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e T7 SMO signoff vendor notification' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'SIGNED_OFF');
    await new Promise((r) => setTimeout(r, 300));
    expect((await vendorRow(vendorNo)).status).toBe('PENDING_NOTIFICATION');

    // 合规官 mark-submitted（填 VARA 回执号）→ 报送台发「已报送」→ 服务商认领 → ACTIVE
    await filings.markSubmitted(filingNo, { externalRef: 'VARA-NOTIF-E2E-T7-001' }, compliance());
    expect((await filings.findByNo(filingNo)).status).toBe('SUBMITTED');
    await waitUntil(async () => (await vendorRow(vendorNo)).status === 'ACTIVE');
    await expect(vendors.assertActiveByNo(vendorNo)).resolves.toBeUndefined(); // 报备门放开：可以付款

    expect(await auditActionsFor('OUTSOURCING_VENDOR', vendorNo)).toEqual([
      AuditActions.VENDOR_APPLIED, AuditActions.VENDOR_SENT_FOR_APPROVAL, AuditActions.VENDOR_APPROVED,
      AuditActions.VENDOR_NOTIFICATION_OPENED, AuditActions.VENDOR_ACTIVATED,
    ]);
    const activated = await (prisma as any).auditLogEvent.findFirst({
      where: { primarySubjectType: 'OUTSOURCING_VENDOR', primarySubjectNo: vendorNo, action: AuditActions.VENDOR_ACTIVATED },
    });
    expect(activated).toMatchObject({ fromStatus: 'PENDING_NOTIFICATION', toStatus: 'ACTIVE', causationId: filingNo });
    expect(activated.reason).toContain('VARA-NOTIF-E2E-T7-001');

    // 终止（合规官）：服务商先 TERMINATED，报送台随后再出一张 termination 告知单——不盖章、不卡终止
    await vendorWorkflow.terminate(vendorNo, { notes: 'e2e T7: exit hosting contract' }, compliance());
    expect((await vendorRow(vendorNo)).status).toBe('TERMINATED');
    await waitUntil(async () => (await filingOpenedFor(vendorNo)).length === 2);
    const terminationOpened = (await filingOpenedFor(vendorNo))[1];
    expect(JSON.parse(terminationOpened.metadata)).toMatchObject({ source: 'VENDOR_TERMINATION', vendorNo });
    const terminationFilingNo = terminationOpened.primarySubjectNo as string;
    expect(terminationFilingNo).not.toBe(filingNo);
    expect(await filings.findByNo(terminationFilingNo)).toMatchObject({
      type: 'MATERIAL_CHANGE_NOTIFICATION', status: 'DRAFT', createdByUserId: 'SYSTEM',
      title: 'Material outsourcing — e2e T7 Core Ledger Hosting LLC: termination',
    });
    expect((await vendorRow(vendorNo)).notificationFilingNo).toBe(filingNo); // 终止单没盖章：服务商记的还是入驻那张

    // 终止那张单标已报送：事件照发，但没有任何服务商认领它——服务商仍 TERMINATED，审计不多一行
    await takeFilingToSubmitted(terminationFilingNo, 'VARA-NOTIF-E2E-T7-002');
    await new Promise((r) => setTimeout(r, 300));
    expect((await vendorRow(vendorNo)).status).toBe('TERMINATED');
    expect(await auditActionsFor('OUTSOURCING_VENDOR', vendorNo)).toEqual([
      AuditActions.VENDOR_APPLIED, AuditActions.VENDOR_SENT_FOR_APPROVAL, AuditActions.VENDOR_APPROVED,
      AuditActions.VENDOR_NOTIFICATION_OPENED, AuditActions.VENDOR_ACTIVATED, AuditActions.VENDOR_TERMINATED,
    ]);
  });

  it('② 一般服务商：批准直接 ACTIVE、终止后仍 TERMINATED，全程不开告知单', async () => {
    const form = vendorForm({ name: 'e2e T7 Office Printing Ltd' });
    const { vendorNo, criticality } = await vendorWorkflow.apply(form, ops());
    expect(criticality).toBe('NON_MATERIAL');
    await screenAndRate(vendorNo, form);
    const sent = await vendorWorkflow.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance());
    await approvalsService.approve(sent.approvalNo!, { reason: 'e2e T7 CFO approve' }, cfo());
    await waitUntil(async () => (await vendorRow(vendorNo)).status === 'ACTIVE');

    await vendorWorkflow.terminate(vendorNo, { notes: 'e2e T7: contract ended' }, compliance());
    expect((await vendorRow(vendorNo)).status).toBe('TERMINATED');
    await new Promise((r) => setTimeout(r, 300)); // 给一个事件循环周期的余量，再断言「没有」
    expect(await filingOpenedFor(vendorNo)).toHaveLength(0);
    expect((await vendorRow(vendorNo)).notificationFilingNo).toBeNull();
    expect(await auditActionsFor('OUTSOURCING_VENDOR', vendorNo)).toEqual([
      AuditActions.VENDOR_APPLIED, AuditActions.VENDOR_SENT_FOR_APPROVAL, AuditActions.VENDOR_APPROVED, AuditActions.VENDOR_TERMINATED,
    ]);
  });
});
