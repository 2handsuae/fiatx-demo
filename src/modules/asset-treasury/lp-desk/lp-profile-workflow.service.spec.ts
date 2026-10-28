// 战役乙波一 T3 / 甲波六 T4 · LpProfileWorkflowService 行为测试（照 RiReplacementWorkflowService.spec.ts
// 先例：直接 new 实例，不用 NestJS TestingModule）。
// 档案服务是**真的**（真迁移表 + 内存 prisma + 真 assertActionSpec）：状态流转与审计码是行为证据，
// 不是读 mock 调用次数；审批引擎 / 尽调评估 / 文件存储是 mock——它们各自的行为在自己的 spec 里。
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { LpProfileService } from './lp-profile.service';
import { LpProfileApprovalService } from './lp-profile-approval.service';
import { LpProfileHighRiskApprovalService } from './lp-profile-high-risk-approval.service';
import { CreateLpProfileDto, LpProfileStatus } from './dto/lp-profile.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { LP_DOC_TYPES } from '../../../core/documents/documents.constants';

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TREASURY', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] };
const compliance = { actorType: 'ADMIN' as const, userId: 'uuid-compliance', userNo: 'ADM-COMPLIANCE', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] };

const dto = (overrides: Partial<CreateLpProfileDto> = {}): CreateLpProfileDto => ({
  name: 'Falcon Liquidity FZE',
  registeredIn: 'United Arab Emirates (DMCC)',
  registrationNo: 'DMCC-123456',
  licensingAuthority: 'VARA',
  licenceNo: 'VL/24/001',
  beneficialOwners: [{ seq: 1, name: 'Khalid Al Mansoori' }, { seq: 2, name: 'Mei Lin Tan' }],
  tradingTypes: ['SPOT_EXCHANGE'],
  expectedMonthlyVolume: '5000000',
  volumeCurrency: 'USD',
  applicationReason: 'Onboarding a new AED/USDT liquidity corridor',
  agreementRef: 'AGR-2026-LP-001',
  contactName: 'Layla Hassan',
  contactEmail: 'layla@falcon.example',
  ...overrides,
});

const ASSESSMENT_NO = 'DDA260101000001';
const assessmentView = (overrides: Record<string, unknown> = {}) => ({
  assessmentNo: ASSESSMENT_NO, targetType: 'LIQUIDITY_PROVIDER', targetNo: 'x',
  riskTier: 'LOW', opinion: 'Clean file, standard corridor', conditions: null,
  conclusion: null, conclusionReason: null, concludedAt: null, infosec: null,
  screeningRecords: [], flags: { hasRed: false, missingNames: [], infosecBlocked: false },
  ...overrides,
});

const pdf = { originalname: 'incorporation.pdf', mimetype: 'application/pdf', size: 4, buffer: Buffer.from('%PDF') };

function makeDecidedEvent(lpNo: string, overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
    entityRef: lpNo,
    approvalId: 'causation-id-1',
    approvalNo: 'APR-LP-1',
    traceId: 'trace-1',
    workflowType: 'LP_PROFILE',
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
    liquidityProvider: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), approvalNo: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(row.lpNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const updated = { ...rows.get(where.lpNo), ...data };
        rows.set(where.lpNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.lpNo) ?? null),
    },
  };
  // 生产那道词表校验亲自跑一遍每条信封（缺必填 / 缺 causation / 域不符都会当场抛，同生产）
  const realSpec = new AuditLogsService(null as any);
  const audits: Array<{ via: 'actor' | 'system'; input: any }> = [];
  const auditLogs = {
    recordByActor: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'actor', input }); }),
    recordSystem: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'system', input }); }),
  };
  const profiles = new LpProfileService(prisma as any, auditLogs as any);
  const approvals = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-LP-1' })) };
  const dueDiligence = {
    open: jest.fn(async () => ({ assessmentNo: ASSESSMENT_NO })),
    getView: jest.fn(async () => assessmentView()),
    recordScreening: jest.fn(async () => ({ recordNo: 'SCR260101000001' })),
    attachEvidence: jest.fn(async () => ({ docNo: 'DOC260101000002' })),
    saveAssessment: jest.fn(async () => undefined),
    assertSendable: jest.fn(async () => undefined),
    conclude: jest.fn(async () => undefined),
  };
  const documents = {
    store: jest.fn(async () => ({ docNo: 'DOC260101000001' })),
    listByOwner: jest.fn(async () => [{ docNo: 'DOC260101000001', docType: 'AML_POLICY' }]),
  };
  const svc = new LpProfileWorkflowService(profiles, approvals as any, dueDiligence as any, documents as any);
  return { svc, profiles, prisma, rows, audits, approvals, dueDiligence, documents };
}
type Deps = ReturnType<typeof buildDeps>;

