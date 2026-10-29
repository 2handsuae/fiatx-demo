// 甲波六 T6 · OutsourcingVendorWorkflowService 行为测试（照 lp-profile-workflow.service.spec.ts 先例：直接 new 实例）。
// 服务商服务是**真的**（真迁移表 + 真 ACTION_BY_EDGE + 真 assertActionSpec）：状态流转与审计码是行为证据，
// 不是读 mock 调用次数；审批引擎 / 尽调评估 / 文件存储是 mock——它们各自的行为在自己的 spec 里。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
import { OutsourcingVendorWorkflowService } from './outsourcing-vendor-workflow.service';
import { OutsourcingVendorApprovalService, OutsourcingVendorMaterialApprovalService } from './outsourcing-vendor-approval.service';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';
import { VendorStatus } from './compliance-office.constants';
import { ApplyVendorBodyDto } from './dto/compliance-office.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { LP_DOC_TYPES, VENDOR_DOC_TYPES } from '../../../core/documents/documents.constants';

const ops = { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] };
const compliance = { actorType: 'ADMIN' as const, userId: 'uuid-compliance', userNo: 'ADM-COMPLIANCE', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] };
const ciso = { actorType: 'ADMIN' as const, userId: 'uuid-ciso', userNo: 'ADM-CISO', role: 'CISO', roleCodes: ['CISO'] };

const dto = (overrides: Partial<ApplyVendorBodyDto> = {}): ApplyVendorBodyDto => ({
  name: 'Nimbus Cloud Hosting LLC',
  registeredIn: 'United Arab Emirates (Dubai)',
  registrationNo: 'DED-778812',
  deliveryLocations: ['AE', 'IE'],
  contactName: 'Sara Khan',
  contactEmail: 'sara@nimbus.example',
  beneficialOwners: [{ seq: 1, name: 'Omar Nasser' }, { seq: 2, name: 'Li Wei' }],
  serviceDescription: 'Managed cloud hosting for back-office systems',
  regulatedFunction: false,
  contractStart: '2026-11-01',
  involvesPersonalData: true,
  involvesConfidentialInfo: false,
  applicationReason: 'Move back-office hosting off the legacy datacentre',
  impactLicence: false,
  impactLegal: false,
  impactFinancial: false,
  impactContinuity: false,
  replaceability: 'EASY',
  ...overrides,
});

const ASSESSMENT_NO = 'DDA260101000001';
const FILING_NO = 'FIL260101000001';
const assessmentView = (overrides: Record<string, unknown> = {}) => ({
  assessmentNo: ASSESSMENT_NO, targetType: 'OUTSOURCING_VENDOR', targetNo: 'x',
  riskTier: 'LOW', opinion: 'Clean file, standard hosting terms', conditions: null,
  conclusion: null, conclusionReason: null, concludedAt: null, infosec: null,
  screeningRecords: [], flags: { hasRed: false, missingNames: [], infosecBlocked: false },
  ...overrides,
});

const pdf = { originalname: 'contract.pdf', mimetype: 'application/pdf', size: 4, buffer: Buffer.from('%PDF') };

function makeDecidedEvent(vendorNo: string, overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.VENDOR_APPROVAL,
    entityRef: vendorNo,
    approvalId: 'causation-id-1',
    approvalNo: 'APR-VEN-1',
    traceId: 'trace-1',
    workflowType: 'OUTSOURCING_VENDOR',
    decisionByUserId: 'uuid-cfo',
    decisionByUserNo: 'ADM-CFO',
    decisionByRole: 'CFO',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function buildDeps() {
  const rows = new Map<string, any>();
  const prisma = {
    outsourcingVendor: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, notificationFilingNo: null, criticalityReason: null, notes: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(row.vendorNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...rows.get(where.vendorNo), ...data };
        rows.set(where.vendorNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.vendorNo) ?? null),
      // 按 where 的每个键值真匹配（不是无视过滤的 mock）——findByNotificationFilingNo 靠它按告知单号反查
      findFirst: jest.fn(async ({ where }: any) =>
        [...rows.values()].find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null),
    },
  };
  // 生产那道词表校验亲自跑一遍每条信封（缺必填 / 缺 causation / 域不符都会当场抛，同生产）
  const realSpec = new AuditLogsService(null as any);
  const audits: Array<{ via: 'actor' | 'system'; input: any }> = [];
  const auditLogs = {
    recordByActor: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'actor', input }); }),
    recordSystem: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'system', input }); }),
  };
  const vendors = new OutsourcingVendorsService(prisma as any, auditLogs as any);
  const approvals = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-VEN-1' })) };
  const dueDiligence = {
    open: jest.fn(async () => ({ assessmentNo: ASSESSMENT_NO })),
    getView: jest.fn(async () => assessmentView()),
    recordScreening: jest.fn(async () => ({ recordNo: 'SCR260101000001' })),
    attachEvidence: jest.fn(async () => ({ docNo: 'DOC260101000002' })),
    saveAssessment: jest.fn(async () => undefined),
    recordInfosec: jest.fn(async () => undefined),
    assertSendable: jest.fn(async () => undefined),
    assertReturnable: jest.fn(async () => undefined),
    conclude: jest.fn(async () => undefined),
  };
  const documents = {
    store: jest.fn(async () => ({ docNo: 'DOC260101000001' })),
    listByOwner: jest.fn(async () => [{ docNo: 'DOC260101000001', docType: 'CONTRACT' }]),
  };
  const filings = { openForVendorNotification: jest.fn(async (_input: any) => ({ filingNo: FILING_NO })) };
  const svc = new OutsourcingVendorWorkflowService(vendors, approvals as any, dueDiligence as any, documents as any, filings as any);
  return { svc, vendors, prisma, rows, audits, approvals, dueDiligence, documents, filings };
}
type Deps = ReturnType<typeof buildDeps>;

/** 经 apply 申请一家（overrides 里给 impactContinuity: true 即判 MATERIAL），再按需把它摆到指定状态（审计清零，让断言只看被测那一步）。 */
async function seedVendor(
  deps: Deps,
  status: string = VendorStatus.PENDING_ASSESSMENT,
  overrides: Partial<ApplyVendorBodyDto> = {},
): Promise<string> {
  const { vendorNo } = await deps.svc.apply(dto(overrides), ops);
  deps.rows.set(vendorNo, { ...deps.rows.get(vendorNo), status });
  deps.audits.length = 0;
  deps.dueDiligence.open.mockClear();
  return vendorNo;
}

