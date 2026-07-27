import { Injectable, Logger } from '@nestjs/common';

/**
 * 桩:处理 applicantAction{Reviewed,Pending} 事件。
 * Task 9 填充:action 相关的充值单状态推进。
 */
@Injectable()
export class DepositActionHandler {
  private readonly logger = new Logger(DepositActionHandler.name);

  async handle(payload: Record<string, unknown>): Promise<void> {
    this.logger.debug(`DepositActionHandler stub received: ${JSON.stringify(payload)}`);
    // Task 9 实现
  }
}
