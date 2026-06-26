import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 对账五公式（spec 2026-06-20 §3，credit-net 口径，全收敛到 = 0）。纯函数：吃 cn map + 子账输入，
 * 不读库、无副作用。fetch 子账的活在 subledger-inputs.service / formula-recon orchestrator。
 *
 * 三块（同币种 cn 相加，§3）：
 *   客户块 = CLIENT_BANK + CLIENT_CUSTODY + CLIENT_PAYABLE + DEPOSIT_SUSPENSE
 *   桥块   = TRADE_CLEARING
 *   公司块 = FIRM_TREASURY + FX_POSITION + PAID_IN_CAPITAL + RETAINED_EARNINGS
 *           + FEE_INCOME + SPREAD_INCOME + FX_UNREALIZED_PNL + FX_REALIZED_PNL
 *
 * @deprecated V8 five-formula engine; replaced by WalletReconRunService (Phase B, 2026-06-26). Phase C will remove.
 */

export type FormulaCode = '式1' | '式2' | '式3' | '式4' | '式5';

export interface FormulaResult {
  formula: FormulaCode;
  label: string;
  currency: string;
  lhs: Prisma.Decimal;
  rhs: Prisma.Decimal;
  delta: Prisma.Decimal; // lhs − rhs（带符号，便于下钻定位方向）
  status: 'PASS' | 'FAIL';
}

/** 式4/5 的右侧账外输入（per book per currency）。 */
export interface ExternalSide {
  /** Σ external_balances.closing_balance where book matches（human decimal）。 */
  externalSum: Prisma.Decimal;
  /** 在途时序净调整，施加到「外部」侧（沿用 in-transit.service 的符号约定）。 */
  inTransitAdj: Prisma.Decimal;
}

// COA code（带 A./L./R. 前缀，与 tb_transfer_evidence 一致）。
export const CLIENT_BLOCK_CODES = [
  'A.CLIENT_BANK',
  'A.CLIENT_CUSTODY',
  'L.CLIENT_PAYABLE',
  'L.DEPOSIT_SUSPENSE',
] as const;

export const BRIDGE_BLOCK_CODES = ['L.TRADE_CLEARING'] as const;

export const FIRM_BLOCK_CODES = [
  'A.FIRM_TREASURY',
  'A.FX_POSITION',
  'E.PAID_IN_CAPITAL',
  'E.RETAINED_EARNINGS',
  'R.FEE_INCOME',
  'R.SPREAD_INCOME',
  'R.FX_UNREALIZED_PNL',
  'R.FX_REALIZED_PNL',
] as const;

// 客户资产池（式4 左侧）：法币 CLIENT_BANK + 虚拟币 CLIENT_CUSTODY。
export const CLIENT_POOL_CODES = ['A.CLIENT_BANK', 'A.CLIENT_CUSTODY'] as const;
// 公司库（式5 左侧）。
export const FIRM_POOL_CODE = 'A.FIRM_TREASURY';

const TOLERANCE = '0.000001';
const D0 = () => new Prisma.Decimal(0);

@Injectable()
export class FormulaCheckerService {
  private readonly logger = new Logger(FormulaCheckerService.name);

  /** 同币种 credit-net，取 codes 子集求和（缺失 code 视为 0）。 */
  blockSum(cn: Record<string, Prisma.Decimal>, codes: readonly string[]): Prisma.Decimal {
    return codes.reduce((s, c) => s.plus(cn[c] ?? D0()), D0());
  }

  clientBlock(cn: Record<string, Prisma.Decimal>) { return this.blockSum(cn, CLIENT_BLOCK_CODES); }
  bridgeBlock(cn: Record<string, Prisma.Decimal>) { return this.blockSum(cn, BRIDGE_BLOCK_CODES); }
  firmBlock(cn: Record<string, Prisma.Decimal>) { return this.blockSum(cn, FIRM_BLOCK_CODES); }

