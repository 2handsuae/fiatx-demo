// material-refresh-review.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRefreshService } from './material-refresh.service';
import type { ReviewOutcome } from '../material-requests/material-request-review.service';

interface MaterialRequestReviewedEvent {
  requestNo: string;
  customerId: string;
  orderDomain: string | null;
  orderRef: string | null;
  outcome: ReviewOutcome;
  traceId: string;
}

/**
 * 材料重检域自己的收尾入口（2026-08-18 修复回归）。
 *
 * 背景：2026-08-17 材料请求账 Task 11 把 T-30/T-0 建 action 改走
 * `MaterialRequestIssuerService.issue()` 之后，cycle 定位其旧的 Sumsub action
 * id 那一列永远不再被写入（该列已随 Task 12 物理删除）。`sumsub-ingestion.service.ts` 原来靠这一列定位 cycle 的
 * Clue 3 分支从此对所有新周期恒查不到，而 Task 4 的路由又会先按
 * `externalActionId` 认领同一条 webhook 交给 `MaterialRequestReviewService`，
 * 根本轮不到 Clue 3。净效果：客户的限制便签被正确撕掉了，但材料重检域自己的
 * 那摊事——证件到期日刷新、cycle 转 `CLEARED`、CRA 级联——全部失联，且静默
 * 无声（详见 `doc-final/BACKLOG.md` "材料重检自己的 GREEN 完成收尾…失去触发
 * 入口" 一条）。
 *
 * 修法：`MaterialRequestReviewService.applyReview()` 已经在裁决落地后广播
 * `MATERIAL_REQUEST_REVIEWED` 事件——材料账"只广播事实，各域自己决定怎么推进"
 * 的设计意图正是为了让下游域（本域、deposit、withdraw、swap……）各自挂钩。
 * 这里按 `materialRequestNo` 把事件认领回属于本域的 cycle，重新接上
 * `MaterialRefreshService` 里现成的完成逻辑。
 */
@Injectable()
export class MaterialRefreshReviewListener {
  private readonly logger = new Logger(MaterialRefreshReviewListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  @OnEvent(DomainEventNames.MATERIAL_REQUEST_REVIEWED, { async: true })
  async onMaterialRequestReviewed(event: MaterialRequestReviewedEvent): Promise<void> {
    if (!event?.requestNo) return;

    const cycle = await (this.prisma as any).materialRefreshCycle.findFirst({
      where: { materialRequestNo: event.requestNo },
    });
    // 不属于本域——材料账里也有 deposit/withdraw/swap 自己下发的行，
    // 静默 return，让别的域自己的监听器去认领。
    if (!cycle) return;

    try {
      await this.materialRefreshService.completeCycleFromMaterialRequest(cycle.id, event.outcome);
    } catch (e) {
      // 逐事件兜住：一次收尾失败不该让 EventEmitter2 把异常吞成一次性静默丢弃
      // 却又没有任何可查的日志——至少留一条 warn。
      this.logger.warn(
        `Failed to complete material-refresh cycle ${cycle.cycleNo} for material request ${event.requestNo}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