/** 经 initiateCreate 建一家 LP，再按需把它摆到指定状态（审计清零，让断言只看被测那一步）。 */
async function seedLp(deps: Deps, status: LpProfileStatus = LpProfileStatus.PENDING_ASSESSMENT, overrides: Partial<CreateLpProfileDto> = {}): Promise<string> {
  const { lpNo } = await deps.svc.initiateCreate(dto(overrides), treasury);
  deps.rows.set(lpNo, { ...deps.rows.get(lpNo), status });
  deps.audits.length = 0;
  deps.dueDiligence.open.mockClear();
  return lpNo;
}

describe('LpProfileWorkflowService.initiateCreate', () => {
  it('建档：落 PENDING_ASSESSMENT、开尽调评估壳、不开审批单；审计只有一条 LP_PROFILE_CREATED', async () => {
    const deps = buildDeps();

    const result = await deps.svc.initiateCreate(dto(), treasury);

    const [lpNo] = [...deps.rows.keys()];
    expect(result).toEqual({ lpNo, status: LpProfileStatus.PENDING_ASSESSMENT });
    expect(deps.rows.get(lpNo)).toMatchObject({ status: LpProfileStatus.PENDING_ASSESSMENT, approvalNo: null, createdByUserId: 'ADM-TREASURY' });
    expect(deps.dueDiligence.open).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, treasury);
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled(); // 先评估后审批：此刻审批中心什么都没有
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_CREATED']);
    // 档案先于评估壳落库（壳挂在 lpNo 上）
    expect(deps.prisma.liquidityProvider.create.mock.invocationCallOrder[0]).toBeLessThan(deps.dueDiligence.open.mock.invocationCallOrder[0]);
  });

  it('不再有实体背调：名称含 Sanction / Offshore 也照常进 PENDING_ASSESSMENT，由合规官人工筛', async () => {
    const deps = buildDeps();
    const a = await deps.svc.initiateCreate(dto({ name: 'Sanctioned Holdings FZE' }), treasury);
    const b = await deps.svc.initiateCreate(dto({ name: 'Offshore Capital Ltd' }), treasury);
    expect([a.status, b.status]).toEqual([LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.PENDING_ASSESSMENT]);
    expect(deps.audits.map((x) => x.input.action)).toEqual(['LP_PROFILE_CREATED', 'LP_PROFILE_CREATED']);
  });
});

describe('LpProfileWorkflowService.resubmit', () => {
  it('RETURNED → 整行覆盖并回 PENDING_ASSESSMENT；评估壳不重开', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.RETURNED);

    const result = await deps.svc.resubmit(lpNo, dto({ registrationNo: 'DMCC-999', name: 'Falcon Liquidity FZE' }), treasury);

    expect(result).toEqual({ lpNo, status: LpProfileStatus.PENDING_ASSESSMENT });
    expect(deps.rows.get(lpNo)).toMatchObject({ registrationNo: 'DMCC-999', status: LpProfileStatus.PENDING_ASSESSMENT });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_RESUBMITTED']);
    expect(deps.dueDiligence.open).not.toHaveBeenCalled();
  });

  it('非 RETURNED 态拒绝（待批中不能借「重提」把单子拉回待评估）', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);
    await expect(deps.svc.resubmit(lpNo, dto(), treasury)).rejects.toThrow(BadRequestException);
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_APPROVAL);
  });
});

