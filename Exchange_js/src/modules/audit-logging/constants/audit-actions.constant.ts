export const AuditModules = {
  AUDIT_LOGS: 'audit-logging',
  GOVERNANCE_APPROVALS: 'governance/approvals',
  GOVERNANCE_REGISTRIES: 'governance/registries',
  GOVERNANCE_REGULATORY_GATES: 'governance/regulatory-gates',
  AUTH: 'identity/auth',
  ACCESS_CONTROL: 'identity/access-control',
  CUSTOMER_AUTH: 'identity/auth/customer',
  ONBOARDING: 'identity/onboarding',
  PAYINS: 'asset-treasury/payins',
  DEPOSIT_TRANSACTIONS: 'trading/deposit-transactions',
  SWAP_TRANSACTIONS: 'trading/swap-transactions',
  SWAP_QUOTES: 'trading/swap-quotes',
  PRICING_CENTER: 'trading/pricing-center',
  WITHDRAW_TRANSACTIONS: 'trading/withdraw-transactions',
  PAYOUTS: 'asset-treasury/payouts',
  SAFEGUARDING_RECONCILIATION: 'clearing-settle/safeguarding-reconciliation',
  INTERNAL_TRANSACTIONS: 'asset-treasury/internal-transactions',
  INTERNAL_FUNDS: 'asset-treasury/internal-funds',
  ASSETS: 'asset-treasury/assets',
  LIQUIDITY_CONFIG: 'counterparty/liquidity-config',
  ACCT_EVENTS: 'accounting/acct-events',
  CLEARING_TEMPLATES: 'clearing-settle/clearing-templates',
  JOURNAL_HEADER_TEMPLATES: 'accounting/journal-header-templates',
  JOURNAL_LINE_TEMPLATES: 'accounting/journal-line-templates',
  CUSTOMER_SWAP_RATES: 'identity/customer-swap-rates',
  COA: 'accounting/coa',
  WALLETS: 'asset-treasury/wallets',
  CUSTOMERS: 'identity/customers',
  INBOUND_TRANSFER_SIGNALS: 'trading/inbound-transfer-signals',
  WITHDRAW_WORKFLOW: 'orchestrators/withdraw-workflow',
} as const;

export const AuditEntityTypes = {
  APPROVAL_CASE: 'APPROVAL_CASE',
  SHAREHOLDING_REGISTRY_VERSION: 'SHAREHOLDING_REGISTRY_VERSION',
  APPOINTMENT_RECORD: 'APPOINTMENT_RECORD',
  REGULATORY_GATE_ITEM: 'REGULATORY_GATE_ITEM',
  TRAINING_RECORD: 'TRAINING_RECORD',
  CONFLICT_DISCLOSURE: 'CONFLICT_DISCLOSURE',
  WIND_DOWN_MATERIAL: 'WIND_DOWN_MATERIAL',
  ONBOARDING: 'ONBOARDING',
  ACCESS_CONTROL: 'ACCESS_CONTROL',
  PAYIN: 'PAYIN',
  DEPOSIT_TRANSACTION: 'DEPOSIT_TRANSACTION',
  SWAP_TRANSACTION: 'SWAP_TRANSACTION',
  WITHDRAW_TRANSACTION: 'WITHDRAW_TRANSACTION',
  PAYOUT: 'PAYOUT',
  INTERNAL_FUND: 'INTERNAL_FUND',
  AUDIT_EVIDENCE_PACKAGE: 'AUDIT_EVIDENCE_PACKAGE',
  AUTH: 'AUTH',
  CONFIG: 'CONFIG',
  ASSET: 'ASSET',
  LIQUIDITY_CONFIG: 'LIQUIDITY_CONFIG',
  COA: 'COA',
  WALLET: 'WALLET',
  WITHDRAWAL_ADDRESS: 'WITHDRAWAL_ADDRESS',
  CUSTOMER: 'CUSTOMER',
  INBOUND_TRANSFER_SIGNAL: 'INBOUND_TRANSFER_SIGNAL',
  SWAP_QUOTE: 'SWAP_QUOTE',
  ADMIN_USER: 'ADMIN_USER',
  APPROVAL_POLICY: 'APPROVAL_POLICY',
  TB_ACCOUNT: 'TB_ACCOUNT',
  TRANSACTION_LIMIT_POLICY: 'TRANSACTION_LIMIT_POLICY',
  WITHDRAWAL_FEE_LEVEL: 'WITHDRAWAL_FEE_LEVEL',
  SWAP_FEE_LEVEL: 'SWAP_FEE_LEVEL',
  INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',
  RECONCILIATION_RUN_V8: 'RECONCILIATION_RUN_V8',
  RECONCILIATION_CASE: 'RECONCILIATION_CASE',
  RECON_ADJUSTMENT: 'RECON_ADJUSTMENT',
  RECON_DISPOSITION: 'RECON_DISPOSITION',
  CUSTOMER_TAG: 'CUSTOMER_TAG',
  MATERIAL_REQUEST: 'MATERIAL_REQUEST',
  // 平账三期（2026-09-06）：事故登记
  INCIDENT: 'INCIDENT',
} as const;

export const AuditWorkflowTypes = {
  // Trading workflows
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
  SWAP: 'SWAP',
  TRANSACTION: 'TRANSACTION',
  // Onboarding / compliance
  ONBOARDING: 'ONBOARDING',
  PERIODIC_REVIEW: 'PERIODIC_REVIEW',
  // Governance
  APPROVAL: 'APPROVAL',
} as const;

export const AuditBusinessWorkflowTypes = {
  ADMIN_LOGIN_ACCESS: 'ADMIN_LOGIN_ACCESS',
  ADMIN_ROLE_BINDING_CHANGE: 'ADMIN_ROLE_BINDING_CHANGE',
  AUDIT_EVIDENCE_EXPORT: 'AUDIT_EVIDENCE_EXPORT',
  // Governance redesign workflow types (C1–D2)
  ADMIN_INVITE: 'ADMIN_INVITE',
  ADMIN_SUSPENSION: 'ADMIN_SUSPENSION',
  ADMIN_REACTIVATION: 'ADMIN_REACTIVATION',
  ADMIN_FIRST_LOGIN: 'ADMIN_FIRST_LOGIN',
  APPROVAL_POLICY: 'APPROVAL_POLICY',
  // Role Definition Governance (2026-05-08)
  ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE',
  ROLE_DEFINITION_MODIFY: 'ROLE_DEFINITION_MODIFY',
  // Credential Reset Governance (2026-05-10)
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_MFA_RESET: 'ADMIN_MFA_RESET',
  // Custodian Wallet Create (2026-05-13) — 波一(2026-09-04)T4 随托管钱包创建整条路退役
  WITHDRAWAL_ADDRESS_REGISTRATION: 'WITHDRAWAL_ADDRESS_REGISTRATION',
  TB_ACCOUNT_MANUAL_CREATE: 'TB_ACCOUNT_MANUAL_CREATE',
  // Asset Suspension (2026-05-14)
  ASSET_SUSPENSION: 'ASSET_SUSPENSION',
  ASSET_REACTIVATION: 'ASSET_REACTIVATION',
  // Transaction Limit Change (2026-05-16)（原 Transaction Limit Creation 已随「限额只改
  // 不建不删」创建流整条退役,波一 T10,2026-09-04）
  TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
  // Transaction Limit Enforcement (2026-07-16) — L1 per-transaction gate rejections (A/B)
  TRANSACTION_LIMIT_ENFORCEMENT: 'TRANSACTION_LIMIT_ENFORCEMENT',
  // Deposit Below-Min Confiscation (2026-07-16) — V1 maker-checker confiscation of below-min deposit as fee
  DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATION',
  // Deposit Return/Seize/Unfreeze maker-checker approvals (A2, 计划2) — 复刻 DEPOSIT_CONFISCATION
  DEPOSIT_RETURN: 'DEPOSIT_RETURN',
  DEPOSIT_SEIZE: 'DEPOSIT_SEIZE',
  DEPOSIT_UNFREEZE: 'DEPOSIT_UNFREEZE',
  // 平账 B 批（2026-09-03）：补单三入口
  DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT',
  DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK',
  // Withdraw FROZEN Unfreeze/Sanction-Refund maker-checker approvals (Task 8, 2026-08-03) — 复刻 DEPOSIT_UNFREEZE
  WITHDRAW_UNFREEZE: 'WITHDRAW_UNFREEZE',
  WITHDRAW_SANCTION_REFUND: 'WITHDRAW_SANCTION_REFUND',
  // 平账 B 批（2026-09-03）：出款后被银行退回的认领
  WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM',
  // Withdrawal Fee Level (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
  WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
  // Swap Fee Level (2026-05-31)
  SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_CREATION',
  SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_CHANGE',
  // Fee Level Retirement（波一 T11，2026-09-04）——"删" 改走审批终态，CFO 提、运营批
  SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_RETIRE',
  WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_RETIRE',
  // Trading Tier Upgrade (pre-registered, workflow deferred)
  TRADING_TIER_UPGRADE: 'TRADING_TIER_UPGRADE',
  // Withdraw Large-Value Approval Gate (2026-06-01)
  WITHDRAW_LARGE_VALUE_APPROVAL: 'WITHDRAW_LARGE_VALUE_APPROVAL',
  // Internal Transfer (V7, 2026-06-03)
  INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',
  // V8 Reconciliation (2026-06-18)
  V8_RECONCILIATION: 'clearing-settle/reconciliation',
  // Customer Tags (2026-07-13)
  CUSTOMER_TAG: 'CUSTOMER_TAG',
  // Customer Restriction Release (2026-08-15) — 贴/撕便签的审计都归这条 workflow
  CUSTOMER_RESTRICTION_RELEASE: 'CUSTOMER_RESTRICTION_RELEASE',
  // 材料请求账（2026-08-17）：下发 / 提交 / 裁决 / 作废共用一个 workflowType
  MATERIAL_REQUEST: 'MATERIAL_REQUEST',
  // 平账三期（2026-09-06）：事故登记（治理件，独立主体 Incident）
  INCIDENT: 'INCIDENT',
  CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPTANCE',
  CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE',
} as const;

// Task 28：退役清单扫尾——原 15 键仅 2 键（REQUEST_CREATED/SUBMITTED）经
// AuditRawActionToUserActionMap 真正产出，其余 13 键是站4清扫十条死词映射时
// 遗留的孤儿目标值（映射源已删，目标值没跟着删），零产出零消费，随本次退役一并删除。
export const AuditUserActions = {
  REQUEST_CREATED: 'REQUEST_CREATED',
  SUBMITTED: 'SUBMITTED',
} as const;

