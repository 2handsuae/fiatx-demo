import { Injectable, Logger } from '@nestjs/common';

/**
 * 桩:处理 applicantKytTxn{Approved,Rejected,AwaitingUser,OnHold,Reviewed} 的裁决落地。
 * Task 6 填充:按 kytTxnId 找到充值单,推进状态机。
 */
@Injectable()
export class DepositKytVerdictHandler {
  private readonly logger = new Logger(DepositKytVerdictHandler.name);

  async handle(payload: Record<string, unknown>): Promise<void> {
    this.logger.debug(`DepositKytVerdictHandler stub received: ${JSON.stringify(payload)}`);
    // Task 6 实现
  }
}
