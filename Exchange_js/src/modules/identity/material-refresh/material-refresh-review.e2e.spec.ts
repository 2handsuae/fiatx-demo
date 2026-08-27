import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { MaterialRequestReviewService } from '../material-requests/material-request-review.service';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialRefreshReviewListener } from './material-refresh-review.listener';

/**
 * 端到端：从 `MaterialRequestReviewService.applyReview()` 发的
 * `MATERIAL_REQUEST_REVIEWED` 事件，到材料重检域的 cycle 状态真的改变。
 *
 * 为什么专门补这一条：上一个任务（Task 11）自己的教训——「两头都测、中间不测」
 * 曾漏掉一个客户永久卡死的 bug（`autoRelease` 的 `caseRef` 键换了没同步改，
 * 单测各自 mock 掉了对方，谁也没验证过两边实际能对上）。这里同样有两个既有的
 * 单元测试：`material-request-review.service.spec.ts` mock 了 `eventEmitter.emit`
 * 只断言"发没发、发了什么"；`material-refresh-review.listener.spec.ts` mock 了
 * `MaterialRefreshService` 只断言"转发了什么参数"。两头都测了，中间——事件真
 * 从一个 `EventEmitter2` 实例广播出去、被真实注册的监听器接住、驱动到
 * `MaterialRefreshService` 的真实 DB 更新——从来没人验证过。这条补上。
 *
 * 用真实的 `EventEmitter2`（不是 `{ emit: jest.fn() }`）+ 真实的
 * `MaterialRefreshReviewListener` + 真实的 `MaterialRefreshService`，跑在手搓
 * 的内存 prisma 上。`MaterialRequestReviewService` 的 `requests`/`restrictions`
 * 两个依赖仍用轻量 fake（同 `material-request-review.service.spec.ts` 的风格）
 * ——材料请求账自身的状态机已经在那份测试里覆盖，这里要证明的是事件契约本身
 * 对得上，不是重新证明一遍材料账的裁决逻辑。
 */

const ACTOR = { actorType: 'SYSTEM' as const, actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' };

const CUSTOMER_ID = 'cust-e2e';
const HOLDING_ID = 'hold-e2e';
const CYCLE_ID = 'cyc-e2e';
const REQUEST_NO = 'MRQ-E2E';

function matches(row: Record<string, any>, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as any[]).includes(row[k]);
    }
    return row[k] === v;
  });
}

function makeTable(seed: Record<string, any>[]) {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`no row for ${JSON.stringify(where)}`);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
}

function buildHarness(cycleStatus: string) {
  const materialRefreshCycleTable = makeTable([
    {
      id: CYCLE_ID,
      cycleNo: 'MRC-E2E',
      customerId: CUSTOMER_ID,
      holdingId: HOLDING_ID,
      materialType: 'PROOF_OF_ADDRESS',
      status: cycleStatus,
      stage: 'URGENT',
      triggerType: 'SCHEDULED_EXPIRY',
      materialRequestNo: REQUEST_NO,
    },
  ]);
  const customerMaterialHoldingTable = makeTable([
    {
      id: HOLDING_ID,
      customerId: CUSTOMER_ID,
      materialType: 'PROOF_OF_ADDRESS',
      managementMode: 'SELF_MANAGED',
      status: 'REFRESH_IN_PROGRESS',
      activeRefreshCycleId: CYCLE_ID,
      verifiedAt: new Date('2025-01-01'),
      expiresAt: new Date('2026-01-01'),
    },
  ]);
  const customerMainTable = makeTable([{ id: CUSTOMER_ID, riskRating: 'LOW' }]);

  const materialRefreshPrisma: Record<string, any> = {
    materialRefreshCycle: materialRefreshCycleTable,
    customerMaterialHolding: customerMaterialHoldingTable,
    customerMain: customerMainTable,
  };
  // REJECTED 分支的两次写包在 $transaction 里（Task 11 修复）——tx 转发回同一批
  // 手搓表，语义与真实 SQLite 事务对手搓桩来说等价（同一进程内顺序执行）。
  materialRefreshPrisma.$transaction = jest.fn((cb: any) => cb(materialRefreshPrisma));

  const restrictionWorkflow = { autoRelease: jest.fn().mockResolvedValue(undefined) };

  const materialRefreshService = new MaterialRefreshService(
    materialRefreshPrisma as any,
    {} as any, // sumsubClient — SELF_MANAGED holding 不会碰它
    { getMaterialConfig: jest.fn().mockReturnValue({ windowDays: { LOW: 365 } }) } as any, // policyLoader
    {} as any, // restrictionsService — 本域 GREEN 收尾只碰 restrictionWorkflowService
    restrictionWorkflow as any,
    {} as any, // issuer — completeCycleReview 不建行
    {} as any, // materialRequests — completeCycleReview 不碰材料账写路径
  );

  const listener = new MaterialRefreshReviewListener(
    { materialRefreshCycle: materialRefreshCycleTable } as any,
    materialRefreshService,
  );

  const eventEmitter = new EventEmitter2();
  let pending: Promise<void> | undefined;
  eventEmitter.on(DomainEventNames.MATERIAL_REQUEST_REVIEWED, (evt: any) => {
    pending = listener.onMaterialRequestReviewed(evt);
  });

  const requests = {
    findByExternalActionId: jest.fn().mockResolvedValue({
      requestNo: REQUEST_NO,
      customerId: CUSTOMER_ID,
      orderDomain: null,
      orderRef: null,
      restrictionNo: null,
      traceId: 'MATERIAL_REQUEST:t-e2e',
    }),
    markReviewed: jest.fn(async (_no: string, ans: string, rt: string | null) => ({
      requestNo: REQUEST_NO,
      customerId: CUSTOMER_ID,
      orderDomain: null,
      orderRef: null,
      status: ans === 'GREEN' ? 'APPROVED' : rt === 'RETRY' ? 'PENDING_SUBMISSION' : 'REJECTED',
      traceId: 'MATERIAL_REQUEST:t-e2e',
    })),
  };
  const reviewService = new MaterialRequestReviewService(
    { $transaction: jest.fn((cb: any) => cb({})) } as any,
    requests as any,
    { findByNo: jest.fn() } as any, // restrictionNo 为 null，applyReview 内部不会调它
    { autoRelease: jest.fn().mockResolvedValue(undefined) } as any,
    eventEmitter,
  );

  return {
    reviewService,
    materialRefreshCycleTable,
    customerMaterialHoldingTable,
    restrictionWorkflow,
    getPending: () => pending,
  };
}

