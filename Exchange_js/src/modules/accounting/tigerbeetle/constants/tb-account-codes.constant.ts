// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts
/**
 * TB account type codes (u16). Immutable once assigned.
 * 实时 1:1 资金模型 COA(2026-06-25 重设计)。
 * 编码段:A 资产 1–99、L 负债 100–199、E 权益 200–299(200–209 运营/结算户,210–219 收入段)。
 * 币种用 ledger 区分(AED/USDT),code 只编类型。
 */
export const TB_ACCOUNT_CODES = {
  // ── 资产 A(聚合,每币种一个,ownerType SYSTEM)──
  CLIENT_ASSET: 1, // 客户托管资产 = Σ 所有客户钱包
  FIRM_ASSET: 50, // 公司资产 = Σ 所有公司账户
  // ── 负债 L(每客户)──
  CLIENT_PAYABLE: 100, // 客户应付,与客户钱包 1:1
  DEPOSIT_SUSPENSE: 101, // 充值合规暂扣
  // ── 权益 E(每公司账户,单例)──
  FIRM_OPS: 200, // 运营/流动性(兑换对手盘)
  FIRM_SET: 201, // 法币结算户(仅法币 ledger,银行约束)
  // ── COA v2 收入段(210–219,2026-08-13)：取代退役的 202 FIRM_FEE,按业务线三分 ──
  INCOME_SWAP_FEE: 210, // 兑换手续费收入(接类型码 36)
  INCOME_WITHDRAW_FEE: 211, // 提现手续费收入(接类型码 16)
  INCOME_OTHER: 212, // 其他收入(below-min 没收,类型码 4;与服务费隔离)
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** 退役户(2026-08-13 COA v2):202 FIRM_FEE(由 210/211/212 接班)/203 FIRM_LIQ/204 FIRM_SEIZED。
 *  TB 物理不可删;registry 置 RETIRED;历史 evidence 的 'E.FIRM_FEE' 字符串是历史事实不改写。 */
export const RETIRED_TB_CODES: readonly number[] = [202, 203, 204];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.CLIENT_ASSET': TB_ACCOUNT_CODES.CLIENT_ASSET,
  'A.FIRM_ASSET': TB_ACCOUNT_CODES.FIRM_ASSET,
  'L.CLIENT_PAYABLE': TB_ACCOUNT_CODES.CLIENT_PAYABLE,
  'L.DEPOSIT_SUSPENSE': TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
  'E.FIRM_OPS': TB_ACCOUNT_CODES.FIRM_OPS,
  'E.FIRM_SET': TB_ACCOUNT_CODES.FIRM_SET,
  'E.INCOME_SWAP_FEE': TB_ACCOUNT_CODES.INCOME_SWAP_FEE,
  'E.INCOME_WITHDRAW_FEE': TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE,
  'E.INCOME_OTHER': TB_ACCOUNT_CODES.INCOME_OTHER,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);

/**
 * Asset-class codes are DEBIT-normal; everything else (L/E) is CREDIT-normal.
 * Any balance/statement sign MUST respect this, else assets show negative:
 *   asset  balance = debits − credits   (debit = increase / IN)
 *   L / E  balance = credits − debits   (credit = increase / IN)
 * (Mirrors scripts/verify-realtime-coa.ts, the COA-invariant reference.)
 */
export const ASSET_TB_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_ASSET,
  TB_ACCOUNT_CODES.FIRM_ASSET,
]);

export const isAssetCode = (code: number): boolean => ASSET_TB_CODES.has(code);