export const AuditActions = {
  APPROVAL_SUBMITTED: 'APPROVAL_SUBMITTED',
  APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
  APPROVAL_REQUIRED_MISSING: 'APPROVAL_REQUIRED_MISSING',
  SHAREHOLDING_REGISTRY_CREATED: 'SHAREHOLDING_REGISTRY_CREATED',
  SHAREHOLDING_REGISTRY_UPDATED: 'SHAREHOLDING_REGISTRY_UPDATED',
  APPOINTMENT_RECORD_CREATED: 'APPOINTMENT_RECORD_CREATED',
  APPOINTMENT_RECORD_UPDATED: 'APPOINTMENT_RECORD_UPDATED',
  REGULATORY_GATE_CREATED: 'REGULATORY_GATE_CREATED',
  REGULATORY_GATE_UPDATED: 'REGULATORY_GATE_UPDATED',
  REGULATORY_GATE_SUBMITTED: 'REGULATORY_GATE_SUBMITTED',
  REGULATORY_GATE_FEEDBACK_RECORDED: 'REGULATORY_GATE_FEEDBACK_RECORDED',
  REGULATORY_GATE_RECEIPT_BOUND: 'REGULATORY_GATE_RECEIPT_BOUND',
  REGULATORY_GATE_MARKED_EFFECTIVE: 'REGULATORY_GATE_MARKED_EFFECTIVE',
  REGULATORY_GATE_REVOKED: 'REGULATORY_GATE_REVOKED',
  TRAINING_RECORD_CREATED: 'TRAINING_RECORD_CREATED',
  TRAINING_RECORD_UPDATED: 'TRAINING_RECORD_UPDATED',
  CONFLICT_DISCLOSURE_CREATED: 'CONFLICT_DISCLOSURE_CREATED',
  CONFLICT_DISCLOSURE_UPDATED: 'CONFLICT_DISCLOSURE_UPDATED',
  WIND_DOWN_MATERIAL_CREATED: 'WIND_DOWN_MATERIAL_CREATED',
  WIND_DOWN_MATERIAL_UPDATED: 'WIND_DOWN_MATERIAL_UPDATED',
  DEPOSIT_CREATED: 'DEPOSIT_CREATED',
  DEPOSIT_COMPLIANCE_STARTED: 'DEPOSIT_COMPLIANCE_STARTED',
  DEPOSIT_GATE0_PASSED: 'DEPOSIT_GATE0_PASSED',
  // Sumsub KYT txn submission (Task 8)
  DEPOSIT_SUMSUB_SUBMITTED: 'DEPOSIT_SUMSUB_SUBMITTED',
  DEPOSIT_APPROVED: 'DEPOSIT_APPROVED',
  DEPOSIT_COMPLETED: 'DEPOSIT_COMPLETED',
  DEPOSIT_ACCOUNTING_BLOCKED: 'DEPOSIT_ACCOUNTING_BLOCKED',
  DEPOSIT_HELD_NOT_TRADING_READY: 'DEPOSIT_HELD_NOT_TRADING_READY',
  // Sanctions/MLRO freeze must never be lifted by a late/re-scored "approved" KYT
  // webhook — this is the audit trail for that blocked attempt (fix for the
  // FROZEN→approve→SUCCESS single-operator release hole).
  DEPOSIT_APPROVE_BLOCKED_FROZEN: 'DEPOSIT_APPROVE_BLOCKED_FROZEN',
  // KYT verdict-driven transitions (Sumsub TxnMonitoring, Task 7)
  DEPOSIT_FROZEN: 'DEPOSIT_FROZEN',
  DEPOSIT_MANUAL_CHECKING: 'DEPOSIT_MANUAL_CHECKING',
  // A5(2026-08-13):迟到的 KYT 裁决撞上终态/在途处置态 → 忽略。忽略 ≠ 静默,记一条便于
  // 演示与事后取证("系统收到了、判定不适用、记下来了"),原裁决/存证一个字不动。
  DEPOSIT_KYT_VERDICT_IGNORED: 'DEPOSIT_KYT_VERDICT_IGNORED',
  // 终审必修(2026-08-20):IGNORE 分支撞上迟到的 SANCTION_APPLICANT 裁决 ——
  // 单据状态不该决定"人"要不要被限制(与 swap-workflow.service.ts 的 carve-out
  // 同一条原则)。此时单子本身一步不动(见 DEPOSIT_KYT_VERDICT_IGNORED),但客户
  // 仍被 customerRestrictionsService.open({cause:'SANCTION'}) 摁住 —— 这条审计
  // 承载"虽然单子没动,但人被冻了"这条取证线索。
  DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT: 'DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT',
  DEPOSIT_MANUAL_APPROVED: 'DEPOSIT_MANUAL_APPROVED',
  DEPOSIT_ONHOLD: 'DEPOSIT_ONHOLD',
  // 已在 ACTION_PENDING 时 Sumsub 又发一个新 applicantActionId(客户交的材料不够,
  // 还要再补)——状态不动,但引用/提交戳/SLA 表刷新(AE-T2)
  // I1 修复:awaitUser 裁决同步之后该单没有任何未提交行(报文整个不带
  // applicantActions,或撤回的恰好是全部未提交行)——拒绝进入/停留 ACTION_PENDING,
  // 单子保持原状态,留痕供排查上游报文异常
  DEPOSIT_AWAITUSER_EMPTY_ACTIONS: 'DEPOSIT_AWAITUSER_EMPTY_ACTIONS',
  // onHold/ACTION_PENDING SLA breach timer (Task 10)
  DEPOSIT_SLA_BREACHED: 'DEPOSIT_SLA_BREACHED',
  // Task 6 (SLA 批次)：管理台「模拟超时」按钮 —— 把 slaDeadline 拨到过去，
  // 下次扫描立即破线。operator 触发、改了持久字段，走 recordByActor。
  DEPOSIT_SLA_TIMEOUT_SIMULATED: 'DEPOSIT_SLA_TIMEOUT_SIMULATED',
  DEPOSIT_HELD_BELOW_MIN: 'DEPOSIT_HELD_BELOW_MIN',   // L1 金额下限挂起(不自动放行)
  DEPOSIT_LIMIT_WAIVED: 'DEPOSIT_LIMIT_WAIVED',       // 运营豁免 below-min(PASS) — used by D5
  DEPOSIT_CONFISCATION_REQUESTED: 'DEPOSIT_CONFISCATION_REQUESTED', // 没收审批发起(maker) — used by D6
  DEPOSIT_CONFISCATION_STARTED: 'DEPOSIT_CONFISCATION_STARTED',     // 没收在途开始(pending+CONFISCATING) — used by C2
  DEPOSIT_CONFISCATION_EXECUTED: 'DEPOSIT_CONFISCATION_EXECUTED',   // 没收落地成功 — used by D7
  DEPOSIT_CONFISCATION_FAILED: 'DEPOSIT_CONFISCATION_FAILED',       // 没收落地失败 — used by D7
  // A1(2026-08-13):没收腿 FAILED/TIMEOUT — 解锁两笔 pending 后退回 OPERATION_PENDING,
  // 运营可重新发起没收。此前这条信号掉地上(handler 只认 CONFIRMED),单子永停 CONFISCATING。
  // ⚠️ A3(2026-08-22)后不再被写入:没收腿改重试三级梯,失败落 RETRIED / STUCK 两条。
  //    常量本身保留(本批不做审计专项,死常量清理留给审计那一轮,见 BACKLOG)。
  // A1:解锁失败(TB 不可达等)。此时 deposit 仍停 CONFISCATING、pending 锁还在,需人工介入。
  DEPOSIT_CONFISCATION_UNLOCK_FAILED: 'DEPOSIT_CONFISCATION_UNLOCK_FAILED',
  // A3(2026-08-22):没收腿重试三级梯 —— 与 DEPOSIT_RETURN_* / DEPOSIT_SEIZE_* 同构。
  DEPOSIT_CONFISCATION_RETRIED: 'DEPOSIT_CONFISCATION_RETRIED',
  DEPOSIT_CONFISCATION_STUCK: 'DEPOSIT_CONFISCATION_STUCK',
  // 退回(RETURNING→RETURNED)地基常量(A1),记账/审批接线见 A2-A4
  DEPOSIT_RETURN_APPROVAL_REQUESTED: 'DEPOSIT_RETURN_APPROVAL_REQUESTED',
  DEPOSIT_RETURN_STARTED: 'DEPOSIT_RETURN_STARTED',
  DEPOSIT_RETURNED: 'DEPOSIT_RETURNED',
  DEPOSIT_RETURN_RETRIED: 'DEPOSIT_RETURN_RETRIED',
  DEPOSIT_RETURN_STUCK: 'DEPOSIT_RETURN_STUCK',
  // 平账 B 批（2026-09-03）：补单三入口。① 主体是入站信号（无 correlationId，照 INBOUND_SIGNAL_* 走 N）
  DEPOSIT_SUPPLEMENT_REQUESTED: 'DEPOSIT_SUPPLEMENT_REQUESTED',
  DEPOSIT_SUPPLEMENT_STARTED: 'DEPOSIT_SUPPLEMENT_STARTED',
  DEPOSIT_SUPPLEMENT_REJECTED: 'DEPOSIT_SUPPLEMENT_REJECTED',
  DEPOSIT_SUPPLEMENTED: 'DEPOSIT_SUPPLEMENTED',
  // ② 主体是充值单（INHERIT，照 DEPOSIT_RETURN_*）
  DEPOSIT_CLAWBACK_REQUESTED: 'DEPOSIT_CLAWBACK_REQUESTED',
  DEPOSIT_CLAWBACK_STARTED: 'DEPOSIT_CLAWBACK_STARTED',
  DEPOSIT_CLAWED_BACK: 'DEPOSIT_CLAWED_BACK',
  // 上缴(SEIZING→SEIZED)地基常量(A1),记账/审批接线见 A2-A4
  DEPOSIT_SEIZE_APPROVAL_REQUESTED: 'DEPOSIT_SEIZE_APPROVAL_REQUESTED',
  DEPOSIT_SEIZE_STARTED: 'DEPOSIT_SEIZE_STARTED',
  DEPOSIT_SEIZED: 'DEPOSIT_SEIZED',
  DEPOSIT_SEIZE_RETRIED: 'DEPOSIT_SEIZE_RETRIED',
  DEPOSIT_SEIZE_STUCK: 'DEPOSIT_SEIZE_STUCK',
  // 处置腿（没收/退回/上缴）结算已完成（记账 POSTED + 充值单进终态），但资金单未能
  // 收口到 CLEARED。属视图不一致、非账不平——记一条便于运营发现并手工推单。
  DEPOSIT_LEG_CLEAR_FAILED: 'DEPOSIT_LEG_CLEAR_FAILED',
  // 解冻地基常量(A1),接线见 A5
  DEPOSIT_UNFREEZE_APPROVAL_REQUESTED: 'DEPOSIT_UNFREEZE_APPROVAL_REQUESTED',
  DEPOSIT_UNFROZEN: 'DEPOSIT_UNFROZEN',
  // 客户提交补料材料(AE-T4)——SLA 表由"等客户"切到"等 Provider 重评"
  // Demo scenario runner (Task 6, 计划1·甲方案) — feeds a deposit through a Sumsub mock
  // scenario fixture (SUMSUB_MOCK_MODE only; endpoint doesn't exist otherwise)
  DEPOSIT_DEMO_SCENARIO_RUN: 'DEPOSIT_DEMO_SCENARIO_RUN',
  // A7(2026-08-29):材料审过(GREEN)后把 ACTION_PENDING 充值单推回 COMPLIANCE_PENDING
  // 重跑合规——转移表的 RESUME 边一直在,此前没有 listener 触发它(见 deposit-workflow
  // .service.ts 的 onMaterialRequestReviewed)。
  DEPOSIT_MATERIAL_APPROVED_RESUMED: 'DEPOSIT_MATERIAL_APPROVED_RESUMED',
  INBOUND_SIGNAL_SUBMITTED: 'INBOUND_SIGNAL_SUBMITTED',
  INBOUND_SIGNAL_SCANNED: 'INBOUND_SIGNAL_SCANNED',
  INBOUND_SIGNAL_MATCHED: 'INBOUND_SIGNAL_MATCHED',
  INBOUND_SIGNAL_BLOCKED: 'INBOUND_SIGNAL_BLOCKED',
  INBOUND_SIGNAL_FAILED: 'INBOUND_SIGNAL_FAILED',
  // 波一 T5：入金信号合约对不上任何资产——建单之前被拦，留痕拒收
  DEPOSIT_SIGNAL_REJECTED: 'DEPOSIT_SIGNAL_REJECTED',
  DEPOSIT_L1_HELD: 'DEPOSIT_L1_HELD',
  SWAP_QUOTE_CREATED: 'SWAP_QUOTE_CREATED',
  SWAP_CREATED: 'SWAP_CREATED',
  SWAP_L1_BLOCKED: 'SWAP_L1_BLOCKED',
  SWAP_KYT_SUBMITTED: 'SWAP_KYT_SUBMITTED',
  SWAP_KYT_SUBMIT_FAILED: 'SWAP_KYT_SUBMIT_FAILED',
  // Task 6: applyKytVerdict state-transition audits (markStatus itself writes
  // no audit record — the convention in swap-workflow.service.ts is callers audit).
  SWAP_KYT_APPROVED: 'SWAP_KYT_APPROVED',
  SWAP_KYT_REJECTED: 'SWAP_KYT_REJECTED',
  // Review Fix 1 (Important): a KYT verdict arriving after the swap already
  // entered PROCESSING (mirrors WITHDRAW_POST_BROADCAST_VERDICT) — evidence
  // recorded, no state-machine action taken.
  SWAP_POST_APPROVAL_VERDICT: 'SWAP_POST_APPROVAL_VERDICT',
  // Task 7: handleRejectDisposition's single audit record — carries the
  // soft/hard (tipping-off) decision so an investigator can tell after the
  // fact whether the customer was informed and why.
  SWAP_KYT_REJECTED_DISPOSED: 'SWAP_KYT_REJECTED_DISPOSED',
  // 2026-08-20 制裁分主体：兑换单被冻（客户本人命中制裁 / 跨域冻人广播）。
  // 对齐 DEPOSIT_FROZEN(:240) / WITHDRAW_FROZEN(:427)。
  // ⚠️ 只加这一个 —— 充值/提现的 *_UNFROZEN / *_APPROVE_BLOCKED_FROZEN 那几个
  // 是给「FROZEN 有出边」的域用的，兑换 FROZEN 零出边，抄过来就是死常量。
  SWAP_FROZEN: 'SWAP_FROZEN',
  // 第一批 (2026-08-19)：终态忽略分支（applyKytVerdict 的 no-op 兜底，carve-out
  // 之后）补的审计——忽略 ≠ 静默，与充值/提现域镜像。
  SWAP_KYT_VERDICT_IGNORED: 'SWAP_KYT_VERDICT_IGNORED',
  // Review Fix 1 (Important): handleRejectDisposition itself threw (SQLite
  // lock, transient DB error, etc.) — written before rethrowing so the
  // failure is visible in the audit trail even though the ingestion pipeline
  // also records it generically on the SumsubWebhookEvent row.
  SWAP_KYT_REJECTED_DISPOSITION_FAILED: 'SWAP_KYT_REJECTED_DISPOSITION_FAILED',
  // Task 8: SwapSlaService's own audit for a COMPLIANCE_PENDING swap that
  // timed out waiting for a Sumsub verdict (markStatus writes no audit —
  // same convention as the rest of this file). Deliberately NOT paired with
  // a disposition audit — a timeout carries no verdict, so
  // handleRejectDisposition never runs for this path (see swap-sla.service.ts).
  SWAP_SLA_BREACHED: 'SWAP_SLA_BREACHED',
  // Task 6 (SLA 批次)：管理台「模拟超时」按钮 —— 把 slaDeadline 拨到过去，
  // 下次扫描立即破线。operator 触发、改了持久字段，走 recordByActor。
  SWAP_SLA_TIMEOUT_SIMULATED: 'SWAP_SLA_TIMEOUT_SIMULATED',
  SWAP_SUCCEEDED: 'SWAP_SUCCEEDED',
  SWAP_FAILED: 'SWAP_FAILED',
  SWAP_LEG_POSTED: 'SWAP_LEG_POSTED',
  SWAP_LEG_RETRIED: 'SWAP_LEG_RETRIED',
  SWAP_LEG_STUCK: 'SWAP_LEG_STUCK',
  SWAP_LEG_HALTED_BY_RESTRICTION: 'SWAP_LEG_HALTED_BY_RESTRICTION',
  SWAP_LEG_RESUMED: 'SWAP_LEG_RESUMED',
  // Task 9: Demo scenario runner — mirrors DEPOSIT_DEMO_SCENARIO_RUN /
  // WITHDRAW_DEMO_SCENARIO_RUN. Feeds one simulated Sumsub verdict webhook
  // into a swap via the real ingestion pipeline (SUMSUB_MOCK_MODE only).
  SWAP_DEMO_SCENARIO_RUN: 'SWAP_DEMO_SCENARIO_RUN',
  // GREEN arrived for a customer with a sticky hard-line (sanctions) marker —
  // restrictions deliberately held, not lifted. See CustomersService /
  // handleRejectDisposition's hardLineDispositionedAt comments for why this
  // must never be bypassed.
  SWAP_ACTION_GREEN_HARDLINE_HELD: 'SWAP_ACTION_GREEN_HARDLINE_HELD',
  WITHDRAW_CREATED: 'WITHDRAW_CREATED',
  WITHDRAW_L1_BLOCKED: 'WITHDRAW_L1_BLOCKED',
  // V5 Withdrawal Happy Path
  WITHDRAW_REQUESTED: 'WITHDRAW_REQUESTED',
  WITHDRAW_COMPLIANCE_PASSED: 'WITHDRAW_COMPLIANCE_PASSED',
  WITHDRAW_ACCOUNTING_POSTED: 'WITHDRAW_ACCOUNTING_POSTED',
  WITHDRAW_LOCK_RELEASED: 'WITHDRAW_LOCK_RELEASED',
  WITHDRAW_SUCCESS: 'WITHDRAW_SUCCESS',
  // funds_order-driven (Round 2)
  FUNDS_ORDER_ADVANCED: 'FUNDS_ORDER_ADVANCED',
  DEPOSIT_PAYIN_CONFIRMED: 'DEPOSIT_PAYIN_CONFIRMED',
  DEPOSIT_PAYIN_FAILED: 'DEPOSIT_PAYIN_FAILED',
  WITHDRAW_PAYOUT_INITIATED: 'WITHDRAW_PAYOUT_INITIATED',
  WITHDRAW_PAYOUT_CONFIRMED: 'WITHDRAW_PAYOUT_CONFIRMED',
  WITHDRAW_PAYOUT_FAILED: 'WITHDRAW_PAYOUT_FAILED',
  WITHDRAW_APPROVAL_REQUESTED: 'WITHDRAW_APPROVAL_REQUESTED',
  WITHDRAW_APPROVAL_GRANTED: 'WITHDRAW_APPROVAL_GRANTED',
  WITHDRAW_APPROVAL_DECLINED: 'WITHDRAW_APPROVAL_DECLINED',
  // Task 5: Sumsub single-txn submit + applyKytVerdict branches + SLA cron
  WITHDRAW_SUMSUB_SUBMITTED: 'WITHDRAW_SUMSUB_SUBMITTED',
  WITHDRAW_ONHOLD: 'WITHDRAW_ONHOLD',
  // awaitUser 裁决同步之后该单没有任何未提交行(报文整个不带 applicantActions,
  // 或撤回的恰好是全部未提交行)——拒绝进入/停留 ACTION_PENDING,单子保持原状态,
  // 留痕供排查上游报文异常。mirrors DEPOSIT_AWAITUSER_EMPTY_ACTIONS。
  WITHDRAW_AWAITUSER_EMPTY_ACTIONS: 'WITHDRAW_AWAITUSER_EMPTY_ACTIONS',
  WITHDRAW_SLA_BREACHED: 'WITHDRAW_SLA_BREACHED',
  // Task 6 (SLA 批次)：管理台「模拟超时」按钮 —— 把 slaDeadline 拨到过去，
  // 下次扫描立即破线。operator 触发、改了持久字段，走 recordByActor。
  WITHDRAW_SLA_TIMEOUT_SIMULATED: 'WITHDRAW_SLA_TIMEOUT_SIMULATED',
  WITHDRAW_MANUAL_APPROVED: 'WITHDRAW_MANUAL_APPROVED',
  WITHDRAW_FROZEN: 'WITHDRAW_FROZEN',
  WITHDRAW_REFUNDED_BY_TAG: 'WITHDRAW_REFUNDED_BY_TAG',
  // Review Fix 1 (Critical): REJECT_REFUND arriving while FROZEN must not bypass
  // the FROZEN maker-checker — the tag is ignored, this audits the ignored attempt.
  WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED: 'WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED',
  // 第一批(2026-08-19):迟到的 KYT 裁决撞上终态/FROZEN → 忽略。忽略 ≠ 静默,记一条
  // 便于演示与事后取证("系统收到了、判定不适用、记下来了"),原裁决/存证一个字不动。
  // mirrors DEPOSIT_KYT_VERDICT_IGNORED。
  WITHDRAW_KYT_VERDICT_IGNORED: 'WITHDRAW_KYT_VERDICT_IGNORED',
  // 终审必修(2026-08-20):IGNORE 分支撞上迟到的 SANCTION_APPLICANT 裁决 ——
  // 单据状态不该决定"人"要不要被限制。mirrors DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT。
  WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT: 'WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT',
  // Review Fix 2 (Important): a KYT verdict arriving after the payout already
  // broadcast (PAYOUT_PENDING) — evidence recorded, no state-machine action.
  WITHDRAW_POST_BROADCAST_VERDICT: 'WITHDRAW_POST_BROADCAST_VERDICT',
  // Task 6: fee-leg order guard + failure three-rung ladder.
  WITHDRAW_FEE_LEG_REBUILT: 'WITHDRAW_FEE_LEG_REBUILT',
  WITHDRAW_FEE_SETTLE_STUCK: 'WITHDRAW_FEE_SETTLE_STUCK',
  // Task 7: admin bounce entry (PAYOUT_PENDING → RETURNED).
  WITHDRAW_BOUNCED: 'WITHDRAW_BOUNCED',
  // Task 8: FROZEN maker-checker gates (initiate side) — mirrors DEPOSIT_UNFREEZE/DEPOSIT_RETURN.
  WITHDRAW_UNFREEZE_APPROVAL_REQUESTED: 'WITHDRAW_UNFREEZE_APPROVAL_REQUESTED',
  WITHDRAW_SANCTION_REFUND_APPROVAL_REQUESTED: 'WITHDRAW_SANCTION_REFUND_APPROVAL_REQUESTED',
  // Task 9: FROZEN maker-checker gates (execution side) — decided-event handlers.
  WITHDRAW_UNFROZEN: 'WITHDRAW_UNFROZEN',
  // 平账 B 批③：出款成功后被银行退回的认领（INHERIT，照 WITHDRAW_UNFREEZE_*）
  WITHDRAW_RETURN_CLAIM_REQUESTED: 'WITHDRAW_RETURN_CLAIM_REQUESTED',
  WITHDRAW_RETURN_CLAIM_STARTED: 'WITHDRAW_RETURN_CLAIM_STARTED',
  WITHDRAW_RETURNED_AFTER_SUCCESS: 'WITHDRAW_RETURNED_AFTER_SUCCESS',
  WITHDRAW_SANCTION_REFUNDED: 'WITHDRAW_SANCTION_REFUNDED',
  // Task 10: Demo scenario runner — mirrors DEPOSIT_DEMO_SCENARIO_RUN. Feeds a
  // withdrawal through a Sumsub mock verdict fixture (SUMSUB_MOCK_MODE only —
  // endpoint doesn't exist otherwise).
  WITHDRAW_DEMO_SCENARIO_RUN: 'WITHDRAW_DEMO_SCENARIO_RUN',
  // B3(2026-08-29):材料审过(GREEN)后把 ACTION_PENDING 提现单推回 COMPLIANCE_PENDING
  // 重跑合规——镜像充值域 A7 的 DEPOSIT_MATERIAL_APPROVED_RESUMED（见 withdraw-workflow
  // .service.ts 的 onMaterialRequestReviewed）。
  WITHDRAW_MATERIAL_APPROVED_RESUMED: 'WITHDRAW_MATERIAL_APPROVED_RESUMED',
  LP_CONFIG_UPDATED: 'LP_CONFIG_UPDATED',
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_FROZEN: 'CUSTOMER_FROZEN',
  CUSTOMER_UNFROZEN: 'CUSTOMER_UNFROZEN',
  CUSTOMER_DELETED: 'CUSTOMER_DELETED',
  // Capability-scoped trading restrictions (2026-08-13) — written by CustomerRestrictionsService
  CUSTOMER_RESTRICTION_ADDED: 'CUSTOMER_RESTRICTION_ADDED',
  CUSTOMER_RESTRICTION_CLEARED: 'CUSTOMER_RESTRICTION_CLEARED',
  WALLET_STATUS_UPDATED: 'WALLET_STATUS_UPDATED',
  CUSTOMER_DEPOSIT_ADDRESS_CREATED: 'CUSTOMER_DEPOSIT_ADDRESS_CREATED',
  SWAP_QUOTE_CANCELLED: 'SWAP_QUOTE_CANCELLED',
  SWAP_QUOTE_USED: 'SWAP_QUOTE_USED',
  AUDIT_EVIDENCE_EXPORT_REQUESTED: 'AUDIT_EVIDENCE_EXPORT_REQUESTED',
  MANUAL_TB_ACCOUNT_CREATED: 'MANUAL_TB_ACCOUNT_CREATED',
  // Internal Transfer (V7, 2026-06-03)
  // Settlement Batch
  // Generic lifecycle verbs for Outstanding & FeeAccrual (entityType differentiates)
  // ───── Spec #4: INTERNAL_FUND/INTERNAL_TRANSFER short-name actions (CREATED reused from Spec #3)
  // V8 Reconciliation (2026-06-18)
  RECON_CASE_OPENED: 'RECON_CASE_OPENED',
  // Wallet-recon orchestrator Round3 (T5)
  SYSTEM_RECON_RUN_COMPLETED: 'SYSTEM_RECON_RUN_COMPLETED',
  SYSTEM_RECON_CASE_AUTO_HEALED: 'SYSTEM_RECON_CASE_AUTO_HEALED',
  // ── Reconciliation disposition: push-order（平账·推单）──
  RECON_PUSH_ORDER_SYNCED: 'RECON_PUSH_ORDER_SYNCED',
  RECON_PUSH_ORDER_MANUAL: 'RECON_PUSH_ORDER_MANUAL',
  // ── Reconciliation disposition: adjustment（平账·调账单，Task 5）──
  RECON_ADJUSTMENT_POSTED: 'RECON_ADJUSTMENT_POSTED',
  RECON_ADJUSTMENT_DRAFTED: 'RECON_ADJUSTMENT_DRAFTED',
  RECON_DISPOSITION_RECORDED: 'RECON_DISPOSITION_RECORDED',
  // ── 平账 A 批：账龄（spec §2.8）──
  RECON_CASE_AGING_BREACHED: 'RECON_CASE_AGING_BREACHED',
  RECON_AGING_TIMEOUT_SIMULATED: 'RECON_AGING_TIMEOUT_SIMULATED',
  // ── 平账二期（2026-09-05）：内部划转单（V7 财资名册，域 TREASURY）──
  INTERNAL_TRANSFER_REQUESTED: 'INTERNAL_TRANSFER_REQUESTED',
  INTERNAL_TRANSFER_CANCELLED: 'INTERNAL_TRANSFER_CANCELLED',
  INTERNAL_TRANSFER_REJECTED: 'INTERNAL_TRANSFER_REJECTED',
  INTERNAL_TRANSFER_EXECUTION_STARTED: 'INTERNAL_TRANSFER_EXECUTION_STARTED',
  INTERNAL_TRANSFER_LEG_POSTED: 'INTERNAL_TRANSFER_LEG_POSTED',
  INTERNAL_TRANSFER_SETTLED: 'INTERNAL_TRANSFER_SETTLED',
  INTERNAL_TRANSFER_FAILED: 'INTERNAL_TRANSFER_FAILED',
  // ── Material Request Ledger（向客户要材料）──
  MATERIAL_REQUEST_ISSUED: 'MATERIAL_REQUEST_ISSUED',
  MATERIAL_REQUEST_SUBMITTED: 'MATERIAL_REQUEST_SUBMITTED',
  MATERIAL_REQUEST_APPROVED: 'MATERIAL_REQUEST_APPROVED',
  MATERIAL_REQUEST_RETRY_REQUESTED: 'MATERIAL_REQUEST_RETRY_REQUESTED',
  MATERIAL_REQUEST_REJECTED: 'MATERIAL_REQUEST_REJECTED',
  MATERIAL_REQUEST_CANCELLED: 'MATERIAL_REQUEST_CANCELLED',
  MATERIAL_REQUEST_ORDER_UNBOUND: 'MATERIAL_REQUEST_ORDER_UNBOUND',
  // ── 入驻（波二 2026-09-07）──────────────────────────
  ONBOARDING_VERIFICATION_STARTED: 'ONBOARDING_VERIFICATION_STARTED',
  ONBOARDING_SUBMITTED: 'ONBOARDING_SUBMITTED',
  ONBOARDING_LEVEL_CHANGED: 'ONBOARDING_LEVEL_CHANGED',
  ONBOARDING_VERDICT_APPLIED: 'ONBOARDING_VERDICT_APPLIED',
  ONBOARDING_WITHDRAWN: 'ONBOARDING_WITHDRAWN',
  ONBOARDING_REAPPLIED: 'ONBOARDING_REAPPLIED',
  ONBOARDING_ACCEPTANCE_SUBMITTED: 'ONBOARDING_ACCEPTANCE_SUBMITTED',
  ONBOARDING_ACCEPTANCE_DECIDED: 'ONBOARDING_ACCEPTANCE_DECIDED',
  // ── 档位升级（波三 2026-09-07）──────────────────────
  TIER_UPGRADE_APPLIED: 'TIER_UPGRADE_APPLIED',
  TIER_UPGRADE_SUBMITTED: 'TIER_UPGRADE_SUBMITTED',
  TIER_UPGRADE_VERDICT_APPLIED: 'TIER_UPGRADE_VERDICT_APPLIED',
  TIER_UPGRADE_ACCEPTANCE_SUBMITTED: 'TIER_UPGRADE_ACCEPTANCE_SUBMITTED',
  TIER_UPGRADE_ACCEPTANCE_DECIDED: 'TIER_UPGRADE_ACCEPTANCE_DECIDED',
  CUSTOMER_LEDGER_PROVISIONED: 'CUSTOMER_LEDGER_PROVISIONED',
  // ── 平账三期（2026-09-06）：事故登记（治理件，域 GOVERNANCE）──
  INCIDENT_REGISTERED: 'INCIDENT_REGISTERED',
  INCIDENT_INVESTIGATION_STARTED: 'INCIDENT_INVESTIGATION_STARTED',
  INCIDENT_NOTE_ADDED: 'INCIDENT_NOTE_ADDED',
  INCIDENT_ESCALATED: 'INCIDENT_ESCALATED',
  INCIDENT_ASSESSED: 'INCIDENT_ASSESSED',
  INCIDENT_REMEDIATION_LINKED: 'INCIDENT_REMEDIATION_LINKED',
  INCIDENT_REGULATOR_REPORT_DRAFTED: 'INCIDENT_REGULATOR_REPORT_DRAFTED',
  INCIDENT_REGULATOR_REPORTED: 'INCIDENT_REGULATOR_REPORTED',
  INCIDENT_CLOSE_REQUESTED: 'INCIDENT_CLOSE_REQUESTED',
  INCIDENT_CLOSED: 'INCIDENT_CLOSED',
  INCIDENT_WITHDRAWN: 'INCIDENT_WITHDRAWN',
} as const;

