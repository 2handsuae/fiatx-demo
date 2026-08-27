// 平账·推单编排（spec §1/§2）：同步/人工两腿，同一条推进路径，差别只在证据提供者。
// 铁律：不直写 TB/账本——只循环调 FundsOrderService.advance，由状态机事件链记账（Task 2 穿透）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../../audit-logging/constants/audit-actions.constant';
import { FundsOrderService } from '../../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../../funds-orders/dto/funds-order.dto';
import { ReceiptLookupService, PushableOrderView } from './receipt-lookup.service';

// A3(2026-08-13):推单只把资金单推到 CONFIRMED 就停手，**不再自己 CLEAR**。
// 原因:CLEAR 是 workflow 记完账之后的产物,不是一个可以外部驱动的推进动作。推单一口气
// 推到 CLEARED,会让 onFeeLegConfirmed 的防重入判据(「状态不是 CONFIRMED = 别人已经结算
// 过了」)误判——推单制造的恰恰是第三种情况:状态变了但根本没人结算过 → 整段结算被跳过。
// 后果:手续费永久锁在客户账上、提现永停 PAYOUT_PENDING,而单据显示"已结清"。
// 单次点击确定性复现(demo:in-transit 跑完就是现成状态),不需要并发。
// 佐证:正常演示脚本 demo-lib.ts 只发广播/确认、从不发 CLEAR,还特意 sleep 把结清让给 workflow。
const HAPPY_ACTIONS = [
  FundsOrderAction.SUBMIT,
  FundsOrderAction.OBSERVE_CONFIRMING,
  FundsOrderAction.CONFIRM,
];
const MAX_STEPS = 5; // 状态机最长合法链路兜底(CREATED→SUBMITTED→CONFIRMING→CONFIRMED)，防死循环
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
    private readonly prisma: PrismaService,
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
      action: 'RECON_PUSH_ORDER',
      reason: `Push-order sync: ${fromStatus} → ${final.status} (effectiveDate=${receipt.effectiveDate})`,
      fromStatus,
      toStatus: final.status,
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
      action: 'RECON_PUSH_ORDER',
      reason: `Push-order manual: ${fromStatus} → ${final.status} (effectiveDate=${evidence.externalDate})`,
      fromStatus,
      toStatus: final.status,
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

  /**
   * 沿状态机既有合法迁移逐步推到 CLEARED；每步透传回填生效日，不跳步不造新迁移。
   *
   * 并发容忍：deposit/withdraw 的 @OnEvent handler（onPayinConfirmed / onLegCleared 等）也会自驱
   * CONFIRMED→CLEARED。本循环与其抢同一张单——handler 可能已经/正在把它推进甚至推到 CLEARED。
   * 故：(a) 每轮先 findById 看真实态，已 CLEARED 即判成功收尾（并发 handler 已完成）；落到其它终态
   * （FAILED/TIMEOUT）则推进出意外，抛错。(b) advance 撞"非法迁移"或"already terminal (CLEARED)"
   * （funds-order.service.ts:91 抛小写 "invalid transition"）都 continue，下一轮 findById 会正常判成功。
   * 铁律不变：只调 advance，不直写账本。
   */
  private async driveToCleared(order: any, operatorId: string, effectiveDate: string) {
    let current = order;
    // A3(2026-08-13):推单的目标态由 CLEARED 改为 CONFIRMED。CLEARED 仍算成功
    // (并发的 workflow 结算可能已抢先把它推到 CLEARED,那正是我们想要的结果)。
    const reachedGoal = (s: string) =>
      s === FundsOrderStatus.CONFIRMED || s === FundsOrderStatus.CLEARED;
    for (let i = 0; i < MAX_STEPS && !reachedGoal(current.status); i++) {
      // (1) 先看真实态：并发 handler 可能已把它推到 CLEARED（成功）或其它终态（意外）。
      const fresh = await this.fundsOrders.findById(current.id);
      if (fresh?.status === FundsOrderStatus.CLEARED) {
        current = fresh;
        break;
      }
      if (fresh && TERMINAL.has(fresh.status)) {
        throw new BadRequestException(
          `FundsOrder ${order.fundsOrderNo} 推进出意外：并发已落终态 ${fresh.status}（非 CLEARED）`,
        );
      }
      if (fresh) current = fresh;

      let advanced: any = null;
      for (const action of HAPPY_ACTIONS) {
        try {
          advanced = await this.fundsOrders.advance(current.id, action, operatorId, undefined, {
            effectiveDate,
          });
          break;
        } catch (e) {
          // (2) 大小写不敏感：既覆盖 "Invalid transition: …"（该 action 对当前态非法，试下一个），
          // 也覆盖 "already terminal (CLEARED) — invalid transition"（并发 handler 已抢先推到终态）。
          // 后者下一轮开头的 findById 会发现已 CLEARED 而正常 break。其余错误（NotFound 等）原样冒出。
          if (e instanceof BadRequestException && /invalid transition/i.test(e.message)) continue;
          throw e;
        }
      }
      if (!advanced) {
        // (3) 抛"无合法推进动作"前再确认一次：并发 handler 可能刚把它推到 CLEARED（loser 分支防误报）。
        const recheck = await this.fundsOrders.findById(current.id);
        if (recheck?.status === FundsOrderStatus.CLEARED) {
          current = recheck;
          break;
        }
        throw new BadRequestException(`FundsOrder ${order.fundsOrderNo} 在 ${current.status} 无合法推进动作`);
      }
      current = advanced;
    }
    // (4) 收尾闸门:A3 起接受 CONFIRMED(推单的终点)或 CLEARED(workflow 已抢先结清)。
    if (!reachedGoal(current.status)) {
      throw new BadRequestException(`推进未达目标态（止于 ${current.status}，期望 CONFIRMED）`);
    }
    // A3:循环在 CONFIRMED 就停手,但并发的 workflow 结算可能已经把这一行推到 CLEARED。
    // 收尾重读一次,让上报的 finalStatus 反映真实行状态,而不是循环里的中间值。
    const settled = await this.fundsOrders.findById(current.id);
    return settled ?? current;
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
  /**
   * 站5-β：推单落在父单（充值/提现）的旅程里——INHERIT 父单 correlationId，
   * OWNER=父单客户、RELATED=父业务单号；主对象类型随表更名换 FUNDS_ORDER。
   * swap 腿被 loadPushable 挡在门外，父单只有充值/提现两种。
   */
  private async resolveParent(order: any): Promise<{ correlationId?: string; parentNo?: string; parentType?: string; customerNo?: string }> {
    if (order.depositTransactionId) {
      const dep = await this.prisma.depositTransaction.findUnique({
        where: { id: order.depositTransactionId },
        select: { depositNo: true, correlationId: true, customer: { select: { customerNo: true } } },
      });
      if (dep) return { correlationId: dep.correlationId ?? undefined, parentNo: dep.depositNo, parentType: AuditEntityTypes.DEPOSIT_TRANSACTION, customerNo: dep.customer?.customerNo };
    }
    if (order.withdrawTransactionId) {
      const wd = await this.prisma.withdrawTransaction.findUnique({
        where: { id: order.withdrawTransactionId },
        select: { withdrawNo: true, correlationId: true, ownerNo: true },
      });
      if (wd) return { correlationId: wd.correlationId ?? undefined, parentNo: wd.withdrawNo, parentType: AuditEntityTypes.WITHDRAW_TRANSACTION, customerNo: wd.ownerNo ?? undefined };
    }
    return {};
  }

  private async recordPush(
    order: any,
    operatorId: string,
    entry: { action: string; reason: string; fromStatus: string; toStatus: string; metadata: Record<string, unknown> },
  ) {
    const parent = await this.resolveParent(order);
    const subjects: any[] = [
      { subjectType: 'FUNDS_ORDER', subjectNo: order.fundsOrderNo, subjectRole: 'PRIMARY' },
    ];
    if (parent.customerNo) subjects.push({ subjectType: 'CUSTOMER', subjectNo: parent.customerNo, subjectRole: 'OWNER' });
    if (parent.parentNo) subjects.push({ subjectType: parent.parentType, subjectNo: parent.parentNo, subjectRole: 'RELATED' });
    await this.auditLogs.recordByActor(
      {
        action: entry.action,
        actionDomain: 'RECON',
        primarySubjectType: 'FUNDS_ORDER',
        primarySubjectNo: order.fundsOrderNo,
        ownerCustomerNo: parent.customerNo,
        correlationId: parent.correlationId,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        subjects,
        reason: entry.reason,
        requestId: `RECON_PUSH_ORDER_${order.fundsOrderNo}_${randomUUID()}`,
        metadata: entry.metadata,
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: operatorId, actorDisplayName: operatorId, actorRolesAtTime: ['ADMIN'] },
    );
  }
}
