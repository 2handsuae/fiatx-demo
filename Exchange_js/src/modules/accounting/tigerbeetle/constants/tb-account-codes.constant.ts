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

/**
 * 科目名称 —— 一个科目一个名，**唯一真相源**（2026-08-13）。
 *
 * 背景：此前系统没有"科目名称"这个概念，`TbAccountRegistry` 也没有 name 列。
 * 各处只好拿 TS 枚举 key(`CLIENT_ASSET`)当名字用；后来有人觉得业务方看不懂，
 * 又在 admin 前端另造了一份展示名表 —— 于是同一个科目看起来有了"两个名字"。
 * 实际上 `CLIENT_ASSET` / `A.CLIENT_ASSET` 都只是**代码的可读写法(助记码)**，
 * 与数字 `1` 等价；真正的科目名称只有这里这一份。
 *
 * 消费规则（业主 2026-08-13 定）：
 *   - 科目表 / 流水表 → 显示**名称**（API 下发 accountName）
 *   - 其余一切（凭证分录、对账 Case、筛选下拉）→ 显示**助记码**（A.CLIENT_ASSET）
 * 前端不得再自建任何 code→名字 的映射表。
 */
export const TB_ACCOUNT_NAMES: Record<number, string> = {
  [TB_ACCOUNT_CODES.CLIENT_ASSET]: 'Client Assets in Custody',
  [TB_ACCOUNT_CODES.FIRM_ASSET]: 'Company Own Assets',
  [TB_ACCOUNT_CODES.CLIENT_PAYABLE]: 'Payable to Clients – Available Balance',
  [TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]: 'Client Deposits Held – Pending Release',
  [TB_ACCOUNT_CODES.FIRM_OPS]: 'Company Operating Funds',
  [TB_ACCOUNT_CODES.FIRM_SET]: 'Settlement in Transit – Fiat',
  [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 'Trading Fee Income',
  [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 'Withdrawal Fee Income',
  [TB_ACCOUNT_CODES.INCOME_OTHER]: 'Other Service Income',
};

/** 科目名称查询（币种后缀由调用方按需拼，名称本身永不含币种）。 */
export const accountNameOf = (code: number | null | undefined): string | null =>
  code == null ? null : (TB_ACCOUNT_NAMES[code] ?? null);

/** 202 FIRM_FEE / 203 FIRM_LIQ / 204 FIRM_SEIZED 已于 2026-08-13 COA v2 废弃,
 *  由 210 INCOME_SWAP_FEE / 211 INCOME_WITHDRAW_FEE / 212 INCOME_OTHER 接班。
 *  demo 数据随时 reset,不保留任何过渡兼容层(退役码常量/标签映射/迁移脚本均已删除)。
 *  防回归断言见 tb-account-codes.constant.spec.ts —— 这三个名字不得回到主表。 */

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