describe('端到端：MATERIAL_REQUEST_REVIEWED 事件真被材料重检域接住并驱动状态改变', () => {
  it('GREEN → cycle 转 CLEARED，holding 到期日真的被刷新，activeRefreshCycleId 清空', async () => {
    const h = buildHarness('PENDING_SUMSUB_REVIEW');
    const expiresAtBefore = h.customerMaterialHoldingTable.rows[0].expiresAt;

    await h.reviewService.applyReview({
      externalActionId: 'EA-E2E',
      reviewAnswer: 'GREEN',
      actor: ACTOR,
    });

    // 事件是同步 emit 出去的,但监听器是 async——emit() 返回时,监听器体内第一个
    // await 之后的部分还没跑完(与真实 {async:true} 的 detached 语义一致)。
    expect(h.getPending()).toBeDefined();
    await h.getPending();

    const cycle = h.materialRefreshCycleTable.rows[0];
    expect(cycle.status).toBe('CLEARED');

    const holding = h.customerMaterialHoldingTable.rows[0];
    expect(holding.status).toBe('FRESH');
    expect(holding.activeRefreshCycleId).toBeNull();
    // 这是本域存在的全部意义——到期日必须真的变了
    expect(holding.expiresAt).not.toEqual(expiresAtBefore);

    expect(h.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      CUSTOMER_ID,
      'MATERIAL_EXPIRED',
      REQUEST_NO,
      'SYSTEM',
    );
  });

  it('RED+FINAL → cycle 转 REJECTED 终态，holding 的 activeRefreshCycleId 被清空以便开下一轮', async () => {
    const h = buildHarness('PENDING_SUMSUB_REVIEW');

    await h.reviewService.applyReview({
      externalActionId: 'EA-E2E',
      reviewAnswer: 'RED',
      reviewRejectType: 'FINAL',
      actor: ACTOR,
    });
    await h.getPending();

    const cycle = h.materialRefreshCycleTable.rows[0];
    expect(cycle.status).toBe('REJECTED');

    const holding = h.customerMaterialHoldingTable.rows[0];
    expect(holding.activeRefreshCycleId).toBeNull();

    // 只有 GREEN 才撕便签 —— REJECTED 是终态但没解开，便签必须原地不动
    expect(h.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('RED+RETRY → cycle 退回 PENDING_CUSTOMER_EVIDENCE，不转终态', async () => {
    const h = buildHarness('PENDING_SUMSUB_REVIEW');

    await h.reviewService.applyReview({
      externalActionId: 'EA-E2E',
      reviewAnswer: 'RED',
      reviewRejectType: 'RETRY',
      actor: ACTOR,
    });
    await h.getPending();

    const cycle = h.materialRefreshCycleTable.rows[0];
    expect(cycle.status).toBe('PENDING_CUSTOMER_EVIDENCE');
    expect(cycle.customerSubmittedAt).toBeNull();

    // RETRY 不该动 holding 的 activeRefreshCycleId——这一轮还没完
    const holding = h.customerMaterialHoldingTable.rows[0];
    expect(holding.activeRefreshCycleId).toBe(CYCLE_ID);

    // 只有 GREEN 才撕便签 —— RETRY 还没进终态，更不该撕
    expect(h.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });
});
