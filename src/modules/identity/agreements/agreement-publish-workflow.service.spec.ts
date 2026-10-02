import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { AuditActions, AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AgreementPublishApprovalService } from './agreement-publish-approval.service';
import { AgreementPublishWorkflowService, NOTICE_PERIOD_DAYS } from './agreement-publish-workflow.service';

// 战役丙波三 T3：prisma / 审批 / 审计 / 通知 / 读服务全 mock，mock 行为化——where 按语义过滤
// （等值 / {in}），updateMany 真按出发态 where 返回 count，不无视 where 假绿（本仓判例：
// mock无视where假绿）。内存"库"可被断言直接读回；events 数组记录跨协作者的发生次序。

type VersionRow = {
  id: string;
  versionKey: string;
  status: string;
  summary: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  pendingApprovalNo: string | null;
};
type ApprovalCase = { approvalNo: string; actionType: string; status: string; objectSnapshot: Record<string, unknown> };

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-10T08:00:00.000Z');

const ACTOR = {
  actorType: 'ADMIN' as const,
  userId: 'uuid-compliance',
  userNo: 'ADM-COMPLIANCE',
  role: 'COMPLIANCE_OFFICER',
  roleCodes: ['COMPLIANCE_OFFICER'],
};

function fieldMatches(actual: any, cond: any): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond) return cond.in.includes(actual);
    throw new Error(`mock: unsupported where operator ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}
function rowMatches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]) => fieldMatches(row[k], v));
}

function version(versionKey: string, status: string, effectiveAt: Date | null = null): VersionRow {
  return {
    id: `id-${versionKey}`,
    versionKey,
    status,
    summary: `summary of ${versionKey}`,
    effectiveAt,
    publishedAt: status === 'PUBLISHED' || status === 'EFFECTIVE' || status === 'SUPERSEDED' ? new Date(NOW.getTime() - DAY) : null,
    pendingApprovalNo: null,
  };
}

function makeHarness(rows: VersionRow[], approvals: ApprovalCase[] = []) {
  const versions = rows.map((r) => ({ ...r }));
  const cases: ApprovalCase[] = [...approvals];
  const events: string[] = [];

  const prisma: any = {
    customerAgreementVersion: {
      findUnique: jest.fn(async ({ where }: any) => versions.find((r) => rowMatches(r, where)) ?? null),
      findFirst: jest.fn(async ({ where }: any = {}) => versions.find((r) => rowMatches(r, where)) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = versions.filter((r) => rowMatches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        if (hit.length > 0) events.push(`flip:${data.status}`);
        return { count: hit.length };
      }),
    },
  };

  const approvalsService: any = {
    createAndSubmit: jest.fn(async (dto: any) => {
      events.push('openApproval');
      const approvalNo = `APR-AGR-${cases.length + 1}`;
      cases.push({ approvalNo, actionType: dto.actionType, status: 'PENDING', objectSnapshot: dto.objectSnapshot });
      return { approvalNo };
    }),
    list: jest.fn(async (q: any) => {
      const items = cases.filter(
        (c) => (!q.approvalNo || c.approvalNo === q.approvalNo) && (!q.actionType || c.actionType === q.actionType) && (!q.status || c.status === q.status),
      );
      return { total: items.length, items };
    }),
  };

  const auditLogs: any = {
    recordByActor: jest.fn(async (input: any) => {
      events.push(`audit:${input.action}`);
    }),
    recordSystem: jest.fn(async (input: any) => {
      events.push(`audit:${input.action}`);
    }),
  };

  // 读服务只用 tickEffective：行为化——到点的 PUBLISHED 翻 EFFECTIVE（真实现是懒翻）。
  const agreementsRead: any = {
    tickEffective: jest.fn(async () => {
      for (const r of versions) {
        if (r.status === 'PUBLISHED' && r.effectiveAt && r.effectiveAt.getTime() <= Date.now()) r.status = 'EFFECTIVE';
      }
    }),
  };

  const notifications: any = {
    notifyAgreementPublished: jest.fn(async () => {
      events.push('notify');
    }),
  };

  const svc = new AgreementPublishWorkflowService(prisma, approvalsService, auditLogs, agreementsRead, notifications);
  const row = (versionKey: string) => versions.find((r) => r.versionKey === versionKey)!;
  const approveCase = (approvalNo: string) => {
    cases.find((c) => c.approvalNo === approvalNo)!.status = 'APPROVED';
  };
  return { svc, versions, cases, events, row, approveCase, prisma, approvalsService, auditLogs, agreementsRead, notifications };
}

function makeDecidedEvent(overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.AGREEMENT_PUBLISH,
    entityRef: 'v2',
    approvalId: 'approval-id-1',
    approvalNo: 'APR-AGR-1',
    traceId: 'trace-1',
    workflowType: AuditBusinessWorkflowTypes.CUSTOMER_AGREEMENT,
    decisionByUserId: 'uuid-sm',
    decisionByUserNo: 'ADM-SM',
    decisionByRole: 'SENIOR_MANAGEMENT_OFFICER',
    decisionReason: null,
    decidedAt: NOW.toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** 一张在途审批单 + 对应的 PENDING_APPROVAL 版本行（onDecided 用例的起点）。 */
function pendingHarness(effectiveAt: Date) {
  const v2 = { ...version('v2', 'PENDING_APPROVAL', effectiveAt), pendingApprovalNo: 'APR-AGR-1' };
  const h = makeHarness(
    [version('v1', 'EFFECTIVE', new Date(NOW.getTime() - 90 * DAY)), v2],
    [
      {
        approvalNo: 'APR-AGR-1',
        actionType: ApprovalActionTypes.AGREEMENT_PUBLISH,
        status: 'APPROVED',
        objectSnapshot: { versionKey: 'v2', effectiveAt: effectiveAt.toISOString() },
      },
    ],
  );
  return h;
}

beforeEach(() => {
  // 只冻结 Date——其余计时器照常，async/await 不受影响。
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('NOTICE_PERIOD_DAYS', () => {
  it('通知期常量 = 30 天（VARA MC II.A.7）', () => {
    expect(NOTICE_PERIOD_DAYS).toBe(30);
  });
});

describe('AgreementPublishApprovalService（handler 形状）', () => {
  it('actionType=AGREEMENT_PUBLISH、workflowType=CUSTOMER_AGREEMENT，派生二级事件名与登记一致', async () => {
    const emitter: any = { emitAsync: jest.fn().mockResolvedValue(undefined) };
    const handler = new AgreementPublishApprovalService(emitter);
    expect(handler.actionType).toBe(ApprovalActionTypes.AGREEMENT_PUBLISH);
    expect(handler.workflowType).toBe(AuditBusinessWorkflowTypes.CUSTOMER_AGREEMENT);

    await handler.handleApproved({ actionType: 'AGREEMENT_PUBLISH', entityRef: 'v2', approvalId: 'i', approvalNo: 'APR-1', traceId: 't', status: 'APPROVED' });
    // 派生名必须与事件登记处一致——workflow 订阅的是登记名，两边漂移则裁决永远落不了地。
    expect(emitter.emitAsync).toHaveBeenCalledWith(DOMAIN_EVENTS.AGREEMENT_PUBLISH_DECIDED.name, expect.objectContaining({ decision: 'APPROVED', entityRef: 'v2' }));

    // 别的动作类型的裁决不得串线进来。
    emitter.emitAsync.mockClear();
    await handler.handleApproved({ actionType: 'RI_REPLACEMENT', entityRef: 'RI1', approvalId: 'i', approvalNo: 'APR-2', traceId: 't', status: 'APPROVED' });
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });
});

describe('AgreementPublishWorkflowService.submitPublish', () => {
  // ①
  it('v2 DRAFT + effectiveAt=now+31d：正门开单恰一次，版本行翻 PENDING_APPROVAL 并落 effectiveAt/pendingApprovalNo，留痕 SUBMITTED 恰一次', async () => {
    const { svc, row, events, approvalsService, auditLogs } = makeHarness([version('v1', 'EFFECTIVE', new Date(NOW.getTime() - 90 * DAY)), version('v2', 'DRAFT')]);
    const effectiveAt = new Date(NOW.getTime() + 31 * DAY);

    const result = await svc.submitPublish('v2', effectiveAt.toISOString(), ACTOR);

    expect(result).toEqual({ approvalNo: 'APR-AGR-1' });
    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    const [createDto, submitDto, actorArg] = approvalsService.createAndSubmit.mock.calls[0];
    expect(createDto).toEqual(
      expect.objectContaining({
        actionType: ApprovalActionTypes.AGREEMENT_PUBLISH,
        entityRef: 'v2',
        objectSnapshot: expect.objectContaining({ versionKey: 'v2', effectiveAt: effectiveAt.toISOString() }),
      }),
    );
    // createAndSubmit 要求两处 traceId 一致（assertTraceConsistency）。
    expect(submitDto.traceId).toBe(createDto.traceId);
    expect(typeof submitDto.reason).toBe('string');
    expect(actorArg).toEqual(expect.objectContaining({ userId: 'uuid-compliance' }));

    expect(row('v2')).toEqual(expect.objectContaining({ status: 'PENDING_APPROVAL', pendingApprovalNo: 'APR-AGR-1', effectiveAt }));

    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
    const [auditInput, auditActor] = auditLogs.recordByActor.mock.calls[0];
    expect(auditInput).toEqual(
      expect.objectContaining({
        action: AuditActions.AGREEMENT_PUBLISH_SUBMITTED,
        actionDomain: 'GOVERNANCE',
        primarySubjectType: 'AGREEMENT_VERSION',
        primarySubjectNo: 'v2',
        versionKey: 'v2',
        effectiveAt: effectiveAt.toISOString(),
        approvalNo: 'APR-AGR-1',
        requestId: expect.stringMatching(/^AGREEMENT_PUBLISH_SUBMITTED_v2_/),
        metadata: expect.objectContaining({ versionKey: 'v2', effectiveAt: effectiveAt.toISOString() }),
      }),
    );
    expect(auditActor).toEqual(expect.objectContaining({ actorType: 'ADMIN', actorNo: 'ADM-COMPLIANCE', actorRolesAtTime: ['COMPLIANCE_OFFICER'] }));

    // 次序：先开单、再翻状态、最后留痕。
    expect(events).toEqual(['openApproval', 'flip:PENDING_APPROVAL', 'audit:AGREEMENT_PUBLISH_SUBMITTED']);
  });

  // ② 提交锚：边界 29 / 30 各一
  it('提交预检拒：effectiveAt=now+29d → BadRequest，零开单零审计、版本行不动', async () => {
    const { svc, row, approvalsService, auditLogs } = makeHarness([version('v1', 'EFFECTIVE'), version('v2', 'DRAFT')]);

    await expect(svc.submitPublish('v2', new Date(NOW.getTime() + 29 * DAY).toISOString(), ACTOR)).rejects.toThrow(BadRequestException);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
    expect(row('v2')).toEqual(expect.objectContaining({ status: 'DRAFT', effectiveAt: null, pendingApprovalNo: null }));
  });

  it('提交预检边界：effectiveAt=now+30d 整，放行', async () => {
    const { svc, row, approvalsService } = makeHarness([version('v1', 'EFFECTIVE'), version('v2', 'DRAFT')]);

    await svc.submitPublish('v2', new Date(NOW.getTime() + 30 * DAY).toISOString(), ACTOR);

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
    expect(row('v2').status).toBe('PENDING_APPROVAL');
  });

  // ③
  it('状态拒：v1(EFFECTIVE) 提交 → BadRequest「Only DRAFT」，零开单', async () => {
    const { svc, approvalsService, auditLogs } = makeHarness([version('v1', 'EFFECTIVE'), version('v2', 'DRAFT')]);

    await expect(svc.submitPublish('v1', new Date(NOW.getTime() + 31 * DAY).toISOString(), ACTOR)).rejects.toThrow(/Only DRAFT/);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
  });

  it.each(['PENDING_APPROVAL', 'PUBLISHED'])('一张在途：已有版本处于 %s 时，另一版 DRAFT 提交 → BadRequest，零开单', async (inFlight) => {
    // PUBLISHED 在途要"未到点"才算在途（到点的会被懒翻走），故给未来生效日。
    const { svc, row, approvalsService } = makeHarness([
      version('v1', 'EFFECTIVE'),
      version('v2', inFlight, new Date(NOW.getTime() + 40 * DAY)),
      version('v3', 'DRAFT'),
    ]);

    await expect(svc.submitPublish('v3', new Date(NOW.getTime() + 31 * DAY).toISOString(), ACTOR)).rejects.toThrow(/in flight/);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(row('v3').status).toBe('DRAFT');
  });

  it('提交前先懒翻：已到点却仍停在 PUBLISHED 的旧在途版不挡新提交（tickEffective 先于在途校验）', async () => {
    const { svc, row, agreementsRead } = makeHarness([
      version('v1', 'EFFECTIVE'),
      version('v2', 'PUBLISHED', new Date(NOW.getTime() - DAY)), // 已到点、尚未被读口翻走
      version('v3', 'DRAFT'),
    ]);

    await svc.submitPublish('v3', new Date(NOW.getTime() + 31 * DAY).toISOString(), ACTOR);

    expect(agreementsRead.tickEffective).toHaveBeenCalled();
    expect(row('v2').status).toBe('EFFECTIVE');
    expect(row('v3').status).toBe('PENDING_APPROVAL');
  });

  it('查无此版本 → NotFound，零开单', async () => {
    const { svc, approvalsService } = makeHarness([version('v1', 'EFFECTIVE')]);

    await expect(svc.submitPublish('v9', new Date(NOW.getTime() + 31 * DAY).toISOString(), ACTOR)).rejects.toThrow(NotFoundException);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  // ⑦
  it('非法跃迁显式拒：对 PUBLISHED 行再 submitPublish → 拒（只有 DRAFT 可提），行不动、零开单', async () => {
    const { svc, row, approvalsService, auditLogs } = makeHarness([
      version('v1', 'EFFECTIVE'),
      version('v2', 'PUBLISHED', new Date(NOW.getTime() + 40 * DAY)),
    ]);

    await expect(svc.submitPublish('v2', new Date(NOW.getTime() + 41 * DAY).toISOString(), ACTOR)).rejects.toThrow(BadRequestException);

    expect(row('v2').status).toBe('PUBLISHED');
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(auditLogs.recordByActor).not.toHaveBeenCalled();
  });

  it('翻转走出发态 where：开单后若版本行已不是 DRAFT（updateMany 命中 0 行）→ 显式抛错，不留痕 SUBMITTED', async () => {
    const h = makeHarness([version('v1', 'EFFECTIVE'), version('v2', 'DRAFT')]);
    // 开单的瞬间别处把行翻走了——updateMany 的出发态 where 必须拦住而不是静默覆盖。
    h.approvalsService.createAndSubmit.mockImplementationOnce(async () => {
      h.row('v2').status = 'PUBLISHED';
      return { approvalNo: 'APR-AGR-1' };
    });

    await expect(h.svc.submitPublish('v2', new Date(NOW.getTime() + 31 * DAY).toISOString(), ACTOR)).rejects.toThrow(BadRequestException);

    expect(h.row('v2').status).toBe('PUBLISHED');
    expect(h.auditLogs.recordByActor).not.toHaveBeenCalled();
  });
});

describe('AgreementPublishWorkflowService.onDecided', () => {
  // ④
  it('APPROVED 且复核过（effectiveAt ≥ decidedAt+30d）：版本翻 PUBLISHED + publishedAt=批准时刻 + 清 pending；留痕 PUBLISHED；随后发信——次序 翻转→审计→发信', async () => {
    const effectiveAt = new Date(NOW.getTime() + 31 * DAY);
    const { svc, row, events, auditLogs, notifications } = pendingHarness(effectiveAt);

    await svc.onDecided(makeDecidedEvent());

    expect(row('v2')).toEqual(expect.objectContaining({ status: 'PUBLISHED', publishedAt: NOW, pendingApprovalNo: null, effectiveAt }));
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordSystem.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        action: AuditActions.AGREEMENT_PUBLISHED,
        actionDomain: 'GOVERNANCE',
        primarySubjectNo: 'v2',
        versionKey: 'v2',
        effectiveAt: effectiveAt.toISOString(),
        approvalNo: 'APR-AGR-1',
        requestId: expect.stringMatching(/^AGREEMENT_PUBLISHED_v2_/),
        metadata: expect.objectContaining({ versionKey: 'v2', effectiveAt: effectiveAt.toISOString() }),
      }),
    );
    expect(notifications.notifyAgreementPublished).toHaveBeenCalledTimes(1);
    expect(notifications.notifyAgreementPublished).toHaveBeenCalledWith('v2', effectiveAt);
    expect(events).toEqual(['flip:PUBLISHED', 'audit:AGREEMENT_PUBLISHED', 'notify']);
    // 批准路径不得误记驳回码。
    expect(auditLogs.recordSystem.mock.calls.map((c: any[]) => c[0].action)).not.toContain(AuditActions.AGREEMENT_PUBLISH_REJECTED);
  });

  // 双锚之二：批准锚 29 / 30 各一
  it('批准锚边界：effectiveAt = decidedAt+30d 整 → 放行（PUBLISHED）', async () => {
    const { svc, row } = pendingHarness(new Date(NOW.getTime() + 30 * DAY));

    await svc.onDecided(makeDecidedEvent());

    expect(row('v2').status).toBe('PUBLISHED');
  });

  // ⑤
  it('APPROVED 但复核不过（effectiveAt = decidedAt+29d，提交后拖延所致）：退 DRAFT + 清 pending + effectiveAt 置 null；留痕 REJECTED(NOTICE_PERIOD_SHORTFALL)；零发信', async () => {
    const effectiveAt = new Date(NOW.getTime() + 29 * DAY);
    const { svc, row, events, auditLogs, notifications } = pendingHarness(effectiveAt);

    await svc.onDecided(makeDecidedEvent());

    expect(row('v2')).toEqual(expect.objectContaining({ status: 'DRAFT', effectiveAt: null, pendingApprovalNo: null, publishedAt: null }));
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordSystem.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        action: AuditActions.AGREEMENT_PUBLISH_REJECTED,
        actionDomain: 'GOVERNANCE',
        primarySubjectNo: 'v2',
        versionKey: 'v2',
        decision: 'NOTICE_PERIOD_SHORTFALL',
        approvalNo: 'APR-AGR-1',
        requestId: expect.stringMatching(/^AGREEMENT_PUBLISH_REJECTED_v2_/),
        metadata: expect.objectContaining({ versionKey: 'v2', decision: 'NOTICE_PERIOD_SHORTFALL' }),
      }),
    );
    expect(notifications.notifyAgreementPublished).not.toHaveBeenCalled();
    expect(events).toEqual(['flip:DRAFT', 'audit:AGREEMENT_PUBLISH_REJECTED']);
  });

  it('批准锚以裁决事件的 decidedAt 为准，不是当前时钟：decidedAt 比 now 晚 5 天时，now+31d 的生效日只剩 26 天 → 退回', async () => {
    const { svc, row, notifications } = pendingHarness(new Date(NOW.getTime() + 31 * DAY));

    await svc.onDecided(makeDecidedEvent({ decidedAt: new Date(NOW.getTime() + 5 * DAY).toISOString() }));

    expect(row('v2').status).toBe('DRAFT');
    expect(notifications.notifyAgreementPublished).not.toHaveBeenCalled();
  });

  it('事件缺 decidedAt 时回落到当前时刻', async () => {
    const { svc, row } = pendingHarness(new Date(NOW.getTime() + 31 * DAY));

    await svc.onDecided(makeDecidedEvent({ decidedAt: null }));

    expect(row('v2')).toEqual(expect.objectContaining({ status: 'PUBLISHED', publishedAt: NOW }));
  });

  // ⑥
  it.each(['DECLINED', 'CANCELLED', 'EXPIRED'] as const)('%s：退 DRAFT + 清 pending + effectiveAt 置 null；留痕 REJECTED(decision=原值)；零发信', async (decision) => {
    const { svc, row, events, auditLogs, notifications, approvalsService } = pendingHarness(new Date(NOW.getTime() + 40 * DAY));

    await svc.onDecided(makeDecidedEvent({ decision }));

    expect(row('v2')).toEqual(expect.objectContaining({ status: 'DRAFT', effectiveAt: null, pendingApprovalNo: null }));
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordSystem.mock.calls[0][0]).toEqual(
      expect.objectContaining({ action: AuditActions.AGREEMENT_PUBLISH_REJECTED, versionKey: 'v2', decision, approvalNo: 'APR-AGR-1' }),
    );
    expect(notifications.notifyAgreementPublished).not.toHaveBeenCalled();
    // 非批准分支不需要读快照。
    expect(approvalsService.list).not.toHaveBeenCalled();
    expect(events).toEqual(['flip:DRAFT', 'audit:AGREEMENT_PUBLISH_REJECTED']);
  });

  // ⑦ 迁移表语义：出发态不对 → 0 行 → 显式抛错，不留痕、不发信
  it('非法跃迁显式拒：版本行不在 PENDING_APPROVAL（如已 DRAFT）时收到 DECLINED → 抛错，行不动、零审计', async () => {
    const { svc, row, auditLogs } = makeHarness([version('v1', 'EFFECTIVE'), version('v2', 'DRAFT')]);

    await expect(svc.onDecided(makeDecidedEvent({ decision: 'DECLINED' }))).rejects.toThrow(BadRequestException);

    expect(row('v2').status).toBe('DRAFT');
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('非法跃迁显式拒：版本行已 PUBLISHED 时再收到 APPROVED → 抛错，不重复留痕、不重复发信', async () => {
    const effectiveAt = new Date(NOW.getTime() + 40 * DAY);
    const h = makeHarness(
      [version('v1', 'EFFECTIVE'), version('v2', 'PUBLISHED', effectiveAt)],
      [{ approvalNo: 'APR-AGR-1', actionType: ApprovalActionTypes.AGREEMENT_PUBLISH, status: 'APPROVED', objectSnapshot: { versionKey: 'v2', effectiveAt: effectiveAt.toISOString() } }],
    );

    await expect(h.svc.onDecided(makeDecidedEvent())).rejects.toThrow(BadRequestException);

    expect(h.auditLogs.recordSystem).not.toHaveBeenCalled();
    expect(h.notifications.notifyAgreementPublished).not.toHaveBeenCalled();
  });

  // 白9 判例：快照按 approvalNo 精确查
  it('APPROVED 快照按 approvalNo 精确查（不是"最新一条"）：库里另有一张更晚的已批单，也不串', async () => {
    const effectiveAt = new Date(NOW.getTime() + 31 * DAY);
    const { svc, row, approvalsService, cases } = pendingHarness(effectiveAt);
    // 另一张（编号不同）已批单排在后面，快照里的 effectiveAt 是个已不足 30 天的值。
    cases.push({
      approvalNo: 'APR-AGR-2',
      actionType: ApprovalActionTypes.AGREEMENT_PUBLISH,
      status: 'APPROVED',
      objectSnapshot: { versionKey: 'v2', effectiveAt: new Date(NOW.getTime() + 5 * DAY).toISOString() },
    });

    await svc.onDecided(makeDecidedEvent({ approvalNo: 'APR-AGR-1' }));

    expect(approvalsService.list).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ApprovalActionTypes.AGREEMENT_PUBLISH, approvalNo: 'APR-AGR-1', status: 'APPROVED' }),
    );
    expect(row('v2')).toEqual(expect.objectContaining({ status: 'PUBLISHED', effectiveAt }));
  });

  it('APPROVED 但查无带快照的已批单 → 抛错，行不动、零发信', async () => {
    const { svc, row, notifications } = makeHarness([
      version('v1', 'EFFECTIVE'),
      { ...version('v2', 'PENDING_APPROVAL', new Date(NOW.getTime() + 40 * DAY)), pendingApprovalNo: 'APR-AGR-1' },
    ]);

    await expect(svc.onDecided(makeDecidedEvent())).rejects.toThrow(/APR-AGR-1/);

    expect(row('v2').status).toBe('PENDING_APPROVAL');
    expect(notifications.notifyAgreementPublished).not.toHaveBeenCalled();
  });

  // 控制者裁决②：通知是旁路副作用——吞错
  it('发信失败不拖垮发布落地：notifyAgreementPublished 外抛时 onDecided 照常 resolve，版本已 PUBLISHED、PUBLISHED 审计已落', async () => {
    const effectiveAt = new Date(NOW.getTime() + 31 * DAY);
    const { svc, row, auditLogs, notifications } = pendingHarness(effectiveAt);
    notifications.notifyAgreementPublished.mockRejectedValueOnce(new Error('customer table unavailable'));

    await expect(svc.onDecided(makeDecidedEvent())).resolves.toBeUndefined();

    expect(notifications.notifyAgreementPublished).toHaveBeenCalledTimes(1);
    expect(row('v2').status).toBe('PUBLISHED');
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('submitPublish → 裁决 → onDecided 往返', () => {
  it('提交时冻结的快照原样决定落地值：批的是什么就落的是什么', async () => {
    const h = makeHarness([version('v1', 'EFFECTIVE', new Date(NOW.getTime() - 90 * DAY)), version('v2', 'DRAFT')]);
    const effectiveAt = new Date(NOW.getTime() + 45 * DAY);

    const { approvalNo } = await h.svc.submitPublish('v2', effectiveAt.toISOString(), ACTOR);
    h.approveCase(approvalNo);
    await h.svc.onDecided(makeDecidedEvent({ approvalNo }));

    expect(h.row('v2')).toEqual(expect.objectContaining({ status: 'PUBLISHED', effectiveAt, pendingApprovalNo: null, publishedAt: NOW }));
    expect(h.notifications.notifyAgreementPublished).toHaveBeenCalledWith('v2', effectiveAt);
    expect(h.events).toEqual([
      'openApproval',
      'flip:PENDING_APPROVAL',
      'audit:AGREEMENT_PUBLISH_SUBMITTED',
      'flip:PUBLISHED',
      'audit:AGREEMENT_PUBLISHED',
      'notify',
    ]);
  });
});
