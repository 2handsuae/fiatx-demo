/**
 * L1 = 我方系统内部就能算出答案的判定（业主 2026-08-22 定义）。
 * 反面是 L2：必须问外部（Sumsub）才知道的。
 *
 * ⚠️ Travel Rule 类型判定**刻意不在这里**——业主裁定：判断照做，但不算 L1
 * 内容、不进 L1 卡片（`resolveKytTxnType()` 保持原位不动）。
 * ⚠️ 资产状态闸**刻意没有**——业主裁定「我们也不下架资产」。
 */

export type L1Domain = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

/** PASS=过了 ｜ FAIL=没过 ｜ NA=这个域天然不适用 ｜ SKIPPED=调用方未提供该项结果 */
export type L1Outcome = 'PASS' | 'FAIL' | 'NA' | 'SKIPPED';

export type L1CheckCode =
  | 'CUSTOMER_ELIGIBILITY'   // 生命周期 ACTIVE
  | 'CUSTOMER_RESTRICTION'   // 限制便签是否卡住本域能力
  | 'SINGLE_LIMIT'           // 单笔上下限（原生币种）
  | 'CUMULATIVE_LIMIT'       // 累计额度（AED，档位 × 日/月窗口）
  | 'LARGE_APPROVAL'         // 大额转审批阈值（AED）
  | 'ACCOUNT_READINESS'      // 收付账户就绪
  | 'BALANCE_SUFFICIENCY'    // 余额充足
  | 'QUOTE_VALIDITY'         // 报价有效性
  | 'TRADING_READINESS';     // 交易起始就绪

export interface L1Check {
  code: L1CheckCode;
  outcome: L1Outcome;
  /** 人话，运营在详情页直接读这句。 */
  detail: string;
}

/**
 * PASS  = 全过
 * BLOCK = 有 FAIL，且本域**可以拒**（提现/兑换：钱还没动）
 * HOLD  = 有 FAIL，但本域**拒不了**（充值：钱已经在链上到账，只能挂起等处置）
 */
export type L1Verdict = 'PASS' | 'BLOCK' | 'HOLD';

export interface L1Snapshot {
  evaluatedAt: string;
  domain: L1Domain;
  verdict: L1Verdict;
  /** 充值 HOLD 时的挂起原因（如 'SANCTION' / 'ADMIN_SUSPENSION' / 'BELOW_MIN'）。 */
  holdReason: string | null;
  /** 附加信息，非判定项：这笔当时按哪个档位算的。事后客户升档也说得清。 */
  tradingTier: string;
  checks: L1Check[];
}

export interface L1GateInput {
  domain: L1Domain;
  customerId: string;
  /**
   * 调用方已经判过的项（单笔/累计/大额/账户/余额/报价/起始就绪）。
   * 这些判定住在各域自己的位置，L1GateService 不重复执行，只收进快照。
   */
  preChecks?: L1Check[];
}
