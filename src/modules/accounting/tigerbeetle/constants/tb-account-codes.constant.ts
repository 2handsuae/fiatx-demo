// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts
import { AccountFlags } from 'tigerbeetle-node';
import { VAULTS, VaultCode } from '../../../../config/manifests/vaults.manifest';

/**
 * TB account type codes (u16). Immutable once assigned.
 * 科目表 v3（戊战役波一，2026-11-06）：账本按「钱包所在位置」重立——每个钱包一个现金户。
 * 戊波二（2026-11-07）加 2 托管短缺待补 / 51 应收 LP 两个借方户。
 * 编码段:A 资产 1–99、L 负债 100–199、E 权益 200–299(200–209 权益,210–219 收入段)、X 开支 300–399。
 * 币种用 ledger 区分(AED/USDT),code 只编类型。码 150 本战役不进码表。
 */
export const TB_ACCOUNT_CODES = {
  // ── 资产 A·现金类(每个钱包一户,ownerType WALLET)──
  CLIENT_CASH: 1, // 客户现金(借方户)：每个客户钱包一户
  FIRM_CASH: 50, // 公司现金(借方户)：每个公司钱包一户
  // ── 资产 A·非现金类(借方户,不与物理钱包一比一)──
  CLIENT_SHORTFALL: 2, // 托管短缺待补(借方户)：每个客户钱包一户(ownerType WALLET,与码 1 同开)，托管方少了客户的钱、公司认下待补的那一截
  LP_RECEIVABLE: 51, // 应收 LP 交货(借方户)：每 LP 每币种一户(ownerType LP)，LP 已收我方付款、货还没到的那一截
  // ── 负债 L(每客户)──
  CLIENT_PAYABLE: 100, // 客户应付,与客户钱包 1:1
  DEPOSIT_SUSPENSE: 101, // 充值合规暂扣
  // ── 权益 E ──
  FIRM_EQUITY: 200, // 公司权益(每币种一户,兑换对手盘;本钱 + 交易净额)
  // ── COA v2 收入段(210–219,2026-08-13)：取代退役的 202 FIRM_FEE,按业务线三分 ──
  INCOME_SWAP_FEE: 210, // 兑换手续费收入(接类型码 36)
  INCOME_WITHDRAW_FEE: 211, // 提现手续费收入(接类型码 16)
  INCOME_OTHER: 212, // 其他收入(below-min 没收,类型码 4;与服务费隔离)
  // ── 开支 X(300–399,借方户,每币种一户,ownerType SYSTEM)──
  EXPENSE_BANK_CUSTODY: 300, // 银行与托管费用
  EXPENSE_RECON_LOSS: 301, // 对账核销损失
  EXPENSE_OTHER: 302, // 其他开支
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/**
 * 科目名称 —— 一个科目一个名，**唯一真相源**（2026-08-13）。
 *
 * 背景：此前系统没有"科目名称"这个概念，`TbAccountRegistry` 也没有 name 列。
 * 各处只好拿 TS 枚举 key(`CLIENT_CASH`)当名字用；后来有人觉得业务方看不懂，
 * 又在 admin 前端另造了一份展示名表 —— 于是同一个科目看起来有了"两个名字"。
 * 实际上 `CLIENT_CASH` / `A.CLIENT_CASH` 都只是**代码的可读写法(助记码)**，
 * 与数字 `1` 等价；真正的科目名称只有这里这一份。
 *
 * 消费规则（业主 2026-08-13 定）：
 *   - 科目表 / 流水表 → 显示**名称**（API 下发 accountName）
 *   - 其余一切（凭证分录、对账 Case、筛选下拉）→ 显示**助记码**（A.CLIENT_CASH）
 * 前端不得再自建任何 code→名字 的映射表。
 */
export const TB_ACCOUNT_NAMES: Record<number, string> = {
  [TB_ACCOUNT_CODES.CLIENT_CASH]: 'Client Cash',
  [TB_ACCOUNT_CODES.CLIENT_SHORTFALL]: 'Custody Shortfall Receivable',
  [TB_ACCOUNT_CODES.FIRM_CASH]: 'Company Cash',
  [TB_ACCOUNT_CODES.LP_RECEIVABLE]: 'Due from LP',
  [TB_ACCOUNT_CODES.CLIENT_PAYABLE]: 'Payable to Clients – Available Balance',
  [TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]: 'Client Deposits Held – Pending Release',
  [TB_ACCOUNT_CODES.FIRM_EQUITY]: 'Company Equity',
  [TB_ACCOUNT_CODES.INCOME_SWAP_FEE]: 'Trading Fee Income',
  [TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE]: 'Withdrawal Fee Income',
  [TB_ACCOUNT_CODES.INCOME_OTHER]: 'Other Service Income',
  [TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY]: 'Bank & Custody Charges',
  [TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS]: 'Reconciliation Write-off Loss',
  [TB_ACCOUNT_CODES.EXPENSE_OTHER]: 'Other Expenses',
};

/** 科目名称查询（币种后缀由调用方按需拼，名称本身永不含币种）。 */
export const accountNameOf = (code: number | null | undefined): string | null =>
  code == null ? null : (TB_ACCOUNT_NAMES[code] ?? null);

/**
 * 读面下发的 `accountName`(科目表 / 流水表 / 详情标题)：
 *   现金户(ownerType WALLET)= 注册表 description(开户时已拼好的户名 `类名 · 钱包名`,见 cashAccountName);
 *   其余户 = 「一码一名」accountNameOf(code)。
 * 前端只显示这个字段,不得再造 code/钱包 → 名字 的映射。
 */
export const accountDisplayName = (
  row: { code?: number | null; ownerType?: string | null; description?: string | null } | null | undefined,
): string | null =>
  row?.ownerType === 'WALLET' && row.description ? row.description : accountNameOf(row?.code);

/** 202 FIRM_FEE / 204 FIRM_SEIZED 已于 2026-08-13 COA v2 废弃,
 *  由 210 INCOME_SWAP_FEE / 211 INCOME_WITHDRAW_FEE / 212 INCOME_OTHER 接班。
 *  201(法币结算户)/ 203(LP 在途验收户)已于 2026-11-06 戊战役波一退役：科目并入 50 类现金户
 *  (「公司现金·结算」「公司现金·LP 前厅」),对应的钱包 F_SET / F_LIQ 存续,钱住在各自的现金户里。
 *  demo 数据随时 reset,不保留任何过渡兼容层(退役码常量/标签映射/迁移脚本均已删除)。
 *  防回归断言见 tb-account-codes.constant.spec.ts —— 上述 4 个退役名字不得回到主表。 */

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.CLIENT_CASH': TB_ACCOUNT_CODES.CLIENT_CASH,
  'A.CLIENT_SHORTFALL': TB_ACCOUNT_CODES.CLIENT_SHORTFALL,
  'A.FIRM_CASH': TB_ACCOUNT_CODES.FIRM_CASH,
  'A.LP_RECEIVABLE': TB_ACCOUNT_CODES.LP_RECEIVABLE,
  'L.CLIENT_PAYABLE': TB_ACCOUNT_CODES.CLIENT_PAYABLE,
  'L.DEPOSIT_SUSPENSE': TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
  'E.FIRM_EQUITY': TB_ACCOUNT_CODES.FIRM_EQUITY,
  'E.INCOME_SWAP_FEE': TB_ACCOUNT_CODES.INCOME_SWAP_FEE,
  'E.INCOME_WITHDRAW_FEE': TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE,
  'E.INCOME_OTHER': TB_ACCOUNT_CODES.INCOME_OTHER,
  'X.EXPENSE_BANK_CUSTODY': TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY,
  'X.EXPENSE_RECON_LOSS': TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS,
  'X.EXPENSE_OTHER': TB_ACCOUNT_CODES.EXPENSE_OTHER,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);

