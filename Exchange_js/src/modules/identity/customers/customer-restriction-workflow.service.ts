import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CustomerRestrictionsService, OpenRestrictionInput } from './customer-restrictions.service';
import { RestrictionCause } from './constants/restriction-cause.constant';

/**
 * 限制账的编排层。
 *
 * 本轮分两批落地：
 *  - Task 4（本步骤）：自动侧 —— openRestriction / autoRelease。四个自动冻结点、
 *    兑换 KYT 拒绝、admin 手工贴便签都走 openRestriction；材料补齐、Sumsub 复核判绿、
 *    升级审批通过走 autoRelease。这条路【不走审批】（设计稿 §3.3 规矩 R3：自动撕不审批）。
 *  - Task 10：审批侧 —— initiateRelease / onReleaseDecided。人工撕一律走审批。
 *
 * Rule 5：workflow 不得直写 domain 表，所有落库都经 CustomerRestrictionsService。
 */
@Injectable()
export class CustomerRestrictionWorkflowService {
  private readonly logger = new Logger(CustomerRestrictionWorkflowService.name);

  constructor(private readonly restrictionsService: CustomerRestrictionsService) {}

  /** 贴便签。立即生效，不开审批（设计稿 §3.3 规矩 R4：摁住不审批，放行才审批）。 */
  async openRestriction(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }> {
    return this.restrictionsService.open(input);
  }

  /**
   * 自动撕。按 (customerId, cause, caseRef) 精确定位那一张便签再撕
   * —— 绝不"无条件清空"，这正是旧的单列 complianceStatus 模型出事的地方：
   * 材料补齐时无条件写 complianceStatus:'CLEAR'，把同一个客户身上的制裁冻结一起抹掉。
   * 找不到对应 OPEN 便签时是 no-op（幂等，webhook 可能重投）。
   */
  async autoRelease(
    customerId: string,
    cause: RestrictionCause,
    caseRef: string | null,
    actorId: string,
  ): Promise<void> {
    const row = await this.restrictionsService.findOpenByCause(customerId, cause, caseRef);
    if (!row) {
      this.logger.debug(
        `autoRelease no-op: customer=${customerId} cause=${cause} caseRef=${caseRef ?? 'null'} — no OPEN restriction`,
      );
      return;
    }
    await this.restrictionsService.release(row.restrictionNo, {
      releasedBy: actorId,
      releaseMode: 'AUTO',
    });
  }
}