describe('OutsourcingVendorWorkflowService.apply', () => {
  it.each(['impactLicence', 'impactLegal', 'impactFinancial', 'impactContinuity'] as const)('四问里只有 %s 答「会」→ MATERIAL', async (key) => {
    const deps = buildDeps();
    const { vendorNo, criticality } = await deps.svc.apply(dto({ [key]: true }), ops);
    expect(criticality).toBe('MATERIAL');
    expect(deps.rows.get(vendorNo).criticality).toBe('MATERIAL');
  });

  it('四问全「不会」→ NON_MATERIAL；落 PENDING_ASSESSMENT、开尽调评估壳、不开审批单；审计只有一条 VENDOR_APPLIED', async () => {
    const deps = buildDeps();

    const result = await deps.svc.apply(dto(), ops);

    const [vendorNo] = [...deps.rows.keys()];
    expect(result).toEqual({ vendorNo, status: VendorStatus.PENDING_ASSESSMENT, criticality: 'NON_MATERIAL' });
    expect(deps.rows.get(vendorNo)).toMatchObject({ status: 'PENDING_ASSESSMENT', criticality: 'NON_MATERIAL', approvalNo: null, createdByUserId: 'ADM-OPS' });
    expect(deps.dueDiligence.open).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, ops);
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled(); // 先评估后审批：此刻审批中心什么都没有
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_APPLIED']);
    // 服务商先于评估壳落库（壳挂在 vendorNo 上）
    expect(deps.prisma.outsourcingVendor.create.mock.invocationCallOrder[0]).toBeLessThan(deps.dueDiligence.open.mock.invocationCallOrder[0]);
  });

  it('受监管职能答是却缺牌照信息 → 400，既没建服务商也没开评估壳', async () => {
    const deps = buildDeps();
    await expect(deps.svc.apply(dto({ regulatedFunction: true }), ops)).rejects.toThrow(BadRequestException);
    expect(deps.rows.size).toBe(0);
    expect(deps.dueDiligence.open).not.toHaveBeenCalled();
    expect(deps.audits).toEqual([]);
  });
});

describe('OutsourcingVendorWorkflowService.resubmit', () => {
  it('RETURNED → 整行覆盖并回 PENDING_ASSESSMENT；评估壳不重开', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.RETURNED);

    const result = await deps.svc.resubmit(vendorNo, dto({ registrationNo: 'DED-999' }), ops);

    expect(result).toEqual({ vendorNo, status: VendorStatus.PENDING_ASSESSMENT, criticality: 'NON_MATERIAL' });
    expect(deps.rows.get(vendorNo)).toMatchObject({ registrationNo: 'DED-999', status: VendorStatus.PENDING_ASSESSMENT });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_RESUBMITTED']);
    expect(deps.dueDiligence.open).not.toHaveBeenCalled();
  });

  it('原 MATERIAL 改答全「不会」仍 MATERIAL（不得降档）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.RETURNED, { impactContinuity: true });
    expect(deps.rows.get(vendorNo).criticality).toBe('MATERIAL');

    const result = await deps.svc.resubmit(vendorNo, dto(), ops);

    expect(result.criticality).toBe('MATERIAL');
    expect(deps.rows.get(vendorNo).criticality).toBe('MATERIAL');
  });

  it('合规升档过的服务商（四问原本全「不会」）重提后仍 MATERIAL', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT);
    await deps.svc.upgradeMateriality(vendorNo, { reason: 'Hosts the ledger replica' }, compliance);
    deps.rows.set(vendorNo, { ...deps.rows.get(vendorNo), status: VendorStatus.RETURNED });

    await deps.svc.resubmit(vendorNo, dto(), ops);

    expect(deps.rows.get(vendorNo)).toMatchObject({ criticality: 'MATERIAL', criticalityReason: 'Hosts the ledger replica' });
  });

  it('非 RETURNED 态拒绝（待批中不能借「重提」把单子拉回待评估）；行不变、零审计', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);
    await expect(deps.svc.resubmit(vendorNo, dto(), ops)).rejects.toThrow(BadRequestException);
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_APPROVAL);
    expect(deps.audits).toEqual([]);
  });
});

describe('OutsourcingVendorWorkflowService.upgradeMateriality', () => {
  it('NON_MATERIAL → MATERIAL 带 reason 审计；窗口内（PENDING_ASSESSMENT / RETURNED）都行', async () => {
    for (const status of [VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED]) {
      const deps = buildDeps();
      const vendorNo = await seedVendor(deps, status);

      await deps.svc.upgradeMateriality(vendorNo, { reason: 'Hosts customer PII' }, compliance);

      expect(deps.rows.get(vendorNo)).toMatchObject({ criticality: 'MATERIAL', criticalityReason: 'Hosts customer PII', status });
      expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_MATERIALITY_UPGRADED']);
      expect(deps.audits[0].input.reason).toBe('Hosts customer PII');
    }
  });

  it('MATERIAL 再升 → 400，零审计', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT, { impactContinuity: true });
    await expect(deps.svc.upgradeMateriality(vendorNo, { reason: 'again' }, compliance)).rejects.toThrow(BadRequestException);
    expect(deps.audits).toEqual([]);
  });

  it.each([VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION, VendorStatus.ACTIVE, VendorStatus.REJECTED, VendorStatus.TERMINATED])(
    '%s 态：升档被锁（送审后重大性不可变——审批路线已定），行不变、零审计',
    async (status) => {
      const deps = buildDeps();
      const vendorNo = await seedVendor(deps, status);
      await expect(deps.svc.upgradeMateriality(vendorNo, { reason: 'late upgrade' }, compliance)).rejects.toThrow('Assessment is locked');
      expect(deps.rows.get(vendorNo)).toMatchObject({ criticality: 'NON_MATERIAL', criticalityReason: null });
      expect(deps.audits).toEqual([]);
    },
  );

  it('升档后评估的 CISO 要求随档变化：getAssessment 开始要求信息安全评估', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    await deps.svc.getAssessment(vendorNo);
    expect(deps.dueDiligence.getView).toHaveBeenLastCalledWith('OUTSOURCING_VENDOR', vendorNo, expect.objectContaining({ requireInfosec: false }));

    await deps.svc.upgradeMateriality(vendorNo, { reason: 'Hosts customer PII' }, compliance);
    await deps.svc.getAssessment(vendorNo);
    expect(deps.dueDiligence.getView).toHaveBeenLastCalledWith('OUTSOURCING_VENDOR', vendorNo, expect.objectContaining({ requireInfosec: true }));
  });
});

