// 「这条差异已经被哪张调账单 / 认损补缺单解释了」——对账引擎与案件页共用的同一份锚点清单。
//
// 为什么需要它（2026-08-29 业主走查逮到的第四条）：
//   调账单只改余额。差额被补平之后，**造成差额的那条流水本身还在**——
//   桶分类（bucket-classifier.ts）的规则是「残差=0 且 无在途 且 流水异常>0
//   → COMPENSATING」，COMPENSATING 不是 MATCHED，钱包仍在破口集合里，案子于是
//   永远不会自愈。平账做完了，案子关不掉。
//
//   业主裁定「甲」：调账单落账时把它解释的那条差异标掉。
//
// 戊波二 T9b（spec §0 裁定 8）：旧做法是「引擎算异常数时按解释索引跳过」+「调账行按 sourceType 整体排除出匹配」。
//   认损补缺单的记短缺分录 sourceType 是 INTERNAL_TRANSFER，整体排除罩不住它；索引式跳过又只是把异常数抹掉，
//   并不证明「这条差异真的被解释干净了」。改为显式锚配对：本服务供出「落在本钱包现金户上的那条解释流水 + 它记着的两个锚
//   + 单号」，匹配器第 0 轮（wallet-flow-matcher.service.ts）按锚把它们配成一对或一组，配上了才算解释。
//
// 锚点为什么是流水 id / 对账单行 id，不是差异行 id：
//   ReconciliationLineItem 是每轮对账 delete-then-insert 重建的
//   （wallet-recon-run.service.ts writeLineItems 上方的注释写明了这个策略），
//   锚在它的 id 上，下一轮就悬空。account_flows.id 与
//   external_statement_lines.id 是真实证据，跨轮稳定。
//
// 只认已落账的：调账单 POSTED；认损补缺单 recognizedTbTransferId 已落（码 91 已记）。
// 草稿和待审的还没动账，差异当然还没被解释。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import type { ExplainedAnchor } from '../engine/v2/wallet-flow-matcher.service';
import { RECON_ADJUSTMENT_SOURCE_TYPE } from './adjustment-rules';

/** 认损补缺单记短缺（码 91）那条流水的取数口径——与 internal-transfer-workflow.service recognizeShortfall 写入的 evidence 一致。 */
const SHORTFALL_RECOGNIZED_SOURCE_TYPE = 'INTERNAL_TRANSFER';
const SHORTFALL_RECOGNIZED_EVENT_CODE = 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED';

@Injectable()
export class ExplainedDifferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 该钱包现金户上所有「已落账解释」的锚点清单（喂匹配器第 0 轮）。
   *
   * 来源两路：
   *   (a) 该钱包 POSTED 调账单落在这个现金户上的流水。
   *       两个 walletRef 都要认（T6）：改记单（第四族）挂在**错记方**名下（walletRef = 错记方钱包），
   *       锚的却是**正主方**的外部对账单行——按单一 walletRef 圈定时，跑到正主方那个钱包的这一轮查不到这张单，
   *       正主方那条「外有我无」永远配不上，双案同愈就断掉一半。每个钱包只会取到落在**自己**现金户上的那一条流水
   *       （改记的现金对：错记方现金户一条 OUT、正主方现金户一条 IN）。
   *   (b) 该钱包上已记短缺（recognizedTbTransferId 有值）的认损补缺单的码 91 流水。
   *
   * 两个锚都空的单不供：它的流水只进余额、不进匹配（spec 裁定 16）。
   */
  async indexForWallet(walletRef: string, cashTbAccountId: string | null): Promise<ExplainedAnchor[]> {
    if (!cashTbAccountId) return [];

    const adjustments = (await this.prisma.reconciliationAdjustment.findMany({
      where: { OR: [{ walletRef }, { toWalletRef: walletRef }], status: AdjustmentStatus.POSTED },
      select: { adjustmentNo: true, explainedFlowId: true, explainedExternalLineId: true },
    })) as Array<{
      adjustmentNo: string;
      explainedFlowId: string | null;
      explainedExternalLineId: string | null;
    }>;
    const transfers = (await this.prisma.internalTransfer.findMany({
      where: { toWalletId: walletRef, purpose: 'SHORTFALL_TOPUP', recognizedTbTransferId: { not: null } },
      select: { transferNo: true, explainedFlowId: true, explainedExternalLineId: true },
    })) as Array<{
      transferNo: string;
      explainedFlowId: string | null;
      explainedExternalLineId: string | null;
    }>;

    const sources = [
      ...adjustments.map((r) => ({ no: r.adjustmentNo, sourceType: RECON_ADJUSTMENT_SOURCE_TYPE, flowId: r.explainedFlowId, extId: r.explainedExternalLineId })),
      ...transfers.map((r) => ({ no: r.transferNo, sourceType: SHORTFALL_RECOGNIZED_SOURCE_TYPE, flowId: r.explainedFlowId, extId: r.explainedExternalLineId })),
    ].filter((r) => r.flowId || r.extId);
    if (sources.length === 0) return [];

    const landed = (await this.prisma.accountFlow.findMany({
      where: {
        tbAccountId: cashTbAccountId,
        transferType: 'POSTED',
        OR: [
          { sourceType: RECON_ADJUSTMENT_SOURCE_TYPE, sourceNo: { in: sources.filter((r) => r.sourceType === RECON_ADJUSTMENT_SOURCE_TYPE).map((r) => r.no) } },
          {
            sourceType: SHORTFALL_RECOGNIZED_SOURCE_TYPE,
            eventCode: SHORTFALL_RECOGNIZED_EVENT_CODE,
            sourceNo: { in: sources.filter((r) => r.sourceType === SHORTFALL_RECOGNIZED_SOURCE_TYPE).map((r) => r.no) },
          },
        ],
      },
      select: { id: true, sourceType: true, sourceNo: true },
    })) as Array<{ id: string; sourceType: string; sourceNo: string }>;

    const anchors: ExplainedAnchor[] = [];
    for (const flow of landed) {
      const src = sources.find((r) => r.no === flow.sourceNo && r.sourceType === flow.sourceType);
      if (!src) continue;
      anchors.push({
        flowId: flow.id,
        ...(src.flowId ? { anchorFlowId: src.flowId } : {}),
        ...(src.extId ? { anchorExternalLineId: src.extId } : {}),
        byNo: src.no,
      });
    }
    return anchors;
  }
}