describe('LpProfileWorkflowService.conclude — 通过并送审（SENT_FOR_APPROVAL）', () => {
  it.each([
    ['LOW', ApprovalActionTypes.LP_PROFILE_APPROVAL],
    ['MEDIUM', ApprovalActionTypes.LP_PROFILE_APPROVAL],
    ['HIGH', ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL],
  ])('%s 档开 %s；提单人 = 合规官，理由 = 评估意见，快照零 UUID', async (riskTier, actionType) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    deps.dueDiligence.getView.mockResolvedValue(assessmentView({ riskTier, conditions: 'USDT/AED spot only' }) as any);

    const result = await deps.svc.conclude(lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    expect(result).toEqual({ lpNo, status: LpProfileStatus.PENDING_APPROVAL, approvalNo: 'APR-LP-1' });
    expect(deps.approvals.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(deps.approvals.createAndSubmit).toHaveBeenCalledWith(
      {
        actionType,
        entityRef: lpNo,
        objectSnapshot: {
          lpNo, name: 'Falcon Liquidity FZE', registeredIn: 'United Arab Emirates (DMCC)', licensingAuthority: 'VARA',
          riskTier, conditions: 'USDT/AED spot only', assessmentNo: ASSESSMENT_NO,
        },
      },
      { reason: 'Clean file, standard corridor' },
      compliance,
    );
    expect(deps.rows.get(lpNo)).toMatchObject({ status: LpProfileStatus.PENDING_APPROVAL, approvalNo: 'APR-LP-1' });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_SENT_FOR_APPROVAL']);
    expect(deps.audits[0].input).toMatchObject({ fromStatus: 'PENDING_ASSESSMENT', toStatus: 'PENDING_APPROVAL' });
    expect(deps.audits[0].via).toBe('actor'); // 送审是合规官的手
  });

  it('调用顺序钉死：assertSendable → conclude → transition(PENDING_APPROVAL) → createAndSubmit → stampApprovalNo', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    const transition = jest.spyOn(deps.profiles, 'transition');
    const stamp = jest.spyOn(deps.profiles, 'stampApprovalNo');

    await deps.svc.conclude(lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    const order = (m: jest.Mock | jest.SpyInstance) => m.mock.invocationCallOrder[0];
    expect(order(deps.dueDiligence.assertSendable)).toBeLessThan(order(deps.dueDiligence.conclude));
    expect(order(deps.dueDiligence.conclude)).toBeLessThan(order(transition));
    expect(order(transition)).toBeLessThan(order(deps.approvals.createAndSubmit));
    expect(order(deps.approvals.createAndSubmit)).toBeLessThan(order(stamp));
    expect(transition).toHaveBeenCalledWith(lpNo, LpProfileStatus.PENDING_APPROVAL, {}, expect.objectContaining({ actor: compliance }));
    expect(deps.dueDiligence.conclude).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
  });

  it('送审检查拿的是申请表眼下的名单：公司名 + 解析出的实控人 {seq,name}，且不要 CISO（LP 线无信息安全评估）', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);

    await deps.svc.conclude(lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);

    expect(deps.dueDiligence.assertSendable).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, {
      companyName: 'Falcon Liquidity FZE',
      beneficialOwners: [{ seq: 1, name: 'Khalid Al Mansoori' }, { seq: 2, name: 'Mei Lin Tan' }],
      requireInfosec: false,
    });
  });

  it('assertSendable 抛 → 不落结论、不迁状态、不开单、不留痕', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    deps.dueDiligence.assertSendable.mockRejectedValue(new BadRequestException('Screening missing for: Mei Lin Tan'));

    await expect(deps.svc.conclude(lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance)).rejects.toThrow(/Screening missing/);

    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled();
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.rows.get(lpNo)).toMatchObject({ status: LpProfileStatus.PENDING_ASSESSMENT, approvalNo: null });
    expect(deps.audits).toEqual([]);
  });
});

