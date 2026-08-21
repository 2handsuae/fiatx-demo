import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { SwapTransactionAction } from '../trading/swap-transactions/dto/swap-transaction.dto';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';

/**
 * 兑换合规超时看门狗（Task 8）—— mirror of DepositSlaService / WithdrawSlaService
 * 的角色（同一类"别让单子等成死单"watchdog），但不是同一份代码的复制：充值/
 * 提现的 SLA 计的是"客户/官员该做动作而没做"，有明确的等待对象；兑换的
 * COMPLIANCE_PENDING 纯粹是异步等 Sumsub webhook，没有"等谁"的分岔，只有两种
 * 卡住的形态，处理方式截然相反：
 *
 *   - sumsubTxnIdOut 有值，verdict 迟迟不来 → 判超时。fail-closed：
 *     markStatus(SLA_BREACH) 打 REJECTED + rejectReason=TIMEOUT。兑换拒绝的
 *     成本极低（零记账、没有要冲正的东西，客户重新报价即可），没有理由为了
 *     等一个可能永远不来的 verdict，冒着放行未过筛单子的风险。
 *   - sumsubTxnIdOut 为空 → 根本没提交成功（Task 4 的 submitSumsubTxnOut 故意
 *     把提交失败做成非致命，不能让客户因为 Sumsub 当时抖了一下就吃 500）。这不
 *     是超时，是漏提交：quote 已经消费、单子已经建好，直接判死是白白浪费一笔
 *     本可恢复的单子。重试提交（submitSumsubTxnOut 本身幂等 + 不抛错），不碰
 *     markStatus。
 *
 * 结论（未在其余两个 SLA watchdog 出现过的分岔点）：超时判死之后**不**触发
 * handleRejectDisposition（customerRestrictionsService 限制 SWAP/WITHDRAW +
 * pendingAction 补料入口）。那一套是"这个人有嫌疑"的处置——只有 Sumsub 真正
 * 给出 rejected verdict（带 typedTags/applicantActions 证据）时才成立。超时
 * 只说明 Sumsub 没能在窗口内回话，跟这个人是否可疑毫无关系；套用 KYT 拒绝那
 * 套限制，等于把平台自己响应慢的锅，错记到客户账上（客户被限 SWAP/WITHDRAW，
 * 但自己什么都没做错）。这也是本 service 不注入
 * CustomerRestrictionsService/CustomersService（硬线标记）的原因——架构上
 * 就不给它触发 disposition 的能力。
 */
@Injectable()
export class SwapSlaService {
  private readonly logger = new Logger(SwapSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly swapService: SwapTransactionsService,
    private readonly workflow: SwapWorkflowService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  @Cron('*/30 * * * * *')
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * 核心扫描逻辑，与 @Cron 包装分开，测试里直接调用不必等真实时钟。
   * 单笔候选单处理失败（含 markStatus 与 webhook 并发撞车时抛出的 Invalid
   * transition ——对方已经把单子推进终态，是正常的竞态吸收，不是故障）都不
   * 能拖垮整个 sweep：逐笔 try/catch，记录后继续下一单。
   */
  async sweep(): Promise<{ timedOut: number; resubmitted: number }> {
    // 2026-08-21：从「建单至今 > 超时」改成「进入状态时算好的 slaDeadline 已过」。
    // 前者算的是这单活了多久，后者才是「在这个状态待了多久」——业主口径。
    // 今天 COMPLIANCE_PENDING 是出生态、两者等价，但多一条进该状态的路就会分道。
    const stale = await this.swapService.findSlaBreachCandidates(new Date());

    let timedOut = 0;
    let resubmitted = 0;
    for (const swap of stale) {
      try {
        if (!swap.sumsubTxnIdOut) {
          // 单已存在、quote 已消费，但从未真正提交给 Sumsub —— 重试提交，
          // 别浪费这笔本可恢复的单子。
          await this.workflow.submitSumsubTxnOut(swap.id);
          resubmitted += 1;
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          await this.swapService.markStatus(
            swap.id,
            SwapTransactionAction.SLA_BREACH,
            tx,
            { rejectReason: 'TIMEOUT' },
          );
          // 防重复扫：不需要在这里额外置 slaBreached=true。markStatus 已把状态推
          // 到 REJECTED，而 REJECTED 不在 SWAP_SLA_MINUTES_BY_STATUS 配置表里 →
          // resolveSlaFields 收口处会把 slaDeadline 置 null，天然不再匹配
          // findSlaBreachCandidates 的 `slaDeadline: { lt: now }` 条件。
          // markStatus 本身不写审计（本文件其余审计调用同款约定：调用方负责）。
          // 与状态迁移落在同一事务内，保持"状态变了就一定有审计"的原子性。
          await this.auditLogsService.recordSystem(
            {
              action: AuditActions.SWAP_SLA_BREACHED,
              entityType: AuditEntityTypes.SWAP_TRANSACTION,
              entityId: swap.id,
              entityNo: swap.swapNo || undefined,
              traceId: swap.traceId || undefined,
              workflowType: AuditWorkflowTypes.SWAP,
              entityOwnerType: swap.ownerType,
              entityOwnerId: swap.ownerId,
              reason:
                'Swap compliance SLA breached — no Sumsub verdict before timeout, order rejected (fail-closed; no customer disposition, see class comment)',
              metadata: { sumsubTxnIdOut: swap.sumsubTxnIdOut, createdAt: swap.createdAt },
              sourcePlatform: 'SYSTEM',
            },
            tx,
          );
        });
        timedOut += 1;
      } catch (err) {
        this.logger.error(
          `swap SLA sweep failed for swap ${swap.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (timedOut || resubmitted) {
      this.logger.log(`swap SLA sweep: timedOut=${timedOut} resubmitted=${resubmitted}`);
    }
    return { timedOut, resubmitted };
  }
}
