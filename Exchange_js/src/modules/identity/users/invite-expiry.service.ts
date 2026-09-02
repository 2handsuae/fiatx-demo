import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';

/**
 * 邀请过期清扫（2026-09-01 治愈计划 · 底座）。
 * sweepExpiredInvites() 自建成起完整——状态迁移、审计（ADMIN_INVITE_EXPIRED，
 * 唯一写入点）——唯独没人定时叫它，审计码因此从建成起零写入。邀请过期不进
 * 演示剧本，接 @Cron 只为让这条审计码语义成立（活代码而非死码），扫描周期
 * 放宽到每小时一次。
 */
@Injectable()
export class InviteExpiryService {
  private readonly logger = new Logger(InviteExpiryService.name);
  constructor(private readonly adminInviteWorkflowService: AdminInviteWorkflowService) {}

  @Cron('0 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  // 与 @Cron 包装分开，测试直接调、不等真实时钟。
  async sweep(): Promise<void> {
    try {
      const { expiredCount } = await this.adminInviteWorkflowService.sweepExpiredInvites();
      if (expiredCount > 0) this.logger.log(`invite expiry sweep: ${expiredCount} invitation(s) expired`);
    } catch (err) {
      this.logger.error(`invite expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
