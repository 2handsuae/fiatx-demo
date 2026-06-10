/**
 * TB account type codes (u16). Immutable once assigned.
 * 编码段:A 资产 1–99(1–49 客户资金形态 / 50–99 公司自有)、
 * L 负债 100–199、E 权益 200–299、R 损益 300–399。
 */
export const TB_ACCOUNT_CODES = {
  // ── 客户账本(safeguarding)──
  CLIENT_BANK: 1,        // 原 BANK:客户资金池·银行侧(法币 ledger)
  CLIENT_CUSTODY: 10,    // 原 CUSTODY:客户资金池·托管侧(crypto ledger)
  CLIENT_CREDIT: 100,
  CLIENT_AUDIT: 101,
  TRADE_CLEARING: 110,   // swap 桥(双向,EOD 清入 FX_POSITION)
  // ── 公司账本 ──
  FIRM_OPS: 50,          // 公司自有资金(F_OPS/F_LIQ/F_SET/F_FEE 合并视角)
  FX_POSITION: 60,       // 换汇户:FX 头寸,每币种一条腿,双向
  PAID_IN_CAPITAL: 200,
  RETAINED_EARNINGS: 210,
  FEE_INCOME: 300,
  SPREAD_INCOME: 310,
  FX_UNREALIZED_PNL: 320, // 每日重估,双向
  FX_REALIZED_PNL: 330,   // LP 平盘锁定,双向
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.CLIENT_BANK': TB_ACCOUNT_CODES.CLIENT_BANK,
  'A.CLIENT_CUSTODY': TB_ACCOUNT_CODES.CLIENT_CUSTODY,
  'A.FIRM_OPS': TB_ACCOUNT_CODES.FIRM_OPS,
  'A.FX_POSITION': TB_ACCOUNT_CODES.FX_POSITION,
  'L.CLIENT_CREDIT': TB_ACCOUNT_CODES.CLIENT_CREDIT,
  'L.CLIENT_AUDIT': TB_ACCOUNT_CODES.CLIENT_AUDIT,
  'L.TRADE_CLEARING': TB_ACCOUNT_CODES.TRADE_CLEARING,
  'E.PAID_IN_CAPITAL': TB_ACCOUNT_CODES.PAID_IN_CAPITAL,
  'E.RETAINED_EARNINGS': TB_ACCOUNT_CODES.RETAINED_EARNINGS,
  'R.FEE_INCOME': TB_ACCOUNT_CODES.FEE_INCOME,
  'R.SPREAD_INCOME': TB_ACCOUNT_CODES.SPREAD_INCOME,
  'R.FX_UNREALIZED_PNL': TB_ACCOUNT_CODES.FX_UNREALIZED_PNL,
  'R.FX_REALIZED_PNL': TB_ACCOUNT_CODES.FX_REALIZED_PNL,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
