// 平账·推单编排（spec §1/§2）：同步/人工两腿，同一条推进路径，差别只在证据提供者。
// 铁律：不直写 TB/账本——只循环调 FundsOrderService.advance，由状态机事件链记账（Task 2 穿透）。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../../audit-logging/constants/audit-actions.constant';
import { FundsOrderService } from '../../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../../funds-orders/dto/funds-order.dto';
import { ReceiptLookupService, PushableOrderView } from './receipt-lookup.service';

const HAPPY_ACTIONS = [
  FundsOrderAction.SUBMIT,
  FundsOrderAction.OBSERVE_CONFIRMING,
  FundsOrderAction.CONFIRM,
  FundsOrderAction.CLEAR,
];
const MAX_STEPS = 6; // 状态机最长合法链路兜底，防死循环
const TERMINAL = new Set<string>([
  FundsOrderStatus.CLEARED,
  FundsOrderStatus.FAILED,
  FundsOrderStatus.TIMEOUT,
]);

export interface ManualPushEvidence {
  receiptRef: string;
  externalDate: string;
  reason: string;
}

@Injectable()
export class PushOrderService {
  constructor(
    private readonly fundsOrders: FundsOrderService,
    private readonly receiptLookup: ReceiptLookupService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async syncPush(fundsOrderNo: string, operatorId: string) {
    const order = await this.loadPushable(fundsOrderNo);
    const receipt = await this.receiptLookup.findUniqueReceipt(this.toView(order));
    if (receipt.kind === 'MISS') {
      throw new BadRequestException(
        `未找到唯一回执（${receipt.candidates} 条候选）——请核实外部对账单摄入情况，或走人工确认`,
      );
    }
    const fromStatus = order.status;
    const final = await this.driveToCleared(order, operatorId, receipt.effectiveDate);
    await this.recordPush(order, operatorId, {
      action: AuditActions.RECON_PUSH_ORDER_SYNCED,
      reason: `Push-order sync: ${fromStatus} → ${final.status} (effectiveDate=${receipt.effectiveDate})`,
      metadata: {
        matchedLineId: receipt.lineId,
        effectiveDate: receipt.effectiveDate,
        fromStatus,
        toStatus: final.status,
        manualConfirm: false,
      },
    });
    return { finalStatus: final.status, effectiveDate: receipt.effectiveDate, matchedLineId: receipt.lineId };
  }

  async manualPush(fundsOrderNo: string, operatorId: string, evidence: ManualPushEvidence) {
    const order = await this.loadPushable(fundsOrderNo);
    this.assertValidExternalDate(evidence.externalDate, order.createdAt);
    if (!evidence.receiptRef?.trim() || !evidence.reason?.trim()) {
      throw new BadRequestException('人工确认必填证据三件套：回执号 + 外部实际动账日 + 原因');
    }
    const fromStatus = order.status;
    const final = await this.driveToCleared(order, operatorId, evidence.externalDate);
    await this.recordPush(order, operatorId, {
      action: AuditActions.RECON_PUSH_ORDER_MANUAL,
      reason: `Push-order manual: ${fromStatus} → ${final.status} (effectiveDate=${evidence.externalDate})`,
      metadata: {
        manualConfirm: true,
        receiptRef: evidence.receiptRef,
        externalDate: evidence.externalDate,
        reason: evidence.reason,
        effectiveDate: evidence.externalDate,
        fromStatus,
        toStatus: final.status,
      },
    });
    return { finalStatus: final.status, effectiveDate: evidence.externalDate };
  }

  private async loadPushable(fundsOrderNo: string) {
    const order = await this.fundsOrders.findByNo(fundsOrderNo);
    if (!order) throw new NotFoundException(`FundsOrder ${fundsOrderNo} not found`);
    if (order.swapTransactionId) {
      throw new BadRequestException(
        'swap 腿资金单请走 Swap 详情页逐腿推进（顺序守卫），本期不支持推单',
      );
    }
    if (TERMINAL.has(order.status)) {
      throw new BadRequestException(`FundsOrder ${fundsOrderNo} 已是终态（${order.status}），无可推进`);
    }
    return order;
  }

  /**
   * 真实资金单行 → 归一化回执视图。direction 由 deposit/withdraw FK 派生（swap 已在
   * loadPushable 拒绝）；IN 用贷记钱包 toWalletId、OUT 用借记钱包 fromWalletId
   * （与 findNonTerminalByWallet 的方向约定一致）；externalRefs 取三字段
   * [txHash, referenceNo, providerTxnId].filter(Boolean)，与对账 matcher refsOf 同源。
   */
  private toView(order: any): PushableOrderView {
    const direction: 'IN' | 'OUT' = order.withdrawTransactionId ? 'OUT' : 'IN';
    const walletId = direction === 'OUT' ? order.fromWalletId : order.toWalletId;
    return {
      fundsOrderNo: order.fundsOrderNo,
      walletId,
      direction,
      amount: order.amount,
      // 与对账 matcher wallet-flow-matcher.service.ts refsOf 同源：链上回执是 txHash，法币是自有号。
      externalRefs: [order.txHash, order.referenceNo, order.providerTxnId].filter(Boolean) as string[],
      createdAt: order.createdAt,
    };
  }

  /** 沿状态机既有合法迁移逐步推到 CLEARED；每步透传回填生效日，不跳步不造新迁移。 */
  private async driveToCleared(order: any, operatorId: string, effectiveDate: string) {
    let current = order;
    for (let i = 0; i < MAX_STEPS && current.status !== FundsOrderStatus.CLEARED; i++) {
      let advanced: any = null;
      for (const action of HAPPY_ACTIONS) {
        try {
          advanced = await this.fundsOrders.advance(current.id, action, operatorId, undefined, {
            effectiveDate,
          });
          break;
        } catch (e) {
          // 只对"非法迁移"试下一个动作；NotFound（行被删）/已终态/其它意外必须原样冒出，
          // 不许被伪装成"无合法推进动作"。advance() 非法迁移抛 BadRequest("Invalid transition: …")。
          if (e instanceof BadRequestException && /Invalid transition/.test(e.message)) continue;
          throw e;
        }
      }
      if (!advanced) {
        throw new BadRequestException(`FundsOrder ${order.fundsOrderNo} 在 ${current.status} 无合法推进动作`);
      }
      current = advanced;
    }
    if (current.status !== FundsOrderStatus.CLEARED) {
      throw new BadRequestException(`推进未达终态（止于 ${current.status}）`);
    }
    return current;
  }

  private assertValidExternalDate(d: string, orderCreatedAt: Date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('外部动账日格式须为 YYYY-MM-DD');
    const today = new Date().toISOString().slice(0, 10);
    if (d > today) throw new BadRequestException('外部动账日不能是未来');
    if (d < orderCreatedAt.toISOString().slice(0, 10)) {
      throw new BadRequestException('外部动账日不能早于单子创建日');
    }
  }

  /** 审计写入：ADMIN 触发的推单，走 recordByActor（字典常量，禁裸串）。 */
  private async recordPush(
    order: any,
    operatorId: string,
    entry: { action: string; reason: string; metadata: Record<string, unknown> },
  ) {
    await this.auditLogs.recordByActor(
      {
        action: entry.action,
        entityType: AuditEntityTypes.INTERNAL_FUND,
        entityId: order.id,
        entityNo: order.fundsOrderNo,
        workflowType: AuditWorkflowTypes.SETTLEMENT,
        reason: entry.reason,
        metadata: entry.metadata,
        sourcePlatform: 'ADMIN',
      },
      { actorType: 'ADMIN', actorId: operatorId, actorNo: operatorId, actorRole: 'ADMIN' },
    );
  }
}