describe('LpProfileWorkflowService.conclude — 退回补料 / 不通过', () => {
  it('RETURNED：落结论 → 迁 RETURNED 带原因；金库 resubmit 后回 PENDING_ASSESSMENT', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);

    const result = await deps.svc.conclude(lpNo, { conclusion: 'RETURNED', reason: 'Licence copy is unreadable' }, compliance);

    expect(result).toEqual({ lpNo, status: LpProfileStatus.RETURNED });
    expect(deps.dueDiligence.conclude).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, { conclusion: 'RETURNED', reason: 'Licence copy is unreadable' }, compliance);
    expect(deps.dueDiligence.assertSendable).not.toHaveBeenCalled(); // 送审五道硬规则只拦「通过并送审」
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_RETURNED']);
    expect(deps.audits[0].input).toMatchObject({ reason: 'Licence copy is unreadable', fromStatus: 'PENDING_ASSESSMENT', toStatus: 'RETURNED' });

    await deps.svc.resubmit(lpNo, dto(), treasury);
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_RETURNED', 'LP_PROFILE_RESUBMITTED']);
  });

  it('REJECTED：落结论 → 迁 REJECTED（终态）带原因，不开审批单', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);

    const result = await deps.svc.conclude(lpNo, { conclusion: 'REJECTED', reason: 'Beneficial owner on a sanctions list' }, compliance);

    expect(result).toEqual({ lpNo, status: LpProfileStatus.REJECTED });
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_REJECTED']);
    expect(deps.audits[0].input).toMatchObject({ reason: 'Beneficial owner on a sanctions list', fromStatus: 'PENDING_ASSESSMENT', toStatus: 'REJECTED' });
    await expect(deps.svc.resubmit(lpNo, dto(), treasury)).rejects.toThrow(BadRequestException);
  });

  it('尽调服务拒掉缺原因的退回 → 状态不动、不留痕（先落结论后迁状态）', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    deps.dueDiligence.conclude.mockRejectedValue(new BadRequestException('A reason is required when the conclusion is RETURNED'));

    await expect(deps.svc.conclude(lpNo, { conclusion: 'RETURNED' }, compliance)).rejects.toThrow(/reason is required/);

    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
    expect(deps.audits).toEqual([]);
  });

  it('RETURNED 态不能再下结论（状态表只许 PENDING_ASSESSMENT 退回 / 不通过 / 送审）：先让金库重新提交——且什么都没写', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.RETURNED);

    for (const conclusion of ['RETURNED', 'REJECTED', 'SENT_FOR_APPROVAL']) {
      await expect(deps.svc.conclude(lpNo, { conclusion, reason: 'x' }, compliance)).rejects.toThrow(/resubmit/i);
    }

    expect(deps.dueDiligence.assertSendable).not.toHaveBeenCalled();
    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled(); // 没留下「结论已落、状态没动」的半截子
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.RETURNED);
    expect(deps.audits).toEqual([]);
  });

  it('未知结论 → 400，且什么都没写', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    await expect(deps.svc.conclude(lpNo, { conclusion: 'APPROVED' }, compliance)).rejects.toThrow(BadRequestException);
    expect(deps.dueDiligence.conclude).not.toHaveBeenCalled();
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
  });
});