  /**
   * 跑全部五式（per currency）。
   * @param cn                   credit-net map（human）
   * @param openOutstandingNet   式2 RHS 第一项：仅 OPEN(未 SETTLED) Outstanding 的 (ΣIN − ΣOUT)。
   * @param unsettledWithdrawFee 式2 RHS 第二项：未去混同的提现费（category=WITHDRAW_FEE, status≠SETTLED）。
   *                             提现费扣客户 claim 时客户块即减，但物理去混同(client pool→F_FEE)在 EOD/手动才发生；
   *                             故 RHS 须减去这段在途，使两侧同步。不含 swap 费（已 netted 进 Outstanding net）。
   * @param unsweptSwapBridge    式3 RHS：仅未清桥 swap 的桥贡献（from +fromAmount / to −mid）按本币种聚合。
   * @param clientExternal       式4 右侧（book=CLIENT）。
   * @param firmExternal         式5 右侧（book=FIRM）。
   */
  checkAll(
    currency: string,
    cn: Record<string, Prisma.Decimal>,
    openOutstandingNet: Prisma.Decimal,
    unsettledWithdrawFee: Prisma.Decimal,
    unsweptSwapBridge: Prisma.Decimal,
    clientExternal: ExternalSide,
    firmExternal: ExternalSide,
  ): FormulaResult[] {
    this.logger.warn('[V8 deprecated] FormulaCheckerService.checkAll called; route to WalletReconRunService.');
    return [
      this.formula1(currency, cn),
      this.formula2(currency, cn, openOutstandingNet, unsettledWithdrawFee),
      this.formula3(currency, cn, unsweptSwapBridge),
      this.formula4(currency, cn, clientExternal),
      this.formula5(currency, cn, firmExternal),
    ];
  }

  /** 式1 总账恒等（试算平衡）：客户块 + 桥块 + 公司块 = 0。 */
  formula1(currency: string, cn: Record<string, Prisma.Decimal>): FormulaResult {
    const lhs = this.clientBlock(cn).plus(this.bridgeBlock(cn)).plus(this.firmBlock(cn));
    return this.mk('式1', '总账恒等(试算平衡)', currency, lhs, D0());
  }

  /**
   * 式2 客户勾稽：客户块cn = OPEN Outstanding net − 未去混同提现费。
   * ★ 仅 OPEN(未 SETTLED) 的 Outstanding 腿；某腿结算→该腿 SETTLED→退出求和（与客户块同步减）。
   * ★ 提现费扣客户 claim 时客户块即减，但物理去混同(client pool→F_FEE)在 EOD 才发生→RHS 须减去在途费。
   *    swap 费已 netted 进 Outstanding net，不重复扣。
   */
  formula2(
    currency: string,
    cn: Record<string, Prisma.Decimal>,
    openOutstandingNet: Prisma.Decimal,
    unsettledWithdrawFee: Prisma.Decimal,
  ): FormulaResult {
    const lhs = this.clientBlock(cn);
    const rhs = openOutstandingNet.minus(unsettledWithdrawFee);
    return this.mk('式2', '客户勾稽(客户块 ↔ OPEN Outstanding − 未去混同提现费)', currency, lhs, rhs);
  }

  /**
   * 式3 桥勾稽：桥块cn − Σ(swap 桥贡献) = 0。
   * ★ 仅未清桥(非两腿全 SETTLED)的 swap；整笔清桥后退出求和（与桥块同步减）。
   * 桥贡献：from 腿 +fromAmount、to 腿 −mid。
   */
  formula3(
    currency: string,
    cn: Record<string, Prisma.Decimal>,
    unsweptSwapBridge: Prisma.Decimal,
  ): FormulaResult {
    const lhs = this.bridgeBlock(cn);
    return this.mk('式3', '桥勾稽(桥块↔未清桥 swap)', currency, lhs, unsweptSwapBridge);
  }

  /** 式4 客户账外：客户池(CLIENT_BANK/CUSTODY) = Σ客户外部余额 ± 在途时序。 */
  formula4(
    currency: string,
    cn: Record<string, Prisma.Decimal>,
    ext: ExternalSide,
  ): FormulaResult {
    // 客户池是资产科目，credit-net 下为负（借为负）；账外余额是正向持有量。
    // 取 −cn(pool) 还原资产持有量与外部余额同向比较。
    const lhs = this.blockSum(cn, CLIENT_POOL_CODES).negated();
    const rhs = ext.externalSum.plus(ext.inTransitAdj);
    return this.mk('式4', '客户账外(客户池↔外部余额±在途)', currency, lhs, rhs);
  }

  /** 式5 公司账外：FIRM_TREASURY = Σ公司外部余额 ± 在途时序。 */
  formula5(
    currency: string,
    cn: Record<string, Prisma.Decimal>,
    ext: ExternalSide,
  ): FormulaResult {
    const lhs = (cn[FIRM_POOL_CODE] ?? D0()).negated();
    const rhs = ext.externalSum.plus(ext.inTransitAdj);
    return this.mk('式5', '公司账外(FIRM_TREASURY↔外部余额±在途)', currency, lhs, rhs);
  }

  private mk(
    formula: FormulaCode, label: string, currency: string,
    lhs: Prisma.Decimal, rhs: Prisma.Decimal,
  ): FormulaResult {
    const delta = lhs.minus(rhs);
    return {
      formula, label, currency, lhs, rhs, delta,
      status: delta.abs().lessThan(TOLERANCE) ? 'PASS' : 'FAIL',
    };
  }
}
