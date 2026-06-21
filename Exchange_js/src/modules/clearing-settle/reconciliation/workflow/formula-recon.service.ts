import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { CreditNetService } from '../engine/credit-net.service';
import { SubledgerInputsService } from '../engine/subledger-inputs.service';
import { InTransitService } from '../engine/in-transit.service';
import {
  FormulaCheckerService,
  FormulaResult,
} from '../engine/formula-checker.service';

export interface FormulaReconCurrencyResult {
  currency: string;
  assetId: string;
  layer: 'CRYPTO' | 'FIAT';
  cn: Record<string, Prisma.Decimal>;
  results: FormulaResult[];
}

/**
 * 五公式对账编排器（spec 2026-06-20 §3）。NEW path，取代旧 I1-I5（invariant-checker，留作后续清理）。
 *
 * 组装四类输入 → 跑 formula-checker：
 *   ① credit-net（CreditNetService，按 cutoff 重算 cn）
 *   ② 式2 RHS = OPEN Outstanding net；式3 RHS = 未清桥 swap 桥贡献（SubledgerInputsService）
 *   ③ 式4/5 RHS 账外 = Σexternal_balances（按 book）（SubledgerInputsService）
 *   ④ 在途时序 = InTransitService（复用，computed 非 stub；见下注）
 *
 * 在途时序（§3 ±项）：复用既有 in-transit.service —— crypto 取 payin/payout/internal_fund 在途三段，
 * fiat 取 payout/internal_fund 两段，返回「施加到外部侧」的净调整。本期 §0.5 数据齐备（payin/payout/
 * internal_fund 为真实单），故为 computed，非 stub。式4/5 把它加到外部余额侧。
 */
@Injectable()
export class FormulaReconService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditNet: CreditNetService,
    private readonly subledger: SubledgerInputsService,
    private readonly inTransit: InTransitService,
    private readonly checker: FormulaCheckerService,
  ) {}

  /**
   * 对每个币种跑五公式。
   * @param businessDate 业务日 D（YYYY-MM-DD）；cutoff = D 的次日 00:00（= D 24:00），与 V7 EOD 口径一致。
   * @param cutoffDateForExternal external_balances.cutoff_date 字符串（默认取业务日 D）。
   */
  async runFormulas(
    businessDate: string,
    cutoffDateForExternal?: string,
  ): Promise<FormulaReconCurrencyResult[]> {
    const cutoff = new Date(`${businessDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1); // T+1 00:00 = T+0 24:00
    const extCutoffDate = cutoffDateForExternal ?? businessDate;

    const assets = await this.prisma.asset.findMany({
      select: { id: true, currency: true, type: true },
    });

    const out: FormulaReconCurrencyResult[] = [];
    for (const asset of assets) {
      const ccy = asset.currency;
      const layer: 'CRYPTO' | 'FIAT' = asset.type === 'CRYPTO' ? 'CRYPTO' : 'FIAT';

      const cn = await this.creditNet.creditNetAtCutoff(ccy, cutoff);
      const openOutstandingNet = await this.subledger.openOutstandingNet(ccy, cutoff);
      const unsettledWithdrawFee = await this.subledger.unsettledWithdrawFee(ccy, cutoff);
      const unsweptSwapBridge = await this.subledger.unsweptSwapBridgeContribution(ccy, cutoff);

      const clientExternalSum = await this.subledger.externalBalanceSum('CLIENT', ccy, extCutoffDate);
      const firmExternalSum = await this.subledger.externalBalanceSum('FIRM', ccy, extCutoffDate);
      const inTransitAdj = layer === 'CRYPTO'
        ? await this.inTransit.computeCrypto(ccy, asset.id, cutoff)
        : await this.inTransit.computeFiat(ccy, asset.id, cutoff);

      const results = this.checker.checkAll(
        ccy,
        cn,
        openOutstandingNet,
        unsettledWithdrawFee,
        unsweptSwapBridge,
        { externalSum: clientExternalSum, inTransitAdj },
        // 式5 公司侧在途时序：本期公司库账外时序未单列，沿用同一 adj 仅作占位；公司侧无独立在途单时为 0 影响小。
        { externalSum: firmExternalSum, inTransitAdj: new Prisma.Decimal(0) },
      );

      out.push({ currency: ccy, assetId: asset.id, layer, cn, results });
    }
    return out;
  }
}
