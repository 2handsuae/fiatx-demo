// 战役乙波一 T3 · LpProfileWorkflowService 行为测试（照 RiReplacementWorkflowService.spec.ts
// 先例：直接 new 实例 + 行为化 mock，不用 NestJS TestingModule——本文件只有两个依赖，
// 用不上 DI 容器）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { LpProfileService } from './lp-profile.service';
import { CreateLpProfileDto, LpProfileStatus } from './dto/lp-profile.dto';
import { screenLpEntityName } from './lp-entity-screening.mock';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

const LP_NO = 'LPP260101000001';

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TREASURY', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] };

const baseRow = {
  lpNo: LP_NO,
  name: 'Falcon Liquidity FZE',
  agreementRef: 'AGR-2026-LP-001',
  screeningAnswer: 'GREEN' as string | null,
  screenedAt: new Date('2026-01-01T00:00:00.000Z') as Date | null,
  dueDiligenceRef: 'DD-2026-LP-001' as string | null,
  status: LpProfileStatus.PENDING_APPROVAL,
  approvalNo: null as string | null,
};

function makeDecidedEvent(overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
    entityRef: LP_NO,
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
  const profiles = {
    create: jest.fn(async () => ({ ...baseRow })),
    findByNo: jest.fn(async () => ({ ...baseRow })),
    assertActiveByNo: jest.fn(async () => undefined),
    transition: jest.fn(async (_lpNo: string, to: string) => ({ ...baseRow, status: to })),
    stampApprovalNo: jest.fn(async () => undefined),
  } as any;

  const approvals = {
    createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-LP-1' })),
  } as any;

  const svc = new LpProfileWorkflowService(profiles, approvals);
  return { svc, profiles, approvals };
}

describe('LpProfileWorkflowService.initiateCreate', () => {
  it('建档：create → createAndSubmit（零 UUID 快照）→ stampApprovalNo，按序', async () => {
    const { svc, profiles, approvals } = buildDeps();

    const result = await svc.initiateCreate(
      { name: 'Falcon Liquidity FZE', agreementRef: 'AGR-2026-LP-001', dueDiligenceRef: 'DD-2026-LP-001', reason: 'Onboarding' },
      treasury,
    );

    expect(result).toEqual({ lpNo: LP_NO, approvalNo: 'APR-LP-1', status: LpProfileStatus.PENDING_APPROVAL });

    const createOrder = profiles.create.mock.invocationCallOrder[0];
    const submitOrder = approvals.createAndSubmit.mock.invocationCallOrder[0];
    const stampOrder = profiles.stampApprovalNo.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(submitOrder);
    expect(submitOrder).toBeLessThan(stampOrder);

    expect(approvals.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
        entityRef: LP_NO,
        objectSnapshot: { lpNo: LP_NO, name: 'Falcon Liquidity FZE', agreementRef: 'AGR-2026-LP-001', screeningAnswer: 'GREEN', dueDiligenceRef: 'DD-2026-LP-001' },
      }),
      expect.objectContaining({ reason: 'Onboarding' }),
      treasury,
    );
    expect(profiles.stampApprovalNo).toHaveBeenCalledWith(LP_NO, 'APR-LP-1');
  });
});