describe('LpProfileWorkflowService — 评估可写窗口（PENDING_ASSESSMENT | RETURNED）', () => {
  const LOCKED = [LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.ACTIVE, LpProfileStatus.SUSPENDED, LpProfileStatus.REJECTED];
  const screeningDto = { subjectKind: 'COMPANY', subjectName: 'Falcon Liquidity FZE', listsChecked: ['UN'], result: 'GREEN' };
  const assessmentDto = { riskTier: 'LOW', opinion: 'Fine' };

  it.each(LOCKED)('%s 态：recordScreening / attachEvidence / saveAssessment / conclude 一律 400 Assessment is locked，且尽调服务没被碰', async (status) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, status);

    await expect(deps.svc.recordScreening(lpNo, screeningDto, compliance)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.attachEvidence(lpNo, 'SCR260101000001', pdf, compliance)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.saveAssessment(lpNo, assessmentDto, compliance)).rejects.toThrow('Assessment is locked');
    await expect(deps.svc.conclude(lpNo, { conclusion: 'REJECTED', reason: 'x' }, compliance)).rejects.toThrow('Assessment is locked');

    for (const m of ['recordScreening', 'attachEvidence', 'saveAssessment', 'conclude', 'assertSendable'] as const) {
      expect(deps.dueDiligence[m]).not.toHaveBeenCalled();
    }
  });

  it.each([LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.RETURNED])('%s 态：筛查 / 证据 / 定档 都转调尽调服务（RETURNED 期间合规官仍可继续筛）', async (status) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, status);

    await expect(deps.svc.recordScreening(lpNo, screeningDto, compliance)).resolves.toEqual({ recordNo: 'SCR260101000001' });
    await expect(deps.svc.attachEvidence(lpNo, 'SCR260101000001', pdf, compliance)).resolves.toEqual({ docNo: 'DOC260101000002' });
    await deps.svc.saveAssessment(lpNo, assessmentDto, compliance);

    expect(deps.dueDiligence.recordScreening).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, screeningDto, compliance);
    expect(deps.dueDiligence.attachEvidence).toHaveBeenCalledWith('SCR260101000001', pdf, compliance);
    expect(deps.dueDiligence.saveAssessment).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, assessmentDto, compliance);
  });

  it('未知 lpNo → 404（窗口检查先于任何转调）', async () => {
    const deps = buildDeps();
    await expect(deps.svc.recordScreening('LPP000000000000', screeningDto, compliance)).rejects.toThrow(NotFoundException);
    expect(deps.dueDiligence.recordScreening).not.toHaveBeenCalled();
  });
});

describe('LpProfileWorkflowService.getAssessment', () => {
  it('带上申请表眼下的名单取视图（否则 missingNames 恒空，前端会把它读成「全部已筛」）', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    const view = assessmentView({ flags: { hasRed: false, missingNames: ['Mei Lin Tan'], infosecBlocked: false } });
    deps.dueDiligence.getView.mockResolvedValue(view as any);

    await expect(deps.svc.getAssessment(lpNo)).resolves.toBe(view);

    expect(deps.dueDiligence.getView).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo, {
      companyName: 'Falcon Liquidity FZE',
      beneficialOwners: [{ seq: 1, name: 'Khalid Al Mansoori' }, { seq: 2, name: 'Mei Lin Tan' }],
      requireInfosec: false,
    });
  });

  it('档案没有评估壳 → 404', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    deps.dueDiligence.getView.mockResolvedValue(null as any);
    await expect(deps.svc.getAssessment(lpNo)).rejects.toThrow(NotFoundException);
  });
});