describe('OutsourcingVendorWorkflowService.conclude — 通过并送审（SENT_FOR_APPROVAL）', () => {
  it('NON_MATERIAL 开 VENDOR_APPROVAL（CFO 单步）；提单人 = 合规官，理由 = 评估意见，快照零 UUID', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    deps.dueDiligence.getView.mockResolvedValue(assessmentView({ riskTier: 'MEDIUM' }) as any);

    const result = await deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    expect(result).toEqual({ vendorNo, status: VendorStatus.PENDING_APPROVAL, approvalNo: 'APR-VEN-1' });
    expect(deps.approvals.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(deps.approvals.createAndSubmit).toHaveBeenCalledWith(
      {
        actionType: ApprovalActionTypes.VENDOR_APPROVAL,
        entityRef: vendorNo,
        objectSnapshot: {
          vendorNo, name: 'Nimbus Cloud Hosting LLC', serviceDescription: 'Managed cloud hosting for back-office systems',
          criticality: 'NON_MATERIAL', deliveryLocations: ['AE', 'IE'], riskTier: 'MEDIUM', assessmentNo: ASSESSMENT_NO,
        },
      },
      { reason: 'Clean file, standard hosting terms' },
      compliance,
    );
    expect(deps.rows.get(vendorNo)).toMatchObject({ status: VendorStatus.PENDING_APPROVAL, approvalNo: 'APR-VEN-1' });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_SENT_FOR_APPROVAL']);
    expect(deps.audits[0].input).toMatchObject({ fromStatus: 'PENDING_ASSESSMENT', toStatus: 'PENDING_APPROVAL' });
    expect(deps.audits[0].via).toBe('actor'); // 送审是合规官的手
  });

  it('MATERIAL 开 VENDOR_MATERIAL_APPROVAL（CFO→高管两步），快照里重大性写 MATERIAL', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT, { impactContinuity: true });

    await deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    expect(deps.approvals.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL, entityRef: vendorNo, objectSnapshot: expect.objectContaining({ criticality: 'MATERIAL' }) }),
      { reason: 'Clean file, standard hosting terms' },
      compliance,
    );
  });

  it('合规升档后的服务商同样走 VENDOR_MATERIAL_APPROVAL（路线跟着当前重大性，不跟申请时的自判）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    await deps.svc.upgradeMateriality(vendorNo, { reason: 'Hosts customer PII' }, compliance);

    await deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    expect(deps.approvals.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL }), expect.anything(), compliance,
    );
  });

  it('调用顺序钉死：assertSendable → conclude → transition(PENDING_APPROVAL) → createAndSubmit → stampApprovalNo', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    const transition = jest.spyOn(deps.vendors, 'transition');
    const stamp = jest.spyOn(deps.vendors, 'stampApprovalNo');

    await deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    const order = (m: jest.Mock | jest.SpyInstance) => m.mock.invocationCallOrder[0];
    expect(order(deps.dueDiligence.assertSendable)).toBeLessThan(order(deps.dueDiligence.conclude));
    expect(order(deps.dueDiligence.conclude)).toBeLessThan(order(transition));
    expect(order(transition)).toBeLessThan(order(deps.approvals.createAndSubmit));
    expect(order(deps.approvals.createAndSubmit)).toBeLessThan(order(stamp));
    expect(transition).toHaveBeenCalledWith(vendorNo, VendorStatus.PENDING_APPROVAL, {}, expect.objectContaining({ actor: compliance }));
    expect(deps.dueDiligence.conclude).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
  });

  it('送审检查拿的是申请表眼下的名单：公司名 + 解析出的实控人 {seq,name}；requireInfosec 随档（一般 false / 重大 true）', async () => {
    const deps = buildDeps();
    const normal = await seedVendor(deps);
    await deps.svc.conclude(normal, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
    expect(deps.dueDiligence.assertSendable).toHaveBeenLastCalledWith('OUTSOURCING_VENDOR', normal, {
      companyName: 'Nimbus Cloud Hosting LLC',
      beneficialOwners: [{ seq: 1, name: 'Omar Nasser' }, { seq: 2, name: 'Li Wei' }],
      requireInfosec: false,
    });

    const major = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT, { impactContinuity: true });
    await deps.svc.conclude(major, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
    expect(deps.dueDiligence.assertSendable).toHaveBeenLastCalledWith('OUTSOURCING_VENDOR', major, expect.objectContaining({ requireInfosec: true }));
  });

  it('assertSendable 抛（缺名 / 红灯 / 等 CISO …）→ 不落结论、不迁状态、不开单、不留痕', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT, { impactContinuity: true });
    deps.dueDiligence.assertSendable.mockRejectedValue(new BadRequestException('Waiting for CISO information-security assessment'));

    await expect(deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance)).rejects.toThrow(/CISO/);

    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled();
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo)).toMatchObject({ status: VendorStatus.PENDING_ASSESSMENT, approvalNo: null });
    expect(deps.audits).toEqual([]);
  });
});

