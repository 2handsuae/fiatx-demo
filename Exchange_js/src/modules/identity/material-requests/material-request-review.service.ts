import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { MaterialRequestsService, type MaterialActor } from './material-requests.service';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';

export type ReviewOutcome = 'APPROVED' | 'RETRY' | 'REJECTED';

/**
 * 裁决编排（设计稿 2026-08-17 §5.2）。
 *
 * 三条结局共用一句原则：**只有 GREEN 撕便签**。两种 RED 都把便签留在原地 ——
 * 审不过就是没解开，这是整套设计里最不能含糊的一条。RETRY 与 FINAL 的区别
 * 只在这一行还能不能继续用。
 */
@Injectable()
export class MaterialRequestReviewService {
  private readonly logger = new Logger(MaterialRequestReviewService.name);

  constructor(
    private readonly requests: MaterialRequestsService,
    private readonly restrictions: CustomerRestrictionsService,
    private readonly restrictionWorkflow: CustomerRestrictionWorkflowService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async applyReview(input: {
    externalActionId: string;
    reviewAnswer: 'GREEN' | 'RED';
    reviewRejectType?: 'RETRY' | 'FINAL';
    actor: MaterialActor;
  }): Promise<{ requestNo: string; outcome: ReviewOutcome } | null> {
    const row = await this.requests.findByExternalActionId(input.externalActionId);
    // 不属于本账 —— 静默返回 null，让调用方决定要不要继续别的路由。
    // 不抛：真实 Sumsub 会推来各种我们不认领的 action。
    if (!row) return null;

    const rejectType = input.reviewAnswer === 'RED' ? (input.reviewRejectType ?? null) : null;
    const updated = await this.requests.markReviewed(
      row.requestNo,
      input.reviewAnswer,
      rejectType,
      input.actor,
    );

    const outcome: ReviewOutcome =
      input.reviewAnswer === 'GREEN' ? 'APPROVED' : rejectType === 'RETRY' ? 'RETRY' : 'REJECTED';

    if (outcome === 'APPROVED' && row.restrictionNo) {
      // autoRelease 按 (customerId, cause, caseRef) 找便签，不认 restrictionNo。
      // ⚠️ 不要假定 caseRef === requestNo：那只在 issuer 自己开的便签上成立
      // （Task 3）。兑换域的软线拒是**先**开便签（caseRef=swapNo）**再**登记
      // 材料请求的——那个 fail-safe 顺序是 load-bearing 的，不能为了凑
      // caseRef 而调换。所以这里读便签自己的 caseRef，两条路径都对。
      const restriction = await this.restrictions.findByNo(row.restrictionNo);
      if (restriction) {
        await this.restrictionWorkflow.autoRelease(
          row.customerId,
          restriction.cause,
          restriction.caseRef,
          'SYSTEM',
        );
      } else {
        this.logger.warn(
          `Material request ${row.requestNo} points at restriction ${row.restrictionNo} which no longer exists — nothing to auto-release`,
        );
      }
    }

    // 只广播事实，不替订单域做状态决定 —— 各域的合规闸门规矩不一样，
    // 材料账不该知道充值退回和提现拒付分别该怎么走。
    this.eventEmitter.emit(DomainEventNames.MATERIAL_REQUEST_REVIEWED, {
      requestNo: updated.requestNo,
      customerId: updated.customerId,
      orderDomain: updated.orderDomain,
      orderRef: updated.orderRef,
      outcome,
      traceId: updated.traceId,
    });

    return { requestNo: updated.requestNo, outcome };
  }
}