describe('LpProfileWorkflowService 文件', () => {
  it('uploadDocument：LP 在可写窗口 + 类别合法 → 落到 LIQUIDITY_PROVIDER/lpNo 名下', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.RETURNED);

    await expect(deps.svc.uploadDocument(lpNo, 'AML_POLICY', pdf, treasury)).resolves.toEqual({ docNo: 'DOC260101000001' });

    expect(deps.documents.store).toHaveBeenCalledWith(
      { ownerType: 'LIQUIDITY_PROVIDER', ownerNo: lpNo, docType: 'AML_POLICY', file: pdf },
      treasury,
    );
  });

  it('LP_DOC_TYPES 六类都收；类别不在名册 → 400 且不落盘', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    for (const docType of LP_DOC_TYPES) await deps.svc.uploadDocument(lpNo, docType, pdf, treasury);
    expect(deps.documents.store).toHaveBeenCalledTimes(6);

    deps.documents.store.mockClear();
    await expect(deps.svc.uploadDocument(lpNo, 'CONTRACT', pdf, treasury)).rejects.toThrow(BadRequestException); // 服务商材料不是 LP 材料
    expect(deps.documents.store).not.toHaveBeenCalled();
  });

  it.each([LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.ACTIVE, LpProfileStatus.SUSPENDED, LpProfileStatus.REJECTED])('%s 态：申请已锁，传文件 400', async (status) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, status);
    await expect(deps.svc.uploadDocument(lpNo, 'AML_POLICY', pdf, treasury)).rejects.toThrow(/locked/i);
    expect(deps.documents.store).not.toHaveBeenCalled();
  });

  it('未知 lpNo：传文件与列文件都 404，文件存储没被碰', async () => {
    const deps = buildDeps();
    await expect(deps.svc.uploadDocument('LPP000000000000', 'AML_POLICY', pdf, treasury)).rejects.toThrow(NotFoundException);
    await expect(deps.svc.listDocuments('LPP000000000000')).rejects.toThrow(NotFoundException);
    expect(deps.documents.store).not.toHaveBeenCalled();
    expect(deps.documents.listByOwner).not.toHaveBeenCalled();
  });

  it('listDocuments：任意状态都能读，按 LIQUIDITY_PROVIDER/lpNo 取', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.ACTIVE);
    await expect(deps.svc.listDocuments(lpNo)).resolves.toEqual([{ docNo: 'DOC260101000001', docType: 'AML_POLICY' }]);
    expect(deps.documents.listByOwner).toHaveBeenCalledWith('LIQUIDITY_PROVIDER', lpNo);
  });
});

describe('LpProfileWorkflowService.onDecided — 两种审批类型同一处理', () => {
  const BOTH = [ApprovalActionTypes.LP_PROFILE_APPROVAL, ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL];

  it.each(BOTH)('APPROVED（%s）→ ACTIVE，LP_PROFILE_APPROVED 带 approvalNo/causationId（系统写）', async (actionType) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);

    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'APPROVED', actionType }));

    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.ACTIVE);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_APPROVED']);
    expect(deps.audits[0].via).toBe('system');
    expect(deps.audits[0].input).toMatchObject({ approvalNo: 'APR-LP-1', causationId: 'causation-id-1' });
  });

  it.each(BOTH)('DECLINED（%s）→ REJECTED，reason 取 decisionReason', async (actionType) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);

    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'DECLINED', actionType, decisionReason: 'Sanctions exposure too high' }));

    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.REJECTED);
    expect(deps.audits[0].input).toMatchObject({ action: 'LP_PROFILE_REJECTED', reason: 'Sanctions exposure too high' });
  });

  it('DECLINED 没有 decisionReason → 兜底「Rejected by approver」（高风险第二步是高管，不再写死 CFO）', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'DECLINED', actionType: ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL, decisionReason: null }));
    expect(deps.audits[0].input.reason).toBe('Rejected by approver');
  });

  it('EXPIRED → REJECTED，reason="Approval expired"', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'EXPIRED', decisionReason: null }));
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.REJECTED);
    expect(deps.audits[0].input.reason).toBe('Approval expired');
  });

  it.each(BOTH)('CANCELLED（%s）→ 回 PENDING_ASSESSMENT，LP_PROFILE_APPROVAL_CANCELLED 默认原因 "Approval cancelled"', async (actionType) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);

    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'CANCELLED', actionType, decisionReason: null }));

    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_APPROVAL_CANCELLED']);
    expect(deps.audits[0].input).toMatchObject({ reason: 'Approval cancelled', fromStatus: 'PENDING_APPROVAL', toStatus: 'PENDING_ASSESSMENT', approvalNo: 'APR-LP-1' });
  });

  it('CANCELLED 带撤单原因 → 原样落审计', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'CANCELLED', decisionReason: 'Need one more screening' }));
    expect(deps.audits[0].input.reason).toBe('Need one more screening');
  });

  it('撤单后评估窗口重开，合规官可补筛再次送审（新审批单号盖过旧的）', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps);
    await deps.svc.conclude(lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
    expect(deps.rows.get(lpNo)).toMatchObject({ status: LpProfileStatus.PENDING_APPROVAL, approvalNo: 'APR-LP-1' });
    await expect(deps.svc.recordScreening(lpNo, { subjectKind: 'COMPANY', subjectName: 'x', listsChecked: ['UN'], result: 'GREEN' }, compliance)).rejects.toThrow('Assessment is locked');

    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'CANCELLED' }));
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_ASSESSMENT);
    await expect(deps.svc.recordScreening(lpNo, { subjectKind: 'COMPANY', subjectName: 'x', listsChecked: ['UN'], result: 'GREEN' }, compliance)).resolves.toBeDefined();

    deps.approvals.createAndSubmit.mockResolvedValue({ approvalNo: 'APR-LP-2' });
    const again = await deps.svc.conclude(lpNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance);
    expect(again).toEqual({ lpNo, status: LpProfileStatus.PENDING_APPROVAL, approvalNo: 'APR-LP-2' });
    expect(deps.rows.get(lpNo).approvalNo).toBe('APR-LP-2');
    expect(deps.audits.map((a) => a.input.action)).toEqual([
      'LP_PROFILE_SENT_FOR_APPROVAL', 'LP_PROFILE_APPROVAL_CANCELLED', 'LP_PROFILE_SENT_FOR_APPROVAL',
    ]);
  });

  it('别家的审批类型（actionType 不是这两条）→ 忽略，档案不动', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.PENDING_APPROVAL);
    await deps.svc.onDecided(makeDecidedEvent(lpNo, { decision: 'APPROVED', actionType: ApprovalActionTypes.LP_EXCHANGE_APPROVAL }));
    expect(deps.rows.get(lpNo).status).toBe(LpProfileStatus.PENDING_APPROVAL);
    expect(deps.audits).toEqual([]);
  });

  it('监听器登记在 workflow.lp-profile.decided（async）——框架据此把两种审批的裁决送进来', () => {
    const registered = Reflect.getMetadata(EVENT_LISTENER_METADATA, LpProfileWorkflowService.prototype.onDecided);
    expect(registered).toEqual([{ event: DOMAIN_EVENTS.LP_PROFILE_DECIDED.name, options: { async: true } }]);
    expect(DOMAIN_EVENTS.LP_PROFILE_DECIDED.name).toBe('workflow.lp-profile.decided');
  });
});

