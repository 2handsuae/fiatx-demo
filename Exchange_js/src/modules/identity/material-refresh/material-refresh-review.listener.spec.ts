import { MaterialRefreshReviewListener } from './material-refresh-review.listener';

/**
 * 2026-08-18 修回归：Task 11 之后 `sumsub-ingestion.service.ts` 的 Clue 3
 * （按 Sumsub 侧 actionId 查 pending MaterialRefreshCycle）对新周期恒查不到，
 * 材料重检域自己的完成收尾永久失联。本文件锁的是新监听器自己的路由行为：
 * 按 `materialRequestNo` 认领事件，认领到了才转给 `MaterialRefreshService`。
 *
 * 真实的 GREEN/RETRY/REJECTED 完成语义（holding 到期日刷新、cycle 转态、
 * 自动撕便签等）由 `MaterialRefreshService` 自己的用例覆盖
 * （`material-refresh-multi-cause.spec.ts` + 下面的端到端用例），这里只测
 * 「监听器把哪个 cycle、哪个 outcome 转给了完成逻辑」。
 */
function deps(cycle: Record<string, any> | null) {
  const prisma = {
    materialRefreshCycle: { findFirst: jest.fn().mockResolvedValue(cycle) },
  } as any;
  const materialRefreshService = {
    completeCycleFromMaterialRequest: jest.fn().mockResolvedValue(undefined),
  } as any;
  return { prisma, materialRefreshService };
}

const build = (d: ReturnType<typeof deps>) =>
  new MaterialRefreshReviewListener(d.prisma, d.materialRefreshService);

const baseEvent = {
  requestNo: 'MRQ-1',
  customerId: 'cust-1',
  orderDomain: null,
  orderRef: null,
  traceId: 'MATERIAL_REQUEST:t1',
};

describe('MaterialRefreshReviewListener.onMaterialRequestReviewed', () => {
  it('requestNo 不属于本域（findFirst 返回 null）→ 静默 return，不调任何完成逻辑', async () => {
    const d = deps(null);
    await build(d).onMaterialRequestReviewed({ ...baseEvent, outcome: 'APPROVED' });

    expect(d.prisma.materialRefreshCycle.findFirst).toHaveBeenCalledWith({
      where: { materialRequestNo: 'MRQ-1' },
    });
    expect(d.materialRefreshService.completeCycleFromMaterialRequest).not.toHaveBeenCalled();
  });

  it("outcome='APPROVED' → 调 GREEN 完成逻辑，断言真实参数（cycle.id + APPROVED）", async () => {
    const d = deps({ id: 'cyc-1', cycleNo: 'MRC-1' });
    await build(d).onMaterialRequestReviewed({ ...baseEvent, outcome: 'APPROVED' });

    expect(d.materialRefreshService.completeCycleFromMaterialRequest).toHaveBeenCalledWith(
      'cyc-1',
      'APPROVED',
    );
  });

  it("outcome='RETRY' → 转给完成逻辑的 outcome 仍是 RETRY（cycle 不该转终态，由 MaterialRefreshService 内部保证）", async () => {
    const d = deps({ id: 'cyc-1', cycleNo: 'MRC-1' });
    await build(d).onMaterialRequestReviewed({ ...baseEvent, outcome: 'RETRY' });

    expect(d.materialRefreshService.completeCycleFromMaterialRequest).toHaveBeenCalledWith(
      'cyc-1',
      'RETRY',
    );
  });

  it("outcome='REJECTED' → 走 RED 终态分支（转给完成逻辑的 outcome 是 REJECTED）", async () => {
    const d = deps({ id: 'cyc-1', cycleNo: 'MRC-1' });
    await build(d).onMaterialRequestReviewed({ ...baseEvent, outcome: 'REJECTED' });

    expect(d.materialRefreshService.completeCycleFromMaterialRequest).toHaveBeenCalledWith(
      'cyc-1',
      'REJECTED',
    );
  });

  it('完成逻辑抛错 → 监听器自己吞掉，不向外抛（{async:true} 是 detached 的，抛出去没人接）', async () => {
    const d = deps({ id: 'cyc-1', cycleNo: 'MRC-1' });
    d.materialRefreshService.completeCycleFromMaterialRequest.mockRejectedValue(new Error('boom'));

    await expect(
      build(d).onMaterialRequestReviewed({ ...baseEvent, outcome: 'APPROVED' }),
    ).resolves.toBeUndefined();
  });
});