describe('OutsourcingVendorWorkflowService.conclude — 退回补料 / 不通过', () => {
  it('RETURNED：落结论 → 迁 RETURNED 带原因；运营 resubmit 后回 PENDING_ASSESSMENT', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);

    const result = await deps.svc.conclude(vendorNo, { conclusion: 'RETURNED', reason: 'Contract copy is unsigned' }, compliance);

    expect(result).toEqual({ vendorNo, status: VendorStatus.RETURNED });
    expect(deps.dueDiligence.conclude).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, { conclusion: 'RETURNED', reason: 'Contract copy is unsigned' }, compliance);
    expect(deps.dueDiligence.assertSendable).not.toHaveBeenCalled(); // 送审硬规则只拦「通过并送审」
    // 退回只过「红灯 / CISO 不可接受」这一道（只有绿 / 黄时放行），且先于落结论
    expect(deps.dueDiligence.assertReturnable).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo);
    expect(deps.dueDiligence.assertReturnable.mock.invocationCallOrder[0]).toBeLessThan(deps.dueDiligence.conclude.mock.invocationCallOrder[0]);
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_RETURNED']);
    expect(deps.audits[0].input).toMatchObject({ reason: 'Contract copy is unsigned', fromStatus: 'PENDING_ASSESSMENT', toStatus: 'RETURNED' });

    await deps.svc.resubmit(vendorNo, dto(), ops);
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_RETURNED', 'VENDOR_RESUBMITTED']);
  });

  it('RETURNED 撞红灯（任一筛查记录为红）→ 400 只许不通过；不落结论、不迁状态、不留痕', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    deps.dueDiligence.assertReturnable.mockRejectedValue(new BadRequestException('Screening hit (RED) — only REJECT is allowed'));

    await expect(deps.svc.conclude(vendorNo, { conclusion: 'RETURNED', reason: 'Please re-upload' }, compliance)).rejects.toThrow('Screening hit (RED) — only REJECT is allowed');

    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
    expect(deps.audits).toEqual([]);
  });

  it('重大服务商 CISO 结论不可接受时 RETURNED → 400 只许不通过；不落结论、不迁状态、不留痕', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT, { impactContinuity: true });
    deps.dueDiligence.assertReturnable.mockRejectedValue(new BadRequestException('CISO verdict UNACCEPTABLE — only REJECT is allowed'));

    await expect(deps.svc.conclude(vendorNo, { conclusion: 'RETURNED', reason: 'Ask for a better DR plan' }, compliance)).rejects.toThrow('CISO verdict UNACCEPTABLE — only REJECT is allowed');

    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
    expect(deps.audits).toEqual([]);
  });

  it('REJECTED 不过退回这道闸：红灯 / CISO 不可接受下照样能不通过', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    deps.dueDiligence.assertReturnable.mockRejectedValue(new BadRequestException('CISO verdict UNACCEPTABLE — only REJECT is allowed'));

    const result = await deps.svc.conclude(vendorNo, { conclusion: 'REJECTED', reason: 'CISO: not acceptable' }, compliance);

    expect(result).toEqual({ vendorNo, status: VendorStatus.REJECTED });
    expect(deps.dueDiligence.assertReturnable).not.toHaveBeenCalled();
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_REJECTED']);
  });

  it('REJECTED：落结论 → 迁 REJECTED（终态）带原因，不开审批单', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);

    const result = await deps.svc.conclude(vendorNo, { conclusion: 'REJECTED', reason: 'Beneficial owner on a sanctions list' }, compliance);

    expect(result).toEqual({ vendorNo, status: VendorStatus.REJECTED });
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_REJECTED']);
    expect(deps.audits[0].input).toMatchObject({ reason: 'Beneficial owner on a sanctions list', fromStatus: 'PENDING_ASSESSMENT', toStatus: 'REJECTED' });
    await expect(deps.svc.resubmit(vendorNo, dto(), ops)).rejects.toThrow(BadRequestException);
  });

  it('尽调服务拒掉缺原因的退回 → 状态不动、不留痕（先落结论后迁状态）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    deps.dueDiligence.conclude.mockRejectedValue(new BadRequestException('A reason is required when the conclusion is RETURNED'));

    await expect(deps.svc.conclude(vendorNo, { conclusion: 'RETURNED' }, compliance)).rejects.toThrow(/reason is required/);

    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
    expect(deps.audits).toEqual([]);
  });

  it('RETURNED 态不能再下结论（RETURNED 只有「运营重新提交」一条出路）：先让运营重提——且什么都没写', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.RETURNED);

    for (const conclusion of ['RETURNED', 'REJECTED', 'SENT_FOR_APPROVAL']) {
      await expect(deps.svc.conclude(vendorNo, { conclusion, reason: 'x' }, compliance)).rejects.toThrow(/resubmit/i);
    }

    expect(deps.dueDiligence.assertSendable).not.toHaveBeenCalled();
    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled(); // 没留下「结论已落、状态没动」的半截子
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.RETURNED);
    expect(deps.audits).toEqual([]);
  });

  it('未知结论 → 400，且什么都没写', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    await expect(deps.svc.conclude(vendorNo, { conclusion: 'APPROVED' }, compliance)).rejects.toThrow(BadRequestException);
    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
  });
});