describe('审批 handler：两种 LP 审批都派生 workflow.lp-profile.decided，且各只认自己的单', () => {
  const emitter = () => ({ emitAsync: jest.fn(async () => []), emit: jest.fn() });
  const approved = (actionType: string) => ({
    approvalId: 'id-1', approvalNo: 'APR-1', actionType, entityRef: 'LPP260101000001', traceId: 't-1',
  }) as any;

  it('LpProfileApprovalService（低 / 中风险，CFO 单步）：LP_PROFILE_APPROVAL → 事件名 workflow.lp-profile.decided', async () => {
    const e = emitter();
    const handler = new LpProfileApprovalService(e as any);
    expect(handler.actionType).toBe(ApprovalActionTypes.LP_PROFILE_APPROVAL);
    await handler.handleApproved(approved(ApprovalActionTypes.LP_PROFILE_APPROVAL));
    expect(e.emitAsync).toHaveBeenCalledWith('workflow.lp-profile.decided', expect.objectContaining({ decision: 'APPROVED', actionType: 'LP_PROFILE_APPROVAL', workflowType: 'LP_PROFILE' }));
  });

  it('LpProfileHighRiskApprovalService（高风险，CFO→高管）：LP_PROFILE_HIGH_RISK_APPROVAL → 同一个事件名', async () => {
    const e = emitter();
    const handler = new LpProfileHighRiskApprovalService(e as any);
    expect(handler.actionType).toBe(ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL);
    await handler.handleApproved(approved(ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL));
    await handler.handleCancelled(approved(ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL));
    expect(e.emitAsync).toHaveBeenNthCalledWith(1, DOMAIN_EVENTS.LP_PROFILE_DECIDED.name, expect.objectContaining({ decision: 'APPROVED', actionType: 'LP_PROFILE_HIGH_RISK_APPROVAL', workflowType: 'LP_PROFILE' }));
    expect(e.emitAsync).toHaveBeenNthCalledWith(2, DOMAIN_EVENTS.LP_PROFILE_DECIDED.name, expect.objectContaining({ decision: 'CANCELLED' }));
  });

  it('一张单只被自己的 handler 转发一次（另一个 handler 看到别人的 actionType 直接略过，否则 workflow 会收到两遍）', async () => {
    const e = emitter();
    const low = new LpProfileApprovalService(e as any);
    const high = new LpProfileHighRiskApprovalService(e as any);
    for (const handler of [low, high]) await handler.handleApproved(approved(ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL));
    expect(e.emitAsync).toHaveBeenCalledTimes(1);
    expect(e.emitAsync).toHaveBeenCalledWith('workflow.lp-profile.decided', expect.objectContaining({ actionType: 'LP_PROFILE_HIGH_RISK_APPROVAL' }));
  });
});