/**
 * 借方户(DEBIT-normal)= 资产类 1 / 2 / 50 / 51 + 开支类 300–302;其余(L / E 的 100–212)皆贷方户。
 * 余额与流水方向的符号必须按此判定,否则借方户会显示成负数:
 *   借方户 balance = debits − credits   (借 = 增加 / IN)
 *   贷方户 balance = credits − debits   (贷 = 增加 / IN)
 * 全仓「这个科目是不是借方户」只认 isDebitNormalCode,不再另造局部集合或按助记码前缀 'A.' 判断。
 * (与 scripts/verify-realtime-coa.ts 的恒等式口径一致。)
 */
export const DEBIT_NORMAL_TB_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_CASH,
  TB_ACCOUNT_CODES.CLIENT_SHORTFALL,
  TB_ACCOUNT_CODES.FIRM_CASH,
  TB_ACCOUNT_CODES.LP_RECEIVABLE,
  TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY,
  TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS,
  TB_ACCOUNT_CODES.EXPENSE_OTHER,
]);

export const isDebitNormalCode = (code: number): boolean => DEBIT_NORMAL_TB_CODES.has(code);

/** 现金类 = 与物理钱包一比一的两类户(1 客户现金 / 50 公司现金),开户粒度是钱包。
 *  2 托管短缺待补虽也挂在钱包下(ownerType WALLET)、也是借方户，但它不是现金户——对账不把它的流水当钱包流水读，故不在此集合。 */
