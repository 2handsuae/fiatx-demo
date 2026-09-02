import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApprovalsService } from './approvals.service';

/**
 * 审批超时扫描（2026-09-01 治愈计划 · 底座）。
 * expirePendingApprovals()/expirePendingApprovalCase() 自建成起完整——状态机、
 * 审计（APPROVAL_EXPIRED，sourcePlatform 就写着 'CRON'）、EXPIRED 事件——唯独
 * 没人定时叫它：42 条策略的 timeoutHours 一直是纯展示。这不是禁做清单里的
 * 重试/回放，是业务规则本身：单子会过期。扫描周期每分钟一次，与三域 SLA 一致。
 */
@Injectable()
export class ApprovalExpiryService {
  private readonly logger = new Logger(ApprovalExpiryService.name);
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  // 与 @Cron 包装分开，测试直接调、不等真实时钟。
  async sweep(): Promise<void> {
    try {
      const { expiredCount } = await this.approvalsService.expirePendingApprovals();
      if (expiredCount > 0) this.logger.log(`approval expiry sweep: ${expiredCount} case(s) expired`);
    } catch (err) {
      this.logger.error(`approval expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