describe('OutsourcingVendorWorkflowService — 评估可写窗口（PENDING_ASSESSMENT | RETURNED）', () => {
  const LOCKED = [VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION, VendorStatus.ACTIVE, VendorStatus.REJECTED, VendorStatus.TERMINATED];
  const screeningDto = { subjectKind: 'COMPANY', subjectName: 'Nimbus Cloud Hosting LLC', listsChecked: ['UN'], result: 'GREEN' };
  const assessmentDto = { riskTier: 'LOW', opinion: 'Fine' };
  const infosecDto = { soc2: 'HAS', iso27001: 'NONE', dataLocationAcceptable: true, drPlanAcceptable: true, opinion: 'ok', verdict: 'ACCEPTABLE' };

  it.each(LOCKED)('%s 态：recordScreening / attachEvidence / saveAssessment / recordInfosec / conclude 一律 400 Assessment is locked，且尽调服务没被碰', async (status) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, status, { impactContinuity: true });

    await expect(deps.svc.recordScreening(vendorNo, screeningDto, compliance)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.attachEvidence(vendorNo, 'SCR260101000001', pdf, compliance)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.saveAssessment(vendorNo, assessmentDto, compliance)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.recordInfosec(vendorNo, infosecDto, ciso)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.conclude(vendorNo, { conclusion: 'REJECTED', reason: 'x' }, compliance)).rejects.toThrow('Assessment is locked');

    for (const m of ['recordScreening', 'attachEvidence', 'saveAssessment', 'recordInfosec', 'conclude', 'assertSendable', 'assertReturnable'] as const) {
      expect(deps.dueDiligence[m]).not.toHaveBeenCalled();
    }
  });

  it('recordInfosec 在 PENDING_APPROVAL 态 → 400 locked（CISO 评估随送审一起锁）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL, { impactContinuity: true });
    await expect(deps.svc.recordInfosec(vendorNo, infosecDto, ciso)).rejects.toThrow('Assessment is locked');
    expect(deps.dueDiligence.recordInfosec).not.toHaveBeenCalled();
  });

  it.each([VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED])('%s 态：筛查 / 证据 / 定档 / CISO 评估 都转调尽调服务', async (status) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, status, { impactContinuity: true });

    await expect(deps.svc.recordScreening(vendorNo, screeningDto, compliance)).resolves.toEqual({ recordNo: 'SCR260101000001' });
    await expect(deps.svc.attachEvidence(vendorNo, 'SCR260101000001', pdf, compliance)).resolves.toEqual({ docNo: 'DOC260101000002' });
    await deps.svc.saveAssessment(vendorNo, assessmentDto, compliance);
    await deps.svc.recordInfosec(vendorNo, infosecDto, ciso);

    expect(deps.dueDiligence.recordScreening).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, screeningDto, compliance);
    expect(deps.dueDiligence.attachEvidence).toHaveBeenCalledWith('SCR260101000001', pdf, compliance);
    expect(deps.dueDiligence.saveAssessment).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, assessmentDto, compliance);
    expect(deps.dueDiligence.recordInfosec).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, infosecDto, ciso);
  });

  it('未知 vendorNo → 404（窗口检查先于任何转调）', async () => {
    const deps = buildDeps();
    await expect(deps.svc.recordScreening('VEN000000000000', screeningDto, compliance)).rejects.toThrow(NotFoundException);
    await expect(deps.svc.recordInfosec('VEN000000000000', infosecDto, ciso)).rejects.toThrow(NotFoundException);
    expect(deps.dueDiligence.recordScreening).not.toHaveBeenCalled();
    expect(deps.dueDiligence.recordInfosec).not.toHaveBeenCalled();
  });
});

describe('OutsourcingVendorWorkflowService.getAssessment', () => {
  it('带上申请表眼下的名单取视图（否则 missingNames 恒空，前端会把它读成「全部已筛」）；requireInfosec 随档', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_ASSESSMENT, { impactContinuity: true });
    const view = assessmentView({ flags: { hasRed: false, missingNames: ['Li Wei'], infosecBlocked: false } });
    deps.dueDiligence.getView.mockResolvedValue(view as any);

    await expect(deps.svc.getAssessment(vendorNo)).resolves.toBe(view);

    expect(deps.dueDiligence.getView).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo, {
      companyName: 'Nimbus Cloud Hosting LLC',
      beneficialOwners: [{ seq: 1, name: 'Omar Nasser' }, { seq: 2, name: 'Li Wei' }],
      requireInfosec: true,
    });
  });

  it('服务商没有评估壳 → 404', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    deps.dueDiligence.getView.mockResolvedValue(null as any);
    await expect(deps.svc.getAssessment(vendorNo)).rejects.toThrow(NotFoundException);
  });
});

describe('OutsourcingVendorWorkflowService 文件', () => {
  it('uploadDocument：服务商在可写窗口 + 类别合法 → 落到 OUTSOURCING_VENDOR/vendorNo 名下', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.RETURNED);

    await expect(deps.svc.uploadDocument(vendorNo, 'CONTRACT', pdf, ops)).resolves.toEqual({ docNo: 'DOC260101000001' });

    expect(deps.documents.store).toHaveBeenCalledWith(
      { ownerType: 'OUTSOURCING_VENDOR', ownerNo: vendorNo, docType: 'CONTRACT', file: pdf },
      ops,
    );
  });

  it('VENDOR_DOC_TYPES 九类都收；LP 才有的类别（AML_POLICY / AUTHORISED_SIGNATORIES）→ 400 且不落盘', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    for (const docType of VENDOR_DOC_TYPES) await deps.svc.uploadDocument(vendorNo, docType, pdf, ops);
    expect(deps.documents.store).toHaveBeenCalledTimes(9);

    deps.documents.store.mockClear();
    const lpOnly = LP_DOC_TYPES.filter((t) => !VENDOR_DOC_TYPES.includes(t));
    expect(lpOnly.length).toBeGreaterThan(0);
    for (const docType of lpOnly) {
      await expect(deps.svc.uploadDocument(vendorNo, docType, pdf, ops)).rejects.toThrow(BadRequestException);
    }
    expect(deps.documents.store).not.toHaveBeenCalled();
  });

  it.each([VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION, VendorStatus.ACTIVE, VendorStatus.REJECTED, VendorStatus.TERMINATED])(
    '%s 态：申请已锁，传文件 400', async (status) => {
      const deps = buildDeps();
      const vendorNo = await seedVendor(deps, status);
      await expect(deps.svc.uploadDocument(vendorNo, 'CONTRACT', pdf, ops)).rejects.toThrow(/locked/i);
      expect(deps.documents.store).not.toHaveBeenCalled();
    },
  );

  it('未知 vendorNo：传文件与列文件都 404，文件存储没被碰', async () => {
    const deps = buildDeps();
    await expect(deps.svc.uploadDocument('VEN000000000000', 'CONTRACT', pdf, ops)).rejects.toThrow(NotFoundException);
    await expect(deps.svc.listDocuments('VEN000000000000')).rejects.toThrow(NotFoundException);
    expect(deps.documents.store).not.toHaveBeenCalled();
    expect(deps.documents.listByOwner).not.toHaveBeenCalled();
  });

  it('listDocuments：任意状态都能读，按 OUTSOURCING_VENDOR/vendorNo 取', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.ACTIVE);
    await expect(deps.svc.listDocuments(vendorNo)).resolves.toEqual([{ docNo: 'DOC260101000001', docType: 'CONTRACT' }]);
    expect(deps.documents.listByOwner).toHaveBeenCalledWith('OUTSOURCING_VENDOR', vendorNo);
  });
});

