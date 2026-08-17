import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { MaterialRequestsService, type MaterialActor } from './material-requests.service';
import { DEPOSIT_TERMINAL_STATUSES } from '../../trading/deposit-transactions/deposit-transactions.service';
import { WITHDRAW_TERMINAL_STATUSES } from '../../trading/withdraw-transactions/withdraw-transactions.service';
import { SWAP_TERMINAL_STATUSES } from '../../trading/swap-transactions/swap-transactions.service';
import type { MaterialRequestOrderDomain } from './constants/material-request.constant';

const SYSTEM_ACTOR: MaterialActor = {
  actorType: 'SYSTEM',
  actorId: 'SYSTEM',
  actorNo: 'SYSTEM',
  actorRole: 'SYSTEM',
};

/**
 * 订单进终态 → 处置该单上还活着的材料请求（设计稿 §5.1）。
 *
 * 分两种，差别在挂没挂限制：
 *  - 没挂 → 作废。它本来就只在订单页露（客户级横幅只兜「挂了限制的」∪「没绑单的」），
 *    单死了它就再没有任何入口，留着就是孤儿。
 *  - 挂了 → **不作废**，只解绑订单。充值退回了，但「这个人还欠一张资金来源证明」
 *    这件事没跟着消失 —— 从订单页撤下，在客户级横幅上留着。这是本设计的价值点。
 */
@Injectable()
export class MaterialRequestOrderCancelListener {
  private readonly logger = new Logger(MaterialRequestOrderCancelListener.name);

  constructor(private readonly requests: MaterialRequestsService) {}

  @OnEvent(DomainEventNames.DEPOSIT_STATUS_CHANGED, { async: true })
  async onDepositStatusChanged(event: { depositNo?: string; status?: string }): Promise<void> {
    if (!event?.depositNo || !DEPOSIT_TERMINAL_STATUSES.has(String(event.status))) return;
    await this.settle('DEPOSIT', event.depositNo, String(event.status));
  }

  @OnEvent(DomainEventNames.WITHDRAWAL_STATUS_CHANGED, { async: true })
  async onWithdrawStatusChanged(event: { withdrawNo?: string; status?: string }): Promise<void> {
    if (!event?.withdrawNo || !WITHDRAW_TERMINAL_STATUSES.has(String(event.status))) return;
    await this.settle('WITHDRAW', event.withdrawNo, String(event.status));
  }

  @OnEvent(DomainEventNames.SWAP_STATUS_CHANGED, { async: true })
  async onSwapStatusChanged(event: { swapNo?: string; status?: string }): Promise<void> {
    if (!event?.swapNo || !SWAP_TERMINAL_STATUSES.has(String(event.status))) return;
    await this.settle('SWAP', event.swapNo, String(event.status));
  }

  private async settle(
    orderDomain: MaterialRequestOrderDomain,
    orderRef: string,
    terminalStatus: string,
  ): Promise<void> {
    const live = await this.requests.listLiveByOrder(orderDomain, orderRef);
    for (const row of live) {
      try {
        if (row.restrictionNo) {
          await this.requests.unbindOrder(row.requestNo, SYSTEM_ACTOR);
        } else {
          await this.requests.cancel(row.requestNo, 'ORDER_TERMINAL', SYSTEM_ACTOR);
        }
      } catch (e) {
        // 逐项兜住：一行处置失败不该让同单其余行也留在半吊子状态
        this.logger.warn(
          `Failed to settle material request ${row.requestNo} after ${orderDomain}/${orderRef} reached ${terminalStatus}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
}