export const CASH_TB_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_CASH,
  TB_ACCOUNT_CODES.FIRM_CASH,
]);

export const isCashCode = (code: number): boolean => CASH_TB_CODES.has(code);

/**
 * 账户标志位:账本不得为负是硬约束(TB 直接报错)。
 * 借方户禁「贷超借」= credits_must_not_exceed_debits(4);贷方户禁「借超贷」= debits_must_not_exceed_credits(2)。
 */
export const accountFlagsFor = (code: number): number =>
  isDebitNormalCode(code)
    ? AccountFlags.credits_must_not_exceed_debits
    : AccountFlags.debits_must_not_exceed_credits;

/**
 * 钱包归属 → 现金户科目码：客户钱包(CUSTOMER)→ 1 客户现金，平台钱包(PLATFORM)→ 50 公司现金。
 * 全仓「这个钱包的现金户是哪个码」只认这一处(解析 / 开户 / 种子共用)；未知归属直接抛，不回落到任何一类。
 */
export const cashAccountCodeFor = (
  walletOwnerType: string,
): typeof TB_ACCOUNT_CODES.CLIENT_CASH | typeof TB_ACCOUNT_CODES.FIRM_CASH => {
  if (walletOwnerType === 'CUSTOMER') return TB_ACCOUNT_CODES.CLIENT_CASH;
  if (walletOwnerType === 'PLATFORM') return TB_ACCOUNT_CODES.FIRM_CASH;
  throw new Error(`No cash account code for wallet ownerType ${walletOwnerType}`);
};

/**
 * 钱包下要开的户 = 现金户 + (客户钱包另开)码 2 托管短缺待补。全仓「这个钱包开哪几个户」只认这一处(运行时开户 / 种子共用)。
 *   客户钱包 → [1, 2]；平台钱包 → [50]；未知归属直接抛(同 cashAccountCodeFor)。
 */
export const walletAccountCodesFor = (walletOwnerType: string): Array<1 | 2 | 50> => {
  const cash = cashAccountCodeFor(walletOwnerType);
  return cash === TB_ACCOUNT_CODES.CLIENT_CASH ? [cash, TB_ACCOUNT_CODES.CLIENT_SHORTFALL] : [cash];
};

/**
 * 钱包户户名 = `类名 · 钱包名`(现金类 1 / 50 与客户钱包下的码 2 户名,开户时写入注册表 description)。
 *   平台钱包:`Company Cash · <vault 标签> · <网络>`      例 Company Cash · Company Operations · AED_ZAND
 *   客户钱包:`Client Cash · <客户号> · <vIBAN | Deposit address>`
 *   客户钱包(码 2):`Custody Shortfall · <客户号> · <vIBAN | Deposit address>`  角色字样与同钱包的客户现金户一致
 */
export const cashAccountName = (
  code: 1 | 2 | 50,
  wallet: { vaultCode: string; walletRole: string; network: string; ownerNo: string },
): string => {
  if (code === TB_ACCOUNT_CODES.FIRM_CASH) {
    return `${TB_ACCOUNT_NAMES[TB_ACCOUNT_CODES.FIRM_CASH]} · ${VAULTS[wallet.vaultCode as VaultCode].label} · ${wallet.network}`;
  }
  const role = wallet.walletRole === 'C_VIBAN' ? 'vIBAN' : 'Deposit address';
  return code === TB_ACCOUNT_CODES.CLIENT_SHORTFALL
    ? `Custody Shortfall · ${wallet.ownerNo} · ${role}`
    : `${TB_ACCOUNT_NAMES[TB_ACCOUNT_CODES.CLIENT_CASH]} · ${wallet.ownerNo} · ${role}`;
};