describe('OutsourcingVendorWorkflowService.onDecided', () => {
  const BOTH = [ApprovalActionTypes.VENDOR_APPROVAL, ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL];

  it('APPROVED + NON_MATERIAL → ACTIVE；VENDOR_APPROVED 带 approvalNo / causationId（系统写）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);

    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.VENDOR_APPROVAL }));

    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.ACTIVE);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_APPROVED']);
    expect(deps.audits[0].via).toBe('system');
    expect(deps.audits[0].input).toMatchObject({ approvalNo: 'APR-VEN-1', causationId: 'causation-id-1', fromStatus: 'PENDING_APPROVAL', toStatus: 'ACTIVE' });
  });

  it('APPROVED + MATERIAL → PENDING_NOTIFICATION（报备门：批了也还不能 ACTIVE）；同一审计码 VENDOR_APPROVED', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL, { impactContinuity: true });

    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL }));

    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_NOTIFICATION);
    // T7：批准后紧接着开出告知单并盖章，所以多一条 VENDOR_NOTIFICATION_OPENED（状态仍是 PENDING_NOTIFICATION）
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_APPROVED', 'VENDOR_NOTIFICATION_OPENED']);
    expect(deps.audits[0].input).toMatchObject({ fromStatus: 'PENDING_APPROVAL', toStatus: 'PENDING_NOTIFICATION' });
    // 付款门：待报备的服务商付不了款
    await expect(deps.vendors.assertActiveByNo(vendorNo)).rejects.toThrow(/not ACTIVE/);
  });

  it('APPROVED + MATERIAL（T7）：PENDING_NOTIFICATION → openForVendorNotification(ONBOARDING, approvalNo) → stampNotificationFilingNo(vendorNo, filingNo)，顺序钉死', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL, { impactContinuity: true });
    const transition = jest.spyOn(deps.vendors, 'transition');
    const stamp = jest.spyOn(deps.vendors, 'stampNotificationFilingNo');

    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL }));

    expect(transition).toHaveBeenCalledWith(vendorNo, VendorStatus.PENDING_NOTIFICATION, {}, expect.objectContaining({ approvalNo: 'APR-VEN-1' }));
    expect(deps.filings.openForVendorNotification).toHaveBeenCalledTimes(1);
    expect(deps.filings.openForVendorNotification).toHaveBeenCalledWith({
      vendorNo, vendorName: 'Nimbus Cloud Hosting LLC', serviceDescription: 'Managed cloud hosting for back-office systems',
      deliveryLocations: ['AE', 'IE'], criticality: 'MATERIAL', contractStart: '2026-11-01',
      approvalNo: 'APR-VEN-1', reason: 'ONBOARDING',
    });
    expect(stamp).toHaveBeenCalledWith(vendorNo, FILING_NO);
    const order = [transition, deps.filings.openForVendorNotification, stamp].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(3);

    expect(deps.rows.get(vendorNo)).toMatchObject({ status: VendorStatus.PENDING_NOTIFICATION, notificationFilingNo: FILING_NO });
    const opened = deps.audits.find((a) => a.input.action === 'VENDOR_NOTIFICATION_OPENED')!;
    expect(opened.via).toBe('system');
    expect(opened.input).toMatchObject({ filingNo: FILING_NO, primarySubjectNo: vendorNo });
  });

  it('APPROVED + NON_MATERIAL（T7）：直接 ACTIVE，不开告知单、不盖章', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.VENDOR_APPROVAL }));
    expect(deps.filings.openForVendorNotification).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo)).toMatchObject({ status: VendorStatus.ACTIVE, notificationFilingNo: null });
  });

  it.each(['DECLINED', 'CANCELLED', 'EXPIRED'] as const)('%s（T7）：不批就不开告知单', async (decision) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL, { impactContinuity: true });
    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision, actionType: ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL }));
    expect(deps.filings.openForVendorNotification).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo).notificationFilingNo).toBeNull();
  });

  it.each(BOTH)('DECLINED（%s）→ REJECTED，reason 取 decisionReason（VENDOR_APPROVAL_REJECTED）', async (actionType) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);

    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'DECLINED', actionType, decisionReason: 'Concentration risk too high' }));

    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.REJECTED);
    expect(deps.audits[0].input).toMatchObject({ action: 'VENDOR_APPROVAL_REJECTED', reason: 'Concentration risk too high', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED' });
  });

  it('DECLINED 没有 decisionReason → 兜底「Rejected by approver」（重大线第二步是高管，不写死 CFO）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'DECLINED', decisionReason: null }));
    expect(deps.audits[0].input.reason).toBe('Rejected by approver');
  });

  it('EXPIRED → REJECTED，reason="Approval expired"', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'EXPIRED', decisionReason: null }));
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.REJECTED);
    expect(deps.audits[0].input.reason).toBe('Approval expired');
  });

  it.each(BOTH)('CANCELLED（%s）→ 回 PENDING_ASSESSMENT，VENDOR_APPROVAL_CANCELLED 默认原因 "Approval cancelled"', async (actionType) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);

    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'CANCELLED', actionType, decisionReason: null }));

    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_APPROVAL_CANCELLED']);
    expect(deps.audits[0].input).toMatchObject({ reason: 'Approval cancelled', fromStatus: 'PENDING_APPROVAL', toStatus: 'PENDING_ASSESSMENT', approvalNo: 'APR-VEN-1' });
  });

  it('撤单后评估窗口重开，合规官可补筛再次送审（新审批单号盖过旧的）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps);
    const screening = { subjectKind: 'COMPANY', subjectName: 'x', listsChecked: ['UN'], result: 'GREEN' };
    await deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
    await expect(deps.svc.recordScreening(vendorNo, screening, compliance)).rejects.toThrow('Assessment is locked');

    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'CANCELLED' }));
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_ASSESSMENT);
    await expect(deps.svc.recordScreening(vendorNo, screening, compliance)).resolves.toBeDefined();

    deps.approvals.createAndSubmit.mockResolvedValue({ approvalNo: 'APR-VEN-2' });
    const again = await deps.svc.conclude(vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
    expect(again).toEqual({ vendorNo, status: VendorStatus.PENDING_APPROVAL, approvalNo: 'APR-VEN-2' });
    expect(deps.rows.get(vendorNo).approvalNo).toBe('APR-VEN-2');
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_SENT_FOR_APPROVAL', 'VENDOR_APPROVAL_CANCELLED', 'VENDOR_SENT_FOR_APPROVAL']);
  });

  it('别家的审批类型（actionType 不是这两条）→ 忽略，服务商不动', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL }));
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_APPROVAL);
    expect(deps.audits).toEqual([]);
  });

  it('监听器登记在 workflow.outsourcing-vendor.decided（async）——框架据此把两种审批的裁决送进来', () => {
    const registered = Reflect.getMetadata(EVENT_LISTENER_METADATA, OutsourcingVendorWorkflowService.prototype.onDecided);
    expect(registered).toEqual([{ event: DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name, options: { async: true } }]);
    expect(DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name).toBe('workflow.outsourcing-vendor.decided');
  });
});

