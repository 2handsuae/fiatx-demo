// 「这条差异已经被哪张调账单解释了」——对账引擎与案件页共用的同一份索引。
//
// 为什么需要它（2026-08-29 业主走查逮到的第四条）：
//   调账单只改余额。差额被补平之后，**造成差额的那条流水本身还在**——
//   桶分类（bucket-classifier.ts）的规则是「残差=0 且 无在途 且 流水异常>0
//   → SOFT_FLAG」，SOFT_FLAG 不是 MATCHED，钱包仍在破口集合里，案子于是
//   永远不会自愈。平账做完了，案子关不掉。
//
//   业主裁定「甲」：调账单落账时把它解释的那条差异标掉，引擎算异常数时跳过。
//
// 锚点为什么是流水 id / 对账单行 id，不是差异行 id：
//   ReconciliationLineItem 是每轮对账 delete-then-insert 重建的
//   （wallet-recon-run.service.ts writeLineItems 上方的注释写明了这个策略），
//   锚在它的 id 上，下一轮就悬空。account_flows.id 与
//   external_statement_lines.id 是真实证据，跨轮稳定。
//
// 只认 POSTED：草稿和待审的调账单还没动账，差异当然还没被解释。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';

export interface ExplainedIndex {
  /** account_flows.id → 解释它的调账单号 */
  byFlowId: Map<string, string>;
  /** external_statement_lines.id → 解释它的调账单号 */
  byExternalLineId: Map<string, string>;
}

export const EMPTY_EXPLAINED_INDEX: ExplainedIndex = {
  byFlowId: new Map(),
  byExternalLineId: new Map(),
};

/**
 * 一条差异（匹配器的 orphanInternal / orphanExternal / mismatch 任一）是否已被
 * 调账单解释；是则返回单号，否则 null。两个锚任一命中即算解释——
 * ORPHAN_INTERNAL 只有内部流水 id，ORPHAN_EXTERNAL 只有对账单行 id，
 * AMOUNT_MISMATCH 两个都有（开单时两个都会被记下来）。
 */
export function explainedBy(
  index: ExplainedIndex,
  anomaly: { internalFlowId?: string; externalLineId?: string },
): string | null {
  if (anomaly.internalFlowId) {
    const hit = index.byFlowId.get(anomaly.internalFlowId);
    if (hit) return hit;
  }
  if (anomaly.externalLineId) {
    const hit = index.byExternalLineId.get(anomaly.externalLineId);
    if (hit) return hit;
  }
  return null;
}

@Injectable()
export class ExplainedDifferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 该钱包上所有已落账调账单的解释锚点。
   *
   * 两个 walletRef 都要认（T6）：改记单（第四族）挂在**错记方**名下
   * （walletRef = 错记方钱包），锚的却是**正主方**的外部对账单行——按单一
   * walletRef 圈定时，跑到正主方那个钱包的这一轮查不到这张单，正主方那条
   * 「外有我无」永远算不上已解释，双案同愈就断掉一半。
   */
  async indexForWallet(walletRef: string): Promise<ExplainedIndex> {
    const rows = (await (this.prisma as any).reconciliationAdjustment.findMany({
      where: { OR: [{ walletRef }, { toWalletRef: walletRef }], status: AdjustmentStatus.POSTED },
      select: { adjustmentNo: true, explainedFlowId: true, explainedExternalLineId: true },
    })) as Array<{
      adjustmentNo: string;
      explainedFlowId: string | null;
      explainedExternalLineId: string | null;
    }>;

    const byFlowId = new Map<string, string>();
    const byExternalLineId = new Map<string, string>();
    for (const r of rows) {
      if (r.explainedFlowId) byFlowId.set(r.explainedFlowId, r.adjustmentNo);
      if (r.explainedExternalLineId) byExternalLineId.set(r.explainedExternalLineId, r.adjustmentNo);
    }
    return { byFlowId, byExternalLineId };
  }
}