// ── 实体背调（LP 两步准入 Task 2）──────────────────────────────────────────────
// 用真 LpProfileService + 内存 prisma + 真 assertActionSpec：审计序列、信封契约、落点计算都是
// 行为证据，不是读 mock 调用次数（workflow 零审计写入——审计收在档案服务，见该文件头注）。
describe('LpProfileWorkflowService.initiateCreate — 实体背调', () => {
  const screeningDto = (overrides: Partial<CreateLpProfileDto> = {}): CreateLpProfileDto => ({
    name: 'Falcon Liquidity FZE',
    agreementRef: 'AGR-2026-LP-001',
    dueDiligenceRef: 'DD-2026-LP-001',
    reason: 'Onboarding',
    ...overrides,
  });

  function buildScreeningDeps() {
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
    const approvals = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-LP-9' })), list: jest.fn() } as any;
    const svc = new LpProfileWorkflowService(profiles, approvals);
    return { svc, rows, audits, approvals };
  }

  it('背调 mock 三档：含 sanction → RED、含 offshore → YELLOW、其余 GREEN（大小写不敏感，RED 压过 YELLOW）', () => {
    expect(screenLpEntityName('Sanctioned Holdings FZE')).toBe('RED');
    expect(screenLpEntityName('ACME SANCTION Corp')).toBe('RED');
    expect(screenLpEntityName('Offshore Capital Ltd')).toBe('YELLOW');
    expect(screenLpEntityName('offshore sanction desk')).toBe('RED');
    expect(screenLpEntityName('Falcon Liquidity FZE')).toBe('GREEN');
  });

  it('背调 RED：名称含 Sanction → 建档当场 REJECTED（落点计算），不开审批单，审计 CREATED+SCREENED+REJECTED', async () => {
    const { svc, rows, audits, approvals } = buildScreeningDeps();

    const result = await svc.initiateCreate(screeningDto({ name: 'Sanctioned Holdings FZE' }), treasury);

    const [lpNo] = [...rows.keys()];
    expect(result).toEqual({ lpNo, approvalNo: null, status: LpProfileStatus.REJECTED });
    expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(rows.get(lpNo)).toMatchObject({ status: LpProfileStatus.REJECTED, screeningAnswer: 'RED', dueDiligenceRef: 'DD-2026-LP-001', approvalNo: null });
    expect(rows.get(lpNo).screenedAt).toBeInstanceOf(Date);

    expect(audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_CREATED', 'LP_PROFILE_SCREENED', 'LP_PROFILE_REJECTED']);
    const [created, screened, rejected] = audits;
    expect(created.via).toBe('actor'); // 建档是金库操作员的手
    expect(screened.via).toBe('system'); // 筛查与登记即拒是系统主体（同客户地址 3333 先例）
    expect(rejected.via).toBe('system');
    expect(screened.input.afterData).toMatchObject({ screeningAnswer: 'RED' });
    expect(rejected.input.reason).toBe('Entity screening returned RED at registration');
    expect(rejected.input.toStatus).toBe(LpProfileStatus.REJECTED);
    expect(rejected.input.fromStatus).toBeUndefined(); // 插入即终态：落点不是边，没有 fromStatus
    // 铁律①：每条都带显式、互异的 requestId（漏了会被静默去重）
    const requestIds = audits.map((a) => a.input.requestId);
    expect(requestIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(requestIds).size).toBe(3);
  });

  it('背调 YELLOW：名称含 Offshore → 放行留痕，照常 PENDING_APPROVAL 开审批，快照带背调结论与尽调引用', async () => {
    const { svc, rows, audits, approvals } = buildScreeningDeps();

    const result = await svc.initiateCreate(screeningDto({ name: 'Offshore Capital Ltd' }), treasury);

    const [lpNo] = [...rows.keys()];
    expect(result).toEqual({ lpNo, approvalNo: 'APR-LP-9', status: LpProfileStatus.PENDING_APPROVAL });
    expect(rows.get(lpNo)).toMatchObject({ status: LpProfileStatus.PENDING_APPROVAL, screeningAnswer: 'YELLOW', dueDiligenceRef: 'DD-2026-LP-001', approvalNo: 'APR-LP-9' });
    expect(rows.get(lpNo).screenedAt).toBeInstanceOf(Date);
    expect(approvals.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
        entityRef: lpNo,
        objectSnapshot: expect.objectContaining({ screeningAnswer: 'YELLOW', dueDiligenceRef: 'DD-2026-LP-001' }),
      }),
      expect.objectContaining({ reason: 'Onboarding' }),
      treasury,
    );
    expect(audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_CREATED', 'LP_PROFILE_SCREENED']);
    expect(audits[1].input.afterData).toMatchObject({ screeningAnswer: 'YELLOW' });
  });

  it('背调 GREEN：干净名称同样落结论并留 SCREENED 痕，走既有审批正门', async () => {
    const { svc, rows, audits, approvals } = buildScreeningDeps();

    const result = await svc.initiateCreate(screeningDto(), treasury);

    const [lpNo] = [...rows.keys()];
    expect(result.status).toBe(LpProfileStatus.PENDING_APPROVAL);
    expect(rows.get(lpNo)).toMatchObject({ screeningAnswer: 'GREEN', status: LpProfileStatus.PENDING_APPROVAL });
    expect(approvals.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(audits.map((a) => a.input.action)).toEqual(['LP_PROFILE_CREATED', 'LP_PROFILE_SCREENED']);
  });

  it('背调 DTO：缺 dueDiligenceRef → 400；纯空白同样 400；首尾空白被 trim', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const meta = { type: 'body' as const, metatype: CreateLpProfileDto };
    const { dueDiligenceRef: _omit, ...withoutRef } = screeningDto();

    await expect(pipe.transform(withoutRef, meta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...withoutRef, dueDiligenceRef: '   ' }, meta)).rejects.toThrow(BadRequestException);
    const ok = await pipe.transform({ ...withoutRef, dueDiligenceRef: '  DD-2026-LP-007  ' }, meta);
    expect(ok.dueDiligenceRef).toBe('DD-2026-LP-007');
  });
});