describe('审批 handler：两种服务商审批都派生 workflow.outsourcing-vendor.decided，且各只认自己的单', () => {
  const emitter = () => ({ emitAsync: jest.fn(async () => []), emit: jest.fn() });
  const approved = (actionType: string) => ({
    approvalId: 'id-1', approvalNo: 'APR-1', actionType, entityRef: 'VEN260101000001', traceId: 't-1',
  }) as any;

  it('OutsourcingVendorApprovalService（一般，CFO 单步）：VENDOR_APPROVAL → 事件名 workflow.outsourcing-vendor.decided', async () => {
    const e = emitter();
    const handler = new OutsourcingVendorApprovalService(e as any);
    expect(handler.actionType).toBe(ApprovalActionTypes.VENDOR_APPROVAL);
    await handler.handleApproved(approved(ApprovalActionTypes.VENDOR_APPROVAL));
    expect(e.emitAsync).toHaveBeenCalledWith('workflow.outsourcing-vendor.decided', expect.objectContaining({ decision: 'APPROVED', actionType: 'VENDOR_APPROVAL', workflowType: 'OUTSOURCING_VENDOR' }));
  });

  it('OutsourcingVendorMaterialApprovalService（重大，CFO→高管）：VENDOR_MATERIAL_APPROVAL → 同一个事件名', async () => {
    const e = emitter();
    const handler = new OutsourcingVendorMaterialApprovalService(e as any);
    expect(handler.actionType).toBe(ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL);
    await handler.handleApproved(approved(ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL));
    await handler.handleCancelled(approved(ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL));
    expect(e.emitAsync).toHaveBeenNthCalledWith(1, DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name, expect.objectContaining({ decision: 'APPROVED', actionType: 'VENDOR_MATERIAL_APPROVAL', workflowType: 'OUTSOURCING_VENDOR' }));
    expect(e.emitAsync).toHaveBeenNthCalledWith(2, DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name, expect.objectContaining({ decision: 'CANCELLED' }));
  });

  it('一张单只被自己的 handler 转发一次（另一个 handler 看到别人的 actionType 直接略过，否则 workflow 会收到两遍）', async () => {
    const e = emitter();
    const normal = new OutsourcingVendorApprovalService(e as any);
    const major = new OutsourcingVendorMaterialApprovalService(e as any);
    for (const handler of [normal, major]) await handler.handleApproved(approved(ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL));
    expect(e.emitAsync).toHaveBeenCalledTimes(1);
    expect(e.emitAsync).toHaveBeenCalledWith('workflow.outsourcing-vendor.decided', expect.objectContaining({ actionType: 'VENDOR_MATERIAL_APPROVAL' }));
  });
});

describe('OutsourcingVendorWorkflowService.onFilingSubmitted（VARA 报备门认领，T7）', () => {
  const submitted = (filingNo: string, overrides: Record<string, unknown> = {}) =>
    ({ filingNo, type: 'MATERIAL_CHANGE_NOTIFICATION', externalRef: 'VARA-REF-0001', ...overrides });

  /** 摆一个已盖章的服务商：行上记着告知单号，状态由参数定。 */
  async function seedStamped(deps: Deps, status: string, filingNo: string = FILING_NO): Promise<string> {
    const vendorNo = await seedVendor(deps, status, { impactContinuity: true });
    deps.rows.set(vendorNo, { ...deps.rows.get(vendorNo), notificationFilingNo: filingNo });
    return vendorNo;
  }

  it('filingNo 匹配且 PENDING_NOTIFICATION → ACTIVE，写 VENDOR_ACTIVATED（系统写，causationId = 告知单号，原因带回执号）', async () => {
    const deps = buildDeps();
    const vendorNo = await seedStamped(deps, VendorStatus.PENDING_NOTIFICATION);

    await deps.svc.onFilingSubmitted(submitted(FILING_NO));

    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.ACTIVE);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_ACTIVATED']);
    expect(deps.audits[0].via).toBe('system');
    expect(deps.audits[0].input).toMatchObject({
      primarySubjectNo: vendorNo, fromStatus: 'PENDING_NOTIFICATION', toStatus: 'ACTIVE', causationId: FILING_NO,
    });
    expect(deps.audits[0].input.reason).toContain('VARA-REF-0001');
    // 付款门随之放开
    await expect(deps.vendors.assertActiveByNo(vendorNo)).resolves.toBeUndefined();
  });

  it('端到端串起来：批准 → 开单盖章 → 已报送事件 → ACTIVE，服务商审计依次 VENDOR_APPROVED → VENDOR_NOTIFICATION_OPENED → VENDOR_ACTIVATED', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.PENDING_APPROVAL, { impactContinuity: true });
    await deps.svc.onDecided(makeDecidedEvent(vendorNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL }));
    await deps.svc.onFilingSubmitted(submitted(FILING_NO));
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_APPROVED', 'VENDOR_NOTIFICATION_OPENED', 'VENDOR_ACTIVATED']);
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.ACTIVE);
  });

  it('告知单号对不上任何服务商（别的报送单 / 别的类型）→ 零动作、零审计、不抛', async () => {
    const deps = buildDeps();
    const vendorNo = await seedStamped(deps, VendorStatus.PENDING_NOTIFICATION);
    await expect(deps.svc.onFilingSubmitted(submitted('FIL999999999999', { type: 'PERIODIC_RETURN' }))).resolves.toBeUndefined();
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.PENDING_NOTIFICATION);
    expect(deps.audits).toEqual([]);
  });

  // 出发态钉死 PENDING_NOTIFICATION：表里通向 ACTIVE 的边有两条（PENDING_APPROVAL→ACTIVE 是一般服务商的批准边），
  // 单靠迁移表挡不住「行上带着告知单号却在别的状态」——PENDING_APPROVAL 这一格没有那道钉就会被无痕放行、绕开审批门。
  it.each([
    VendorStatus.ACTIVE, VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED,
    VendorStatus.REJECTED, VendorStatus.TERMINATED,
  ])('告知单号匹配但服务商是 %s → 零 transition、零审计、不抛', async (status) => {
    const deps = buildDeps();
    const vendorNo = await seedStamped(deps, status);
    const transition = jest.spyOn(deps.vendors, 'transition');

    await expect(deps.svc.onFilingSubmitted(submitted(FILING_NO))).resolves.toBeUndefined();

    expect(transition).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo).status).toBe(status);
    expect(deps.audits).toEqual([]);
  });

  it('终止联动开的那张告知单不认领：它从不盖章，已报送事件来了服务商仍是 TERMINATED', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.ACTIVE, { impactContinuity: true });
    deps.filings.openForVendorNotification.mockResolvedValueOnce({ filingNo: 'FIL260101000009' });
    await deps.svc.terminate(vendorNo, {}, compliance);
    deps.audits.length = 0;
    const transition = jest.spyOn(deps.vendors, 'transition');

    await deps.svc.onFilingSubmitted(submitted('FIL260101000009'));

    expect(transition).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo).status).toBe(VendorStatus.TERMINATED);
    expect(deps.audits).toEqual([]);
  });

  it('监听器登记在 regulatory-filing.submitted（async）', () => {
    const registered = Reflect.getMetadata(EVENT_LISTENER_METADATA, OutsourcingVendorWorkflowService.prototype.onFilingSubmitted);
    expect(registered).toEqual([{ event: DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED.name, options: { async: true } }]);
  });
});

