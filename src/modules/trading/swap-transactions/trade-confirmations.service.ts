import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { SwapTransactionStatus } from './dto/swap-transaction.dto';
import { SwapTransactionsService } from './swap-transactions.service';

/**
 * 战役丙波二 T3：成交确认单出具。
 *
 * 挂在 SwapWorkflowService.notifySwapStatusChange（漏斗共 8 个调用点；第 9 个 SWAP 发信点
 * swap-sla.service.ts 直调 notifyOrderStatusChange、不经漏斗，只产 REJECTED、不涉出具）里，
 * 不进任何 `$transaction`——横切写服务不得在事务内调用（SQLite 单写者自锁判例），
 * 与通知同一边界：事务提交之后才出具。
 */
@Injectable()
export class TradeConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly swapTransactionsService: SwapTransactionsService,
  ) {}

  /**
   * SUCCESS 后置出具：一单一张（swapNo @unique 是结构保证，不做防重逻辑）。整体吞错——
   * demo 尽力而为，不阻断已提交的成交，镜像 NotificationsService 的边界。
   * 次序：先落确认单 → 再记审计 → 返回后漏斗才发通知（持久物先于信号）。
   */
  async issueForSwapIfSuccess(swapNo: string, toStatus: string): Promise<void> {
    if (toStatus !== SwapTransactionStatus.SUCCESS) return;
    try {
      const swap = await this.prisma.swapTransaction.findUnique({ where: { swapNo }, include: { quote: true } });
      if (!swap?.ownerNo) return;
      const facts = this.swapTransactionsService.toCustomerPricingFacts(swap.feeBreakdown);
      const created = await this.prisma.tradeConfirmation.create({
        data: {
          confirmationNo: generateReferenceNo('CNF'),
          swapNo,
          quoteNo: swap.quoteNo,
          ownerCustomerNo: swap.ownerNo,
          fromAmount: swap.fromAmount,
          // swap_transactions.fromAssetCode 列可空（建单恒由报价写入），确认单列非空——`?? ''` 仅满足类型。
          fromAssetCode: swap.fromAssetCode ?? '',
          toAmount: swap.toAmount,
          // 同 fromAssetCode：swap 表列可空（建单恒由报价写入），确认单列非空——`?? ''` 仅满足类型。
          toAssetCode: swap.toAssetCode ?? '',
          netToAmount: swap.netToAmount,
          feeAmount: swap.feeAmount,
          feeCurrency: swap.feeCurrency,
          feeLines: JSON.stringify(facts.feeLines),
          exchangeRate: swap.exchangeRate,
          marketRate: swap.quote?.marketRate ?? null,
          rateSource: swap.quote?.rateSource ?? null,
          fetchedAt: swap.quote?.fetchedAt ?? null,
          spreadPercent: swap.quote?.spreadPercent ?? null,
          spreadAmount: swap.spreadAmount,
          tradedAt: swap.createdAt,
          settledAt: swap.completedAt,
        },
      });
      await this.auditLogsService.recordSystem({
        action: AuditActions.CONFIRMATION_ISSUED,
        actionDomain: 'SWAP',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION,
        primarySubjectNo: swapNo,
        ownerCustomerNo: swap.ownerNo,
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: swapNo, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: swap.ownerNo, subjectRole: AuditSubjectRole.OWNER },
        ],
        reason: `Trade confirmation ${created.confirmationNo} issued for ${swapNo}`,
        // requiredFields=['confirmationNo']（CONFIRMATION_ISSUED 词表声明）——assertActionSpec 只查
        // input 顶层，故顶层展开；metadata 另镜像一份供查询（照 NOTIFICATION_SENT 先例）。
        confirmationNo: created.confirmationNo,
        metadata: { confirmationNo: created.confirmationNo, swapNo },
        requestId: created.id,
        sourcePlatform: 'SYSTEM',
      } as any);
    } catch (err) {
      console.error(`[trade-confirmation] issue failed for ${swapNo}`, err);
    }
  }
}