describe('LpProfileWorkflowService.suspend / reactivate', () => {
  it('suspend：ACTIVE → SUSPENDED + actor 审计，不建审批', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.ACTIVE);
    const result = await deps.svc.suspend(lpNo, { reason: 'Underperforming this quarter' }, treasury);
    expect(result).toEqual({ lpNo, status: LpProfileStatus.SUSPENDED });
    expect(deps.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_SUSPENDED']);
    expect(deps.audits[0].input.reason).toBe('Underperforming this quarter');
  });

  it('reactivate：SUSPENDED → ACTIVE + actor 审计，不建审批', async () => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, LpProfileStatus.SUSPENDED);
    const result = await deps.svc.reactivate(lpNo, { reason: 'Back in good standing' }, treasury);
    expect(result).toEqual({ lpNo, status: LpProfileStatus.ACTIVE });
    expect(deps.audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_REACTIVATED']);
  });

  // 启停各自钉死出发态：迁移表是共享的，`PENDING_APPROVAL → ACTIVE` 是审批批准那条边（LP_PROFILE_APPROVED 要 approvalNo + causation），
  // 没钉出发态的 reactivate 会借这条边把待批档案直接写成 ACTIVE（绕过审批门），而随后的审计写入又因缺 approvalNo 抛错——
  // 状态已变、无审计行。以下用例断言：被拒的调用既不改状态，也一条审计都不写。
  it.each([
    LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.RETURNED, LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.ACTIVE, LpProfileStatus.REJECTED,
  ])('reactivate 只收 SUSPENDED：%s 态 → 400，状态不变，零审计行（待批 / 评估中的档案不能借「启用」绕过审批门或评估）', async (status) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, status);

    await expect(deps.svc.reactivate(lpNo, { reason: 'skip the line' }, treasury)).rejects.toThrow(BadRequestException);

    expect(deps.rows.get(lpNo).status).toBe(status);
    expect(deps.audits).toEqual([]);
  });

  it('reactivate 未知 lpNo → 404', async () => {
    const deps = buildDeps();
    await expect(deps.svc.reactivate('LPP000000000000', { reason: 'x' }, treasury)).rejects.toThrow(NotFoundException);
  });

  it.each([
    LpProfileStatus.PENDING_ASSESSMENT, LpProfileStatus.RETURNED, LpProfileStatus.PENDING_APPROVAL, LpProfileStatus.SUSPENDED, LpProfileStatus.REJECTED,
  ])('suspend 只有 ACTIVE 一个合法出发态（表里通向 SUSPENDED 的边只有 ACTIVE→SUSPENDED，无边可借）：%s 态 → 400，状态不变，零审计行', async (status) => {
    const deps = buildDeps();
    const lpNo = await seedLp(deps, status);

    await expect(deps.svc.suspend(lpNo, { reason: 'x' }, treasury)).rejects.toThrow(BadRequestException);

    expect(deps.rows.get(lpNo).status).toBe(status);
    expect(deps.audits).toEqual([]);
  });
});