describe('OutsourcingVendorWorkflowService.terminate', () => {
  it('ACTIVE → TERMINATED + actor 审计（VENDOR_TERMINATED 带 from/to），备注入库', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.ACTIVE);

    const result = await deps.svc.terminate(vendorNo, { notes: 'Contract ended' }, compliance);

    expect(result).toEqual({ vendorNo, status: VendorStatus.TERMINATED });
    expect(deps.rows.get(vendorNo)).toMatchObject({ status: VendorStatus.TERMINATED, notes: 'Contract ended' });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_TERMINATED']);
    expect(deps.audits[0].input).toMatchObject({ fromStatus: 'ACTIVE', toStatus: 'TERMINATED' });
    expect(deps.audits[0].via).toBe('actor');
  });

  // 终止只有 ACTIVE 一个合法出发态：审批中 / 待报备的服务商还没进册，不能被「终止」绕开审批门或报备门。
  it.each([
    VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED, VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION,
    VendorStatus.REJECTED, VendorStatus.TERMINATED,
  ])('%s 态 → 400，行不变，零审计行', async (status) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, status);

    await expect(deps.svc.terminate(vendorNo, { notes: 'skip the line' }, compliance)).rejects.toThrow(BadRequestException);

    expect(deps.rows.get(vendorNo)).toMatchObject({ status, notes: null });
    expect(deps.audits).toEqual([]);
  });

  it('未知 vendorNo → 404', async () => {
    const deps = buildDeps();
    await expect(deps.svc.terminate('VEN000000000000', {}, compliance)).rejects.toThrow(NotFoundException);
    expect(deps.filings.openForVendorNotification).not.toHaveBeenCalled();
  });

  it('MATERIAL（T7）：TERMINATED 之后开 reason=TERMINATION 告知单，不盖 notificationFilingNo；服务商审计里没有 NOTIFICATION_OPENED', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.ACTIVE, { impactContinuity: true });
    const transition = jest.spyOn(deps.vendors, 'transition');
    const stamp = jest.spyOn(deps.vendors, 'stampNotificationFilingNo');

    const result = await deps.svc.terminate(vendorNo, { notes: 'Exit the hosting contract' }, compliance);

    expect(result).toEqual({ vendorNo, status: VendorStatus.TERMINATED });
    expect(deps.filings.openForVendorNotification).toHaveBeenCalledTimes(1);
    const input = deps.filings.openForVendorNotification.mock.calls[0][0];
    expect(input).toEqual({
      vendorNo, vendorName: 'Nimbus Cloud Hosting LLC', serviceDescription: 'Managed cloud hosting for back-office systems',
      deliveryLocations: ['AE', 'IE'], criticality: 'MATERIAL', contractStart: '2026-11-01', reason: 'TERMINATION',
    });
    expect(input.approvalNo).toBeUndefined();
    // 先终止、后开单：终止本身不依赖告知单
    expect(transition.mock.invocationCallOrder[0]).toBeLessThan(deps.filings.openForVendorNotification.mock.invocationCallOrder[0]);
    expect(stamp).not.toHaveBeenCalled();
    expect(deps.rows.get(vendorNo)).toMatchObject({ status: VendorStatus.TERMINATED, notificationFilingNo: null });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['VENDOR_TERMINATED']);
  });

  it('NON_MATERIAL（T7）：终止不开告知单', async () => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, VendorStatus.ACTIVE);
    await deps.svc.terminate(vendorNo, {}, compliance);
    expect(deps.filings.openForVendorNotification).not.toHaveBeenCalled();
  });

  it.each([VendorStatus.PENDING_NOTIFICATION, VendorStatus.PENDING_APPROVAL, VendorStatus.TERMINATED])('终止被拒（%s 态 → 400）时不开告知单', async (status) => {
    const deps = buildDeps();
    const vendorNo = await seedVendor(deps, status, { impactContinuity: true });
    await expect(deps.svc.terminate(vendorNo, {}, compliance)).rejects.toThrow(BadRequestException);
    expect(deps.filings.openForVendorNotification).not.toHaveBeenCalled();
  });
});