// 站4 清扫:十条死词映射(APPROVAL_APPROVED/EXECUTED、ADMIN_INVITATION_*、USER_*、
// AUDIT_EVIDENCE_PACKAGE_*)随词删除——那些词零写入,现役审批/邀请写的是 V1 名册
// (APPROVAL_GRANTED、ADMIN_INVITE_*),其显示翻译归 V1 站。
const AuditRawActionToUserActionMap = {
  [AuditActions.APPROVAL_SUBMITTED]: AuditUserActions.SUBMITTED,
  [AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED]:
    AuditUserActions.REQUEST_CREATED,
} as const;

function normalizePart(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

// 站7：动态迁移码工厂 buildStateTransitionAction 拆除——最后的调用方（治理档案簿）
// 当日改为静态词+fromStatus/toStatus 列；RETIRED_DYNAMIC_TRANSITION_PATTERN 防复发。

export function mapRawAuditActionToUserAction(
  action: string,
): (typeof AuditUserActions)[keyof typeof AuditUserActions] | undefined {
  return AuditRawActionToUserActionMap[
    action as keyof typeof AuditRawActionToUserActionMap
  ];
}


import { AuditCorrelationMode } from '../dto/audit-log.dto';

/** V1 治理四域，声明与下方 assertActionSpec 的退役码放行闸共用同一份 */
export const V1_ACTION_DOMAINS = ['IAM', 'APPROVAL', 'CONFIG', 'AUDIT'] as const;
/** 新合同已入住的全部域——站1b-β 起交易域逐域加入（充值第一个）。机器校验的域闸读这份。 */
export const CONTRACT_ACTION_DOMAINS = [...V1_ACTION_DOMAINS, 'DEPOSIT', 'WITHDRAW', 'SWAP', 'RECON', 'CUSTOMER', 'TREASURY', 'GOVERNANCE'] as const;

export interface AuditActionSpec {
  /** actionDomain 列的值 */
  domain: (typeof CONTRACT_ACTION_DOMAINS)[number];
  /** 开启还是延续旅程——码的固有属性，不随场景变 */
  correlationMode: AuditCorrelationMode;
  /** 该码特有的必填字段（通用必填不在此列） */
  requiredFields: string[];
  /** 异步驱动的码必须带 causationId */
  requiresCausation: boolean;
}

const S = AuditCorrelationMode.START;
const I = AuditCorrelationMode.INHERIT;
const N = AuditCorrelationMode.NONE;

/**
 * V1 治理底座动作词表 —— 45 码，扁平全局唯一，前缀优先命名。
 * 每码出生即定死：新增码时必须当场声明四件事，不允许「先上线回头补」。
 * 一旦有记录用某码写入，再补必填规则时那些历史记录永远残缺且改不了（只增不改）。
 */
export const V1_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  // ── 横切 · 审批引擎（8 个工作流共用）────────────────────────
  APPROVAL_SUBMITTED:  { domain: 'APPROVAL', correlationMode: I, requiredFields: ['policyCode', 'policyVersion'], requiresCausation: false },
  APPROVAL_GRANTED:    { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: false },
  APPROVAL_DECLINED:   { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  APPROVAL_CANCELLED:  { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  APPROVAL_EXPIRED:    { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: false },
  APPROVAL_SOD_DENIED: { domain: 'APPROVAL', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
  APPROVAL_TIMEOUT_SIMULATED: { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: false },

  // ── 权限守卫拒绝（2026-09-01 法一纪律4：被拒绝的动作同样留痕）──────
  ADMIN_ACCESS_DENIED: { domain: 'IAM', correlationMode: N, requiredFields: [], requiresCausation: false },

  // ── 常规登录 · MFA 二次校验（2026-09-02 Task 15 收尾）：区别于下方 ② 首次登录四步链——
  // 这是已绑定 MFA 的老用户每次登录都要走的校验，mfa-binding-workflow.service.ts 的
  // verifyMfaLogin() 单步独立写，前面没有 REQUESTED/IDENTITY_CONFIRMED 之类的 START 步
  // 铸 correlationId。auth.service.ts:39-41 显式注释 authTraceId（此处的 loginTraceId）
  // 只用来把 mfa_session token 与本次 login() 调用串起来，「与审计无关」——不是持久化的
  // 旅程标识，不能拿来硬凑 INHERIT，同 ADMIN_ACCESS_DENIED 一样判 NONE。原附册（已删除
  // 的旧治理常量）ADMIN_FIRST_LOGIN 分组下两码，码值不变，本行只是进合同。
  MFA_LOGIN_VERIFIED:      { domain: 'IAM', correlationMode: N, requiredFields: ['authnMethod'], requiresCausation: false },
  // 系统主动挡（TOTP 码核验不过，动作压根没执行成）——同令牌失效判 DENIED 而非「试了
  // 但技术上没成」的 FAILED；locked 与否只是同一原因下的细节，落 metadata 不拆码。
  MFA_LOGIN_VERIFY_FAILED: { domain: 'IAM', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },

  // ── ① 入职邀请 ──────────────────────────────────────────
  ADMIN_INVITE_REQUESTED:  { domain: 'IAM', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  ADMIN_INVITE_DISPATCHED: { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_INVITE_ACCEPTED:   { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  ADMIN_INVITE_EXPIRED:    { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_INVITE_CANCELLED:  { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },

  // ── ② 首次登录（四步）───────────────────────────────────
  ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED: { domain: 'IAM', correlationMode: S, requiredFields: ['authnMethod'], requiresCausation: false },
  ADMIN_FIRST_LOGIN_MFA_INITIATED:      { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_FIRST_LOGIN_MFA_BOUND:          { domain: 'IAM', correlationMode: I, requiredFields: ['authnMethod'], requiresCausation: false },
  ADMIN_FIRST_LOGIN_COMPLETED:          { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },

  // ── ③ 角色绑定变更 ──────────────────────────────────────
  ADMIN_ROLE_CHANGE_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: [], requiresCausation: false },
  ADMIN_ROLE_CHANGE_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  ADMIN_ROLE_CHANGE_CANCELLED: { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ④⑤ 停用 / 恢复（代码里无取消路径，刻意不加 CANCELLED）──
  ADMIN_SUSPENSION_REQUESTED:   { domain: 'IAM', correlationMode: S, requiredFields: ['reason'], requiresCausation: false },
  ADMIN_SUSPENSION_APPLIED:     { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus', 'approvalNo'], requiresCausation: true },
  ADMIN_REACTIVATION_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: ['reason'], requiresCausation: false },
  ADMIN_REACTIVATION_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus', 'approvalNo'], requiresCausation: true },

  // ── ⑥ 密码重置（自助 / 官员代操作两条路各自成链）──────────
  ADMIN_PASSWORD_RESET_SELF_REQUESTED:    { domain: 'IAM', correlationMode: S, requiredFields: [], requiresCausation: false },
  ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED: { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_PASSWORD_RESET_SELF_COMPLETED:    { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_PASSWORD_RESET_OFFICER_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: ['onBehalfOfNo'], requiresCausation: false },
  ADMIN_PASSWORD_RESET_OFFICER_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['onBehalfOfNo', 'approvalNo'], requiresCausation: true },
  ADMIN_PASSWORD_RESET_CANCELLED:         { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },

  // ── ⑦ MFA 重置 ─────────────────────────────────────────
  ADMIN_MFA_RESET_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: ['onBehalfOfNo'], requiresCausation: false },
  ADMIN_MFA_RESET_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus', 'approvalNo'], requiresCausation: true },
  ADMIN_MFA_RESET_CANCELLED: { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑧ 账号锁定 / 解锁（业主裁定：连续失败自动锁定算业务审计）─
  ADMIN_ACCOUNT_LOCK_APPLIED:  { domain: 'IAM', correlationMode: S, requiredFields: ['reasonCode', 'fromStatus', 'toStatus'], requiresCausation: false },
  ADMIN_ACCOUNT_LOCK_RELEASED: { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },

  // ── ⑨ 角色定义（建 / 改）────────────────────────────────
  ROLE_DEFINITION_CREATE_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  ROLE_DEFINITION_CREATE_APPLIED:   { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  ROLE_DEFINITION_CREATE_CANCELLED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  ROLE_DEFINITION_MODIFY_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  ROLE_DEFINITION_MODIFY_APPLIED:   { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  ROLE_DEFINITION_MODIFY_CANCELLED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑩ 审批策略变更（改策略自身走策略自己审批）──────────────
  APPROVAL_POLICY_CHANGE_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  APPROVAL_POLICY_CHANGE_APPLIED:   { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'policyVersion', 'approvalNo'], requiresCausation: true },

  // ── 兑换费率等级（2026-09-01 换名册：裸名跨族撞车 → 前缀唯一）────
  SWAP_FEE_LEVEL_CREATION_REQUESTED:     { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_CREATION_APPLIED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_CREATION_APPLY_FAILED:  { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  SWAP_FEE_LEVEL_CREATION_CANCELLED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_REQUESTED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_CHANGE_APPLIED:         { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED:    { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // 波一新增：退役等级（"删" = 终态）。REQUESTED 铸 correlationId（S）；RETIRED / RETIRE_CANCELLED 经审批决定事件 INHERIT + causationId。
  SWAP_FEE_LEVEL_RETIRE_REQUESTED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  SWAP_FEE_LEVEL_RETIRED:                { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_RETIRE_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // ── 提现费率等级 ────────────────────────────────────────
  WITHDRAWAL_FEE_LEVEL_CREATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_CREATION_APPLIED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CREATION_APPLY_FAILED: { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CREATION_CANCELLED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_CHANGE_APPLIED:        { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_APPLY_FAILED:   { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // 波一新增：退役等级（"删" = 终态）。REQUESTED 铸 correlationId（S）；RETIRED / RETIRE_CANCELLED 经审批决定事件 INHERIT + causationId。
  WITHDRAWAL_FEE_LEVEL_RETIRE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_RETIRED:               { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_RETIRE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── 资产两族（2026-09-01 换名册·批二 ASSET_SUSPENSION_*/ASSET_REACTIVATION_* 六码，
  // 2026-09-04 波一 T2 收窄）：创建 + 激活两族（ASSET_CREATED_AND_PROVISIONED/
  // ASSET_CREATION_FAILED/ASSET_PROVISIONING_UPDATED/ASSET_ACTIVATION_REQUESTED/
  // ASSET_ACTIVATED/ASSET_ACTIVATION_FAILED 六码）随上架/激活整条路退役
  // （业主定「本轮不做新资产上线」），迁入 DEPRECATED_AUDIT_ACTIONS（见下方）；
  // 暂停 / 恢复两族原样保留。
  ASSET_SUSPENSION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_SUSPENDED:               { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_SUSPENSION_FAILED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  ASSET_REACTIVATION_REQUESTED:  { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_REACTIVATED:             { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_REACTIVATION_FAILED:     { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },

  // ── 交易限额规则（2026-09-02 换名册·批三）：CREATION_/CHANGE_ 两族裸名跨族撞车
  // （同 8 个裸词也被费率两域用过，Task 12 已把费率四族迁走），本批改前缀唯一新码，
  // 8 个裸名同批登退役（见下方 DEPRECATED_AUDIT_ACTIONS；'CHANGE_APPLY_FAILED' 早前
  // 已在站7批次登过，不重复登记）。
  TRANSACTION_LIMIT_CHANGE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_CHANGE_APPLIED:        { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_APPLY_FAILED:   { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // L1 金额限额拦截运行时事件——发生在客户的提现/兑换单据出生之前（gate 挡在订单
  // persist 之前，见 withdraw-workflow.service.ts:327 / swap-workflow.service.ts:220
  // 调用点），此刻没有旅程可继承，correlationMode 定 NONE——同 ADMIN_ACCESS_DENIED
  // 一样，守卫拒绝发生在任何旅程开始之前，没有 correlationId 可读。
  TRANSACTION_LIMIT_REJECTED: { domain: 'CONFIG', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },

  // ── 客户标签（2026-09-02 换名册·批三）：assign/revoke 都是单步动作，不经
  // createAndSubmit 审批旅程，没有 START 步铸的 correlationId 可继承，correlationMode
  // 定 NONE（同 V2_CUSTOMER_AUDIT_ACTIONS 整册客户级动作一样，客户级件无订单旅程）。
  CUSTOMER_TAG_ASSIGNED: { domain: 'CONFIG', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  CUSTOMER_TAG_REVOKED:  { domain: 'CONFIG', correlationMode: N, requiredFields: ['beforeData', 'reason'], requiresCausation: false },

  // ── 客户提现地址·24h 冷却闸（2026-09-02 换名册·批四）：REGISTERED 是地址自己的
  // traceId 起点（S，创建时铸号存 WithdrawalAddress.traceId 列）；后续五码都是单步
  // 管理/客户操作、无审批引擎，INHERIT 回读同一枚persisted traceId，故 requiresCausation
  // 全 false（不是被某个异步事件驱动，是直接动作，同 asset-suspension 判例的 REQUESTED
  // 反过来——这里连 REQUESTED 都没有，是直接执行）。SUSPENDED 已有 reason 参数只是没提
  // 到顶层；CANCELLED/DEACTIVATED/COOLING_SKIPPED 三个调用点原来完全没有 reason——
  // Task 15 连带给 cancelAddress/deactivateAddress/skipCoolingPeriod 三个 service 方法
  // 加 reason 必填参数 + controller 加 @Body + client-web 的 deactivate 弹窗、admin-web
  // 的 skip-cooling 弹窗补理由输入框（cancelAddress 当下无任何前端/脚本调用方，只补
  // 后端能力）。MANUAL_COOLING_SKIP 改名 WITHDRAWAL_ADDRESS_COOLING_SKIPPED——后门
  // 端点强制留痕理由，是这条码要讲的演示点。
  WITHDRAWAL_ADDRESS_REGISTERED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_ACTIVATED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAWAL_ADDRESS_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_SUSPENDED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_DEACTIVATED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_COOLING_SKIPPED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // 波一新增：改标签 / 收款人（客户单步，INHERIT 地址自己的 traceId）；管理员恢复（补 D5 出边）
  WITHDRAWAL_ADDRESS_UPDATED:         { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_UNSUSPENDED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // 波二：地址五门（ADDRESS_LIMIT_REACHED / COOLING_PERIOD_NOT_EXPIRED / LAST_ACTIVE_FIAT_ADDRESS /
  // ADDRESS_HAS_INFLIGHT_WITHDRAWAL / NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS）拒绝留痕，reasonCode = 门的 code
  WITHDRAWAL_ADDRESS_REQUEST_DENIED: { domain: 'CONFIG', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },

  // ── 种子身世（波一，spec §8）：配置随版本装载，装载即留痕——第七幕按 USDT 查，第一行是"随版本上架"。
  // 种子跑在 Nest 之外，由 prisma/seed-audit.helper.ts 直写：actorType SYSTEM、actorNo RELEASE（业务种子）/ DEMO_SEED（演示客户造数），
  // metadata { seedVersion, commit }。每条装载都是自己旅程的起点 → START。
  ASSET_SEEDED:                    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  CUSTODIAN_WALLET_SEEDED:         { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_SEEDED:        { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_SEEDED:           { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_SEEDED:     { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  CUSTOMER_DEPOSIT_ADDRESS_SEEDED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_SEEDED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },

  // ── ⑪ 审计日志自身的操作 ────────────────────────────────
  AUDIT_EVIDENCE_EXPORT_REQUESTED:  { domain: 'AUDIT', correlationMode: S, requiredFields: [], requiresCausation: false },
  AUDIT_EVIDENCE_EXPORT_GENERATED:  { domain: 'AUDIT', correlationMode: I, requiredFields: ['payloadDigest'], requiresCausation: true },
  AUDIT_EVIDENCE_EXPORT_DOWNLOADED: { domain: 'AUDIT', correlationMode: I, requiredFields: ['sourceIp'], requiresCausation: false },
  AUDIT_LOG_QUERIED:                { domain: 'AUDIT', correlationMode: N, requiredFields: [], requiresCausation: false },

  // ── ⑫ 站7 收编：审批缺失告警（监管义务闸 + 五本档案簿已整块退役，见下方注释）──
  APPROVAL_REQUIRED_MISSING:        { domain: 'APPROVAL', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
  // REGULATORY_GATE_CREATED/UPDATED/SUBMITTED/FEEDBACK_RECORDED/RECEIPT_BOUND/
  // MARKED_EFFECTIVE/REVOKED（7 码）、SHAREHOLDING_REGISTRY_CREATED/UPDATED、
  // APPOINTMENT_RECORD_CREATED/UPDATED、TRAINING_RECORD_CREATED/UPDATED、
  // CONFLICT_DISCLOSURE_CREATED/UPDATED、WIND_DOWN_MATERIAL_CREATED/UPDATED
  // （五本档案簿各 2 码，合 10 码）：2026-08-30 随监管闸门与五本档案簿整块退役
  // （第一幕职权重划，业主定「演示不讲」），写点 regulatory-gates.service.ts /
  // governance-registries.service.ts 均已整文件删除（commit 36c944ce），全仓
  // 零消费方（2026-08-31 grep 核实），迁入 DEPRECATED_AUDIT_ACTIONS，本组已删。

  // ── ⑬ 站7 收编：平台运营件（金库/资金单模拟推进；手工建户与对手方已退役见下方注释）──
  // WALLET_STATUS_UPDATED：2026-09-04 波一 T4 随钱包状态开关整条路退役（平台钱包只从
  // 种子来、管理台只读），迁入 DEPRECATED_AUDIT_ACTIONS（见下方），本组已删。
  // MANUAL_TB_ACCOUNT_CREATED：2026-08-31 随手工开账本科目退役（业主定「账本
  // 没有手动配置这回事」），写点 TbManualAccountService（tb-manual-account.
  // service.ts）已整文件删除（commit 3ed5a10f），全仓零消费方（2026-08-31 grep
  // 核实），迁入 DEPRECATED_AUDIT_ACTIONS，已删。
  // LP_CONFIG_UPDATED：2026-08-30 随流动性提供商与报价配置整块退役（第一幕职权
  // 重划，保留交易域 KYT 对手方概念），写点 liquidity-config.service.ts 已整
  // 文件删除（commit 2f0e7c3f），全仓零消费方（2026-08-31 grep 核实），迁入
  // DEPRECATED_AUDIT_ACTIONS，已删。
  FUNDS_ORDER_ADVANCED:             { domain: 'CONFIG', correlationMode: N, requiredFields: [], requiresCausation: false },
};

/**
 * 退役码：标记 deprecated、不再允许新写入、历史仍可读。不是删除。
 * 7 个 *_FAILED 收编进 outcome=FAILED + reasonCode；4 个登录码归安全日志（③）。
 *
 * ⚠️ 这些都是老命名法裸词，不是扁平全局唯一——'CHANGE_APPLY_FAILED' 此前同时被
 * TRANSACTION_LIMIT_CHANGE / SWAP_FEE_LEVEL_CHANGE / WITHDRAWAL_FEE_LEVEL_CHANGE
 * 三个保留（非 V1）域复用；三个原复用方已分别在 Task 12（费率两域）/ Task 14（限额）
 * 迁走，改写前缀唯一新码，不再触碰这个裸词。名单里其余码此刻仍可能有真实调用方在写
 * （迁移是 Task 5-9 的事），因此 assertActionSpec 里对这份名单的拦截刻意加了
 * actionDomain 网关，见该方法注释。
 */
/**
 * 充值域名册（站1b-β，2026-08-26，业主终审版 31 码）。
 * 设计稿：doc-final/superpowers/specs/2026-08-26-deposit-audit-vocab-design.md
 * 要点：*_FAILED 不铸码（outcome+reasonCode 表达）；「放行」一码四态
 * （成功/翻案走 from 列/冻结拒批 DENIED/记账失败 FAILED）；动态迁移码族废除
 * （状态变化进 from/to 两列）；三停摆一名三因；一笔充值一段旅程
 * （CREATED=START 铸号落单，其余 INHERIT）。
 */
export const V4_DEPOSIT_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  // ── 主线（6）──────────────────────────────────────────────
  DEPOSIT_CREATED:        { domain: 'DEPOSIT', correlationMode: S, requiredFields: ['amount', 'currency', 'ownerCustomerNo'], requiresCausation: false },
  DEPOSIT_PAYIN_COMPLETED:{ domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_HELD:           { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
  // 波二（2026-09-05）：L1 行政级问题打标不换状态、照常送检；这一行是打标当刻的证据（KYT 若随后拒绝，它是「暂停曾拦下它」的唯一审计痕）
  DEPOSIT_L1_HELD:        { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
  DEPOSIT_SUMSUB_SUBMITTED:{ domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_APPROVED:       { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_LIMIT_WAIVED:   { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // ── 裁决与复核（5）────────────────────────────────────────
  DEPOSIT_ONHOLD:         { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_MANUAL_CHECKING:{ domain: 'DEPOSIT', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
  DEPOSIT_FROZEN:         { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_ACTION_REQUIRED:{ domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // A7:DEPOSIT_ACTION_REQUIRED 的回边——材料补齐、合规重筛。requiredFields 只列
  // fromStatus/toStatus(与其对偶动作同款):depositAudit() 的 input 构造里没有裸
  // requestNo 顶层字段,它进 metadata,不进 requiredFields 校验的字段集。
  DEPOSIT_MATERIAL_APPROVED_RESUMED: { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_KYT_VERDICT_IGNORED: { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // ── 处置四弧（17）────────────────────────────────────────
  DEPOSIT_CONFISCATION_REQUESTED: { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_RETURN_REQUESTED:       { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_SEIZE_REQUESTED:        { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_UNFREEZE_REQUESTED:     { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_CONFISCATION_STARTED:   { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  DEPOSIT_RETURN_STARTED:         { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  DEPOSIT_SEIZE_STARTED:          { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  DEPOSIT_CONFISCATION_RETRIED:   { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_RETURN_RETRIED:         { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_SEIZE_RETRIED:          { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_CONFISCATION_EXECUTED:  { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_RETURNED:               { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_SEIZED:                 { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // ── 平账 B 批 · 补单（10）────────────────────────────────
  DEPOSIT_SUPPLEMENT_REQUESTED:   { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
  DEPOSIT_SUPPLEMENT_STARTED:     { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  DEPOSIT_SUPPLEMENT_REJECTED:    { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  DEPOSIT_SUPPLEMENTED:           { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['depositNo'], requiresCausation: false },
  DEPOSIT_CLAWBACK_REQUESTED:     { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_CLAWBACK_STARTED:       { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  DEPOSIT_CLAWED_BACK:            { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  DEPOSIT_CONFISCATION_STUCK:     { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_RETURN_STUCK:           { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_SEIZE_STUCK:            { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_UNFROZEN:               { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  // ── SLA 与演示（3）───────────────────────────────────────
  DEPOSIT_SLA_BREACHED:           { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['fromStatus'], requiresCausation: false },
  DEPOSIT_SLA_TIMEOUT_SIMULATED:  { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  DEPOSIT_DEMO_SCENARIO_RUN:      { domain: 'DEPOSIT', correlationMode: I, requiredFields: [], requiresCausation: false },
  // ── 站7 收编：入账信号（撞库匹配在建单之前，无旅程可继承→NONE）＋充值地址供给
  //（CREATE_FAILED 并入双结局：失败=outcome+reasonCode，旧名进退役闸）──
  INBOUND_SIGNAL_SUBMITTED:       { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
  INBOUND_SIGNAL_SCANNED:         { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
  INBOUND_SIGNAL_MATCHED:         { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
  INBOUND_SIGNAL_BLOCKED:         { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
  INBOUND_SIGNAL_FAILED:          { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
  // 合约对不上任何资产的入金信号：建单之前被拦、没有旅程 → NONE；outcome=DENIED + reasonCode=UNKNOWN_ASSET
  DEPOSIT_SIGNAL_REJECTED:        { domain: 'DEPOSIT', correlationMode: N, requiredFields: [], requiresCausation: false },
  // 客户在某网络上开收款地址（波一：钱包表唯一写路径；actor=客户）。单步动作、无旅程可继承 → NONE；
  // 失败并入双结局（outcome=FAILED + reasonCode=PROVISION_ERROR）。
  CUSTOMER_DEPOSIT_ADDRESS_CREATED: { domain: 'DEPOSIT', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
};

/**
 * 站2-β（2026-08-27）提现域名册——25 码，业主终审版。承接充值域全部裁定：
 * 失败不起名（outcome+reasonCode）｜同动作不因语境拆名｜动态迁移族废除（从/到两列）｜
 * CREATED=旅程起点铸 correlationId，其余全 INHERIT｜锁释放并入落地行（metadata 携解锁金额）。
 * 与充值的结构差（钱后动拆三码/大额前置闸/费用尾巴/退票/在途裁决窗口）见
 * doc-final/superpowers/specs/2026-08-27-withdraw-audit-vocab-design.md。
 */
export const V5_WITHDRAW_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  // ── 出生（1）────────────────────────────────────────────
  WITHDRAW_CREATED:         { domain: 'WITHDRAW', correlationMode: S, requiredFields: ['amount', 'currency', 'ownerCustomerNo'], requiresCausation: false },
  // 波二：L1 拦下留痕（单未建、无单号；主体=客户；次主体 RELATED=资产）
  WITHDRAW_L1_BLOCKED:      { domain: 'WITHDRAW', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },
  // ── 大额闸（3）──────────────────────────────────────────
  WITHDRAW_LARGE_VALUE_REQUESTED: { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_LARGE_VALUE_PASSED:    { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['approvalNo', 'fromStatus', 'toStatus'], requiresCausation: true },
  WITHDRAW_REJECTED:              { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['approvalNo', 'fromStatus', 'toStatus'], requiresCausation: true },
  // ── 合规流转（8）────────────────────────────────────────
  WITHDRAW_SUMSUB_SUBMITTED:      { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_ONHOLD:                { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_MANUAL_CHECKING:       { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  WITHDRAW_ACTION_REQUIRED:       { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // B3:WITHDRAW_ACTION_REQUIRED 的回边——材料补齐、合规重筛。requiredFields 只列
  // fromStatus/toStatus(与其对偶动作同款):withdrawAudit() 的 input 构造里没有裸
  // requestNo 顶层字段,它进 metadata,不进 requiredFields 校验的字段集。
  WITHDRAW_MATERIAL_APPROVED_RESUMED: { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  WITHDRAW_FROZEN:                { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  WITHDRAW_KYT_VERDICT_IGNORED:   { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAW_POST_BROADCAST_VERDICT:{ domain: 'WITHDRAW', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAW_COMPLIANCE_PASSED:     { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // ── 付款与终局（4）──────────────────────────────────────
  WITHDRAW_PAYOUT_INITIATED:      { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  // 一码双结局：成功=外部确认+落账（不迁状态，故无从/到必填）；失败=整单败+解锁（自愿携从/到）
  WITHDRAW_PAYOUT_COMPLETED:      { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_BOUNCED:               { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  WITHDRAW_SUCCESS:               { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // ── 费用尾巴（2）────────────────────────────────────────
  WITHDRAW_FEE_RETRIED:           { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_FEE_STUCK:             { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  // ── 冻结处置（4）────────────────────────────────────────
  WITHDRAW_UNFREEZE_REQUESTED:    { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_UNFROZEN:              { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  WITHDRAW_RETURN_CLAIM_REQUESTED: { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_RETURN_CLAIM_STARTED:   { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  WITHDRAW_RETURNED_AFTER_SUCCESS: { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  WITHDRAW_REFUND_REQUESTED:      { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  // 两个门共用（官员标签路无审批因果，故不强制；审批路自愿携 approvalNo+causationId）
  WITHDRAW_REFUNDED:              { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // ── SLA 与演示（3）──────────────────────────────────────
  WITHDRAW_SLA_BREACHED:          { domain: 'WITHDRAW', correlationMode: I, requiredFields: ['fromStatus'], requiresCausation: false },
  WITHDRAW_SLA_TIMEOUT_SIMULATED: { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAW_DEMO_SCENARIO_RUN:     { domain: 'WITHDRAW', correlationMode: I, requiredFields: [], requiresCausation: false },
};

/**
 * 站3-β（2026-08-27）兑换域名册——18 码，业主终审版。承接前两域全部裁定；
 * 兑换无 maker-checker 弧故全册 requiresCausation=false。三处 *_FAILED 并入
 * 各自动作的一码双结局；tipping-off 决策留痕（REJECTED_DISPOSED）为独立业务事件保留。
 * 出生锁联动：CREATED 携 lockedFromAmount，REJECTED/FROZEN 携 releasedFromAmount
 * （metadata，非机器必填）。设计稿见 doc-final/superpowers/specs/2026-08-27-swap-audit-vocab-design.md。
 */
export const V6_SWAP_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  // ── 出生（1）────────────────────────────────────────────
  SWAP_CREATED:              { domain: 'SWAP', correlationMode: S, requiredFields: ['amount', 'currency', 'ownerCustomerNo'], requiresCausation: false },
  SWAP_L1_BLOCKED:           { domain: 'SWAP', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },
  // ── KYT 合规（5）────────────────────────────────────────
  SWAP_KYT_SUBMITTED:        { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  SWAP_KYT_APPROVED:         { domain: 'SWAP', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  SWAP_KYT_REJECTED:         { domain: 'SWAP', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  SWAP_KYT_VERDICT_IGNORED:  { domain: 'SWAP', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  SWAP_POST_APPROVAL_VERDICT:{ domain: 'SWAP', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // ── 拒绝处置与通知决策（1）──────────────────────────────
  SWAP_KYT_REJECTED_DISPOSED:{ domain: 'SWAP', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // ── 冻结（1）────────────────────────────────────────────
  SWAP_FROZEN:               { domain: 'SWAP', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // ── 结算四腿（5）────────────────────────────────────────
  SWAP_LEG_POSTED:           { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  SWAP_LEG_RETRIED:          { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  SWAP_LEG_STUCK:            { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  SWAP_LEG_RESUMED:          { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  SWAP_LEG_HALTED_BY_RESTRICTION: { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  // ── 终局（1）────────────────────────────────────────────
  SWAP_SUCCEEDED:            { domain: 'SWAP', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // ── 客户级（1）──────────────────────────────────────────
  SWAP_ACTION_GREEN_HARDLINE_HELD: { domain: 'SWAP', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  // ── SLA 与演示（3）──────────────────────────────────────
  SWAP_SLA_BREACHED:         { domain: 'SWAP', correlationMode: I, requiredFields: ['fromStatus'], requiresCausation: false },
  SWAP_SLA_TIMEOUT_SIMULATED:{ domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  SWAP_DEMO_SCENARIO_RUN:    { domain: 'SWAP', correlationMode: I, requiredFields: [], requiresCausation: false },
  // ── 站7 收编：报价三码（报价先于兑换单出生，无旅程可继承→NONE）──
  SWAP_QUOTE_CREATED:        { domain: 'SWAP', correlationMode: N, requiredFields: [], requiresCausation: false },
  SWAP_QUOTE_USED:           { domain: 'SWAP', correlationMode: N, requiredFields: [], requiresCausation: false },
  SWAP_QUOTE_CANCELLED:      { domain: 'SWAP', correlationMode: N, requiredFields: [], requiresCausation: false },
};

/**
 * V8 对账域名册（站5-β，2026-08-27 业主终审版）——5 旧词 → 4 码。
 * 对账件（跑批/案件）天生无客户旅程 → NONE；唯推单落在父单（充值/提现）
 * 的旅程里 → INHERIT。CASE_OPENED 的破口三件套（walletRef/bucket/deltaAmount）
 * 在 metadata——机器闸只查信封顶层，真正的强制在写方法 auditCaseOpened 的
 * TS 签名上（编译期兜底）。
 * RUN_COMPLETED 双通道：cron 走系统通道，管理员触发走操作员通道——
 * 同动作不因语境拆名，谁跑的落 actor 字段。
 */
export const V8_RECON_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  RECON_RUN_COMPLETED:    { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
  RECON_CASE_OPENED:      { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
  RECON_CASE_AUTO_HEALED: { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
  // 合并 SYNCED+MANUAL（同动作不因语境拆名；manualConfirm/证据三件套在 metadata）
  RECON_PUSH_ORDER:       { domain: 'RECON', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  // Task 5 —— 调账单落账（审批通过后一次性记账，继承案件旅程 correlationId，同 RECON_PUSH_ORDER）。
  // requiredFields 只列 AuditLogEvent 真有的顶层列——'direction' 不是一列（评审逮到：
  // 若把它列进来，这条要求永远满足不了，只能塞 metadata），direction 留在 metadata 里。
  RECON_ADJUSTMENT_POSTED: { domain: 'RECON', correlationMode: I, requiredFields: ['reasonCode', 'amount', 'effectiveDate'], requiresCausation: false },
  // 开单（四族通用，DRAFT 阶段无审批件，铁律①要求每个持久化动作留痕——销 BACKLOG「createDraft 零审计」）
  RECON_ADJUSTMENT_DRAFTED: { domain: 'RECON', correlationMode: N, requiredFields: ['reasonCode', 'amount'], requiresCausation: false },
  // 定性 / 覆盖重定（spec §3.2）——对账件无客户旅程，N 模式同 RECON_CASE_OPENED
  RECON_DISPOSITION_RECORDED: { domain: 'RECON', correlationMode: N, requiredFields: ['causeCode', 'outlet'], requiresCausation: false },
  // 平账 A 批（spec §2.8）——账龄到线（系统通道，actor AGING_TIMER；主对象 caseNo，
  // slaDeadline / ageDays / bucket / book / severity 落 metadata）。软破线：状态不动。
  RECON_CASE_AGING_BREACHED: { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
  // ⚡拨钟（操作员通道）——演示者把账龄截止拨到过去；镜像 DEPOSIT_SLA_TIMEOUT_SIMULATED。
  // 拨钟一条、到线一条，两条审计各说各的事。
  RECON_AGING_TIMEOUT_SIMULATED: { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
};

/**
 * V2 客户域名册（站6-β，2026-08-27 业主方案2 后的存活面）——28 现役词（波二 2026-09-07 +8 入驻，波三 2026-09-07 +6 档位升级），
 * 现名全保守零改名。客户级件无订单旅程 → 全员 NONE；材料请求绑单时机会性携带
 * 父单旅程号（不设 INHERIT 硬闸：请求可无单发起，码的模式是固有属性不看场景）。
 * 便签四词双通道（系统命中 recordSystem / 运营贴撕 recordByActor）。
 */
export const V2_CUSTOMER_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  // ── 客户主档（3）──────────────────────────────────────
  CUSTOMER_CREATED:              { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['ownerCustomerNo'], requiresCausation: false },
  CUSTOMER_UPDATED:              { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  CUSTOMER_DELETED:              { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  // ── 限制便签（4）──────────────────────────────────────
  CUSTOMER_RESTRICTION_ADDED:    { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  CUSTOMER_RESTRICTION_CLEARED:  { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  CUSTOMER_FROZEN:               { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  CUSTOMER_UNFROZEN:             { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  // ── 材料请求（7）──────────────────────────────────────
  MATERIAL_REQUEST_ISSUED:       { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
  MATERIAL_REQUEST_SUBMITTED:    { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  MATERIAL_REQUEST_APPROVED:     { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  MATERIAL_REQUEST_RETRY_REQUESTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  MATERIAL_REQUEST_REJECTED:     { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  MATERIAL_REQUEST_CANCELLED:    { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
  MATERIAL_REQUEST_ORDER_UNBOUND:{ domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  // ── 入驻（8，波二 2026-09-07）：客户级件无订单旅程，correlationMode 全 N ──
  ONBOARDING_VERIFICATION_STARTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  ONBOARDING_SUBMITTED:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  ONBOARDING_LEVEL_CHANGED:        { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  ONBOARDING_VERDICT_APPLIED:      { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  ONBOARDING_WITHDRAWN:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  ONBOARDING_REAPPLIED:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  ONBOARDING_ACCEPTANCE_SUBMITTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  ONBOARDING_ACCEPTANCE_DECIDED:   { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  // ── 档位升级（6，波三 2026-09-07）：客户级件，correlationMode 全 N ──
  TIER_UPGRADE_APPLIED:              { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  TIER_UPGRADE_SUBMITTED:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  TIER_UPGRADE_VERDICT_APPLIED:      { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  TIER_UPGRADE_ACCEPTANCE_SUBMITTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  TIER_UPGRADE_ACCEPTANCE_DECIDED:   { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  CUSTOMER_LEDGER_PROVISIONED:       { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
};

/**
 * V7 财资名册（平账二期，2026-09-05）——内部划转单七码。主对象一律 INTERNAL_TRANSFER · transferNo，
 * 子主体：客户 OWNER、对账案 RELATED、认损调账单 RELATED（仅补款）、审批单 INSTRUMENT。
 * REQUESTED 起划转单自己的旅程（NONE），其余继承（INHERIT）；批准 / 拒绝由审批裁决驱动带因果。
 * 划转单是公司自己的钱在动，故域是 TREASURY 不是 RECON——案子只是入口，主体是财资件。
 */
export const V7_TREASURY_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  INTERNAL_TRANSFER_REQUESTED:         { domain: 'TREASURY', correlationMode: N, requiredFields: ['amount', 'reason'], requiresCausation: false },
  INTERNAL_TRANSFER_CANCELLED:         { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  INTERNAL_TRANSFER_REJECTED:          { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  INTERNAL_TRANSFER_EXECUTION_STARTED: { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  INTERNAL_TRANSFER_LEG_POSTED:        { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false },
  INTERNAL_TRANSFER_SETTLED:           { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount', 'effectiveDate'], requiresCausation: false },
  INTERNAL_TRANSFER_FAILED:            { domain: 'TREASURY', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
};

/**
 * 治理域名册（平账三期 · 事故登记，2026-09-06）——事故 Incident 十一码，域 GOVERNANCE
 * （spec §7 业主拍板）。主对象一律 INCIDENT · incidentNo。
 * REGISTERED 起事故自己的旅程（S，铸 traceId）；CLOSE_REQUESTED / CLOSED 是结案两步
 * maker-checker，继承同一旅程（I），CLOSED 由审批裁决驱动带因果、必填 approvalNo。
 * 中段八个（调查开始 / 记笔记 / 升级 / 定损 / 挂善后 / 通报草案 / 已通报 / 撤回）都是
 * 运营对事故单的直接一次性操作——不经 createAndSubmit 审批旅程，没有 START 步铸的
 * correlationId 可继承，correlationMode 定 NONE，不伪造关联（二期判例：同
 * CUSTOMER_TAG_ASSIGNED/REVOKED 一样，单步动作没有旅程可继承时老实标 NONE）。
 */
export const INCIDENT_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  INCIDENT_REGISTERED:               { domain: 'GOVERNANCE', correlationMode: S, requiredFields: ['type'], requiresCausation: false },
  INCIDENT_INVESTIGATION_STARTED:    { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  INCIDENT_NOTE_ADDED:               { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['body'], requiresCausation: false },
  // escalatedTo：MLRO | CFO | SENIOR_MANAGEMENT（IncidentNote.escalatedTo 同款枚举，spec §7）
  INCIDENT_ESCALATED:                { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['escalatedTo'], requiresCausation: false },
  INCIDENT_ASSESSED:                 { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['assessmentBasis'], requiresCausation: false },
  INCIDENT_REMEDIATION_LINKED:       { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['referenceNo'], requiresCausation: false },
  INCIDENT_REGULATOR_REPORT_DRAFTED: { domain: 'GOVERNANCE', correlationMode: N, requiredFields: [], requiresCausation: false },
  // basisCodes：逗号分隔依据码字符串（INCIDENT_REPORT_BASES 目录键，spec §7 必填）
  INCIDENT_REGULATOR_REPORTED:       { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['basisCodes'], requiresCausation: false },
  INCIDENT_CLOSE_REQUESTED:          { domain: 'GOVERNANCE', correlationMode: I, requiredFields: [], requiresCausation: false },
  INCIDENT_CLOSED:                   { domain: 'GOVERNANCE', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  INCIDENT_WITHDRAWN:                { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
};

/** 动态迁移码族（<域>_<从>_TO_<到>，充值站1b-β/提现站2-β 整族废除；站7 扩面治理五簿+监管闸——
 * 档案簿的 statusAction 工厂当日拆除，此闸防复发）——机器校验按此形状拒写。 */
export const RETIRED_DYNAMIC_TRANSITION_PATTERN =
  /^(DEPOSIT|WITHDRAW|SWAP|SHAREHOLDING_REGISTRY|APPOINTMENT_RECORD|TRAINING_RECORD|CONFLICT_DISCLOSURE|WIND_DOWN_MATERIAL|REGULATORY_GATE)_[A-Z_]+_TO_[A-Z_]+$/;

export const DEPRECATED_AUDIT_ACTIONS: readonly string[] = [
  'FIRST_LOGIN_MFA_VERIFY_FAILED',
  // ── 充值域（站1b-β，2026-08-26）──────────────────────────
  'DEPOSIT_GATE0_PASSED', 'DEPOSIT_HELD_BELOW_MIN', 'DEPOSIT_HELD_NOT_TRADING_READY',
  'DEPOSIT_PAYIN_CONFIRMED', 'DEPOSIT_PAYIN_FAILED', 'DEPOSIT_COMPLETED',
  'DEPOSIT_COMPLIANCE_STARTED', 'DEPOSIT_MANUAL_APPROVED', 'DEPOSIT_APPROVE_BLOCKED_FROZEN',
  'DEPOSIT_ACCOUNTING_BLOCKED', 'DEPOSIT_AWAITUSER_EMPTY_ACTIONS',
  'DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT', 'DEPOSIT_CONFISCATION_FAILED',
  'DEPOSIT_CONFISCATION_UNLOCK_FAILED', 'DEPOSIT_RETURN_APPROVAL_REQUESTED',
  'DEPOSIT_SEIZE_APPROVAL_REQUESTED', 'DEPOSIT_UNFREEZE_APPROVAL_REQUESTED',
  'DEPOSIT_LEG_CLEAR_FAILED',
  // ── 提现域（站2-β，2026-08-27）──────────────────────────
  'WITHDRAW_REQUESTED', 'WITHDRAW_APPROVAL_REQUESTED', 'WITHDRAW_APPROVAL_GRANTED',
  'WITHDRAW_APPROVAL_DECLINED', 'WITHDRAW_MANUAL_APPROVED', 'WITHDRAW_ACCOUNTING_POSTED',
  'WITHDRAW_PAYOUT_CONFIRMED', 'WITHDRAW_PAYOUT_FAILED',
  'WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT', 'WITHDRAW_REFUNDED_BY_TAG',
  'WITHDRAW_SANCTION_REFUNDED', 'WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED',
  'WITHDRAW_LOCK_RELEASED', 'WITHDRAW_AWAITUSER_EMPTY_ACTIONS',
  'WITHDRAW_UNFREEZE_APPROVAL_REQUESTED', 'WITHDRAW_SANCTION_REFUND_APPROVAL_REQUESTED',
  'WITHDRAW_FEE_LEG_REBUILT', 'WITHDRAW_FEE_SETTLE_STUCK',
  // ── 兑换域（站3-β，2026-08-27）──────────────────────────
  'SWAP_FAILED', 'SWAP_KYT_SUBMIT_FAILED', 'SWAP_KYT_REJECTED_DISPOSITION_FAILED',
  // ── 对账域（站5-β，2026-08-27）──────────────────────────
  'SYSTEM_RECON_RUN_COMPLETED', 'SYSTEM_RECON_CASE_AUTO_HEALED',
  'RECON_PUSH_ORDER_SYNCED', 'RECON_PUSH_ORDER_MANUAL',
  // ── 站7（2026-08-27）──────────────────────────────────
  'DEPOSIT_WALLET_CREATE_FAILED',
  'RESET_FAILED',
  'CHANGE_APPLY_FAILED',
  'ROLE_ACTIVATE_FAILED',
  'ROLE_MODIFY_FAILED',
  'MODIFICATION_APPLY_FAILED',
  'GENERATION_FAILED',
  'ADMIN_LOGIN_SUCCESS',
  'ADMIN_LOGIN_FAILED',
  // MFA_LOGIN_VERIFIED/MFA_LOGIN_VERIFY_FAILED 曾在站7首铸（9aac76e4）时预登记于此——
  // 当时假设它们会像 ADMIN_LOGIN_* 一样改名退役，但 mfa-binding-workflow.service.ts
  // 的 verifyMfaLogin() 一直原样在用。Task 15 收尾核实：码值不变，只是从旧附册搬进
  // V1_AUDIT_ACTIONS 合同（同 TRANSACTION_LIMIT_REJECTED 判例），故移出本闸——
  // 留在这里会与「六册两两互斥，且与退役闸零交集」自相矛盾（closure spec ②）。
  // ── 第一幕职权重划（Task 5）──────────────────────────────
  // 2026-08-30：随五本档案簿 / 监管闸门 / 对手方整块退役（第一幕职权重划），写点已删
  'REGULATORY_GATE_CREATED', 'REGULATORY_GATE_UPDATED', 'REGULATORY_GATE_SUBMITTED',
  'REGULATORY_GATE_FEEDBACK_RECORDED', 'REGULATORY_GATE_RECEIPT_BOUND',
  'REGULATORY_GATE_MARKED_EFFECTIVE', 'REGULATORY_GATE_REVOKED',
  'SHAREHOLDING_REGISTRY_CREATED', 'SHAREHOLDING_REGISTRY_UPDATED',
  'APPOINTMENT_RECORD_CREATED', 'APPOINTMENT_RECORD_UPDATED',
  'TRAINING_RECORD_CREATED', 'TRAINING_RECORD_UPDATED',
  'CONFLICT_DISCLOSURE_CREATED', 'CONFLICT_DISCLOSURE_UPDATED',
  'WIND_DOWN_MATERIAL_CREATED', 'WIND_DOWN_MATERIAL_UPDATED',
  'LP_CONFIG_UPDATED',
  // 2026-08-31：随手工开账本科目退役（业主定「账本没有手动配置这回事」），写点已删
  'MANUAL_TB_ACCOUNT_CREATED',
  // 2026-09-01 换名册 · 资产四族裸名退役（Task 13）——不跨族复用，直接登记
  'SUSPENSION_REQUESTED', 'SUSPENSION_EXECUTION_FAILED',
  'REACTIVATION_REQUESTED', 'REACTIVATION_EXECUTION_FAILED',
  'ACTIVATION_REQUESTED', 'ACTIVATION_FAILED',
  // 2026-09-02 换名册 · 限额两族 + 客户标签共用裸名退役（Task 14）——
  // 'CHANGE_APPLY_FAILED' 已在上面「站7」批次登记过，此处不重复登记。
  'CREATION_REQUESTED', 'CREATION_APPLIED', 'CREATION_APPLY_FAILED', 'CREATION_CANCELLED',
  'CHANGE_REQUESTED', 'CHANGE_APPLIED', 'CHANGE_CANCELLED',
  'TAG_ASSIGNED', 'TAG_REVOKED',
  // 2026-09-02 换名册 · 批四（Task 15）：托管钱包创建 + 提现地址登记两族裸名退役——
  // 不跨族复用，直接登记。TRANSACTION_LIMIT_REJECTED 码值不变、只是删掉旧附册里的
  // 冗余引用，不是改名，不登这份退役名单。
  'CREATE_REQUESTED', 'WALLET_CREATED', 'WALLET_CREATE_FAILED', 'CREATE_CANCELLED',
  'ADDRESS_REGISTERED', 'ADDRESS_ACTIVATED', 'ADDRESS_CANCELLED', 'ADDRESS_SUSPENDED',
  'ADDRESS_DEACTIVATED', 'MANUAL_COOLING_SKIP',
  // 2026-09-04 波一（V3 治愈）：上架 / 激活 / 编辑整条路退役（业主定「本轮不做新资产上线」），
  // 写点 asset-listing-workflow / asset-activation-workflow 已整文件删除，六码登退役闸
  'ASSET_CREATED_AND_PROVISIONED', 'ASSET_CREATION_FAILED', 'ASSET_PROVISIONING_UPDATED',
  'ASSET_ACTIVATION_REQUESTED', 'ASSET_ACTIVATED', 'ASSET_ACTIVATION_FAILED',
  // 2026-09-04 波一（V3 治愈）：托管钱包创建整条路 + 钱包状态开关退役（平台钱包只从种子来、管理台只读）；
  // 客户充值地址供给改名 CUSTOMER_DEPOSIT_ADDRESS_CREATED（actor=客户），旧名登退役闸
  'CUSTODIAN_WALLET_CREATE_REQUESTED', 'CUSTODIAN_WALLET_CREATED', 'CUSTODIAN_WALLET_CREATE_FAILED', 'CUSTODIAN_WALLET_CREATE_CANCELLED',
  'WALLET_STATUS_UPDATED', 'DEPOSIT_WALLET_CREATED',
  // 2026-09-04 波一（V3 治愈）：限额只改不建不删——创建流整条退役，四码登退役闸
  'TRANSACTION_LIMIT_CREATION_REQUESTED', 'TRANSACTION_LIMIT_CREATION_APPLIED',
  'TRANSACTION_LIMIT_CREATION_APPLY_FAILED', 'TRANSACTION_LIMIT_CREATION_CANCELLED',
] as const;
