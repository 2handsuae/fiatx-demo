// 戊波二 T5 · 扫费同额结转（码 90）的规划：纯函数，不碰账本。
// 手续费户 → 运营户的调拨要同时把「已扫进运营户的那截收入」转成公司权益（借 收入 / 贷 公司权益 200），
// 否则运营户的钱比公司权益多，卖光运营户会把公司权益减成负数、TigerBeetle 报错（总纲附录 A「不变量」）。
// 总额 = min(调拨金额, Σ 收入户余额)（spec 裁定 13：手续费户里不全是 210 / 211 的钱——没收入账贷 212 也落手续费户，
// 运营户调过来的钱也在里面——超出收入总额的那部分本就有公司权益背书，不需要再结转）；
// 按码序 210 → 211 → 212 扣到够为止，每户至多一笔，余额为 0 的户跳过。
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

/** 结转的消耗顺序。eventCode 必须各异——转账号按 (sourceType, sourceNo, eventCode) 哈希，同码两笔会撞同一个转账号。 */
export const FEE_INCOME_CLOSE_SEQUENCE = [
  { code: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, eventCode: 'FEE_INCOME_CLOSE_SWAP' },
  { code: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, eventCode: 'FEE_INCOME_CLOSE_WITHDRAW' },
  { code: TB_ACCOUNT_CODES.INCOME_OTHER, eventCode: 'FEE_INCOME_CLOSE_OTHER' },
] as const;

export interface FeeIncomeCloseStep {
  /** 被结转的收入科目码（210 / 211 / 212） */
  code: number;
  eventCode: string;
  amountMinor: bigint;
}

/** @param amountMinor 调拨金额（最小单位）
 *  @param incomeBalances 该 ledger 上 210 / 211 / 212 的已过账余额（贷 − 借，最小单位），缺的码按 0 */
export function planFeeIncomeClose(amountMinor: bigint, incomeBalances: Readonly<Record<number, bigint>>): FeeIncomeCloseStep[] {
  const steps: FeeIncomeCloseStep[] = [];
  let remaining = amountMinor;
  for (const { code, eventCode } of FEE_INCOME_CLOSE_SEQUENCE) {
    if (remaining <= 0n) break;
    const balance = incomeBalances[code] ?? 0n;
    if (balance <= 0n) continue;
    const take = balance < remaining ? balance : remaining;
    steps.push({ code, eventCode, amountMinor: take });
    remaining -= take;
  }
  return steps;
}