describe('LpProfileWorkflowService.onDecided — actionType=LP_PROFILE_APPROVAL', () => {
  it('APPROVED → transition(ACTIVE)，带 approvalNo/causationId', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'APPROVED' }));
    expect(profiles.transition).toHaveBeenCalledWith(LP_NO, LpProfileStatus.ACTIVE, {}, { approvalNo: 'APR-LP-1', causationId: 'causation-id-1' });
  });

  it('DECLINED → transition(REJECTED)，reason 取 decisionReason', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'DECLINED', decisionReason: 'Sanctions hit on beneficial owner' }));
    expect(profiles.transition).toHaveBeenCalledWith(
      LP_NO, LpProfileStatus.REJECTED, {},
      { approvalNo: 'APR-LP-1', causationId: 'causation-id-1', reason: 'Sanctions hit on beneficial owner' },
    );
  });

  it('EXPIRED → transition(REJECTED)，reason="Approval expired"', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'EXPIRED', decisionReason: null }));
    expect(profiles.transition).toHaveBeenCalledWith(
      LP_NO, LpProfileStatus.REJECTED, {},
      { approvalNo: 'APR-LP-1', causationId: 'causation-id-1', reason: 'Approval expired' },
    );
  });

  it('CANCELLED → 撤回口自己收口，不调 transition', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'CANCELLED' }));
    expect(profiles.transition).not.toHaveBeenCalled();
  });
});

describe('LpProfileWorkflowService.suspend / reactivate', () => {
  it('suspend：直接 transition(SUSPENDED) + actor 审计，不建审批', async () => {
    const { svc, profiles, approvals } = buildDeps();
    const result = await svc.suspend(LP_NO, { reason: 'Underperforming this quarter' }, treasury);
    expect(profiles.transition).toHaveBeenCalledWith(LP_NO, LpProfileStatus.SUSPENDED, {}, { actor: treasury, reason: 'Underperforming this quarter' });
    expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(result).toEqual({ lpNo: LP_NO, status: LpProfileStatus.SUSPENDED });
  });

  it('reactivate：直接 transition(ACTIVE) + actor 审计，不建审批', async () => {
    const { svc, profiles, approvals } = buildDeps();
    const result = await svc.reactivate(LP_NO, { reason: 'Back in good standing' }, treasury);
    expect(profiles.transition).toHaveBeenCalledWith(LP_NO, LpProfileStatus.ACTIVE, {}, { actor: treasury, reason: 'Back in good standing' });
    expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(result).toEqual({ lpNo: LP_NO, status: LpProfileStatus.ACTIVE });
  });
});
