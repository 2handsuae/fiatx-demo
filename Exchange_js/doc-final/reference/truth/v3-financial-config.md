# V3 财务配置 — 当前实现真相

Last Verified: 2026-07-16（核对方式：金额闸门节按 transaction-limits 落地逐符号重核；余节 2026-07-11 基线）

> 本文只描述"现在是什么样"。改代码必须同步本文。历史沿革看 git/roadmap，计划看 roadmap，欠账看 BACKLOG.md。

---

## 1. 资产（Asset）

- **状态机**：`PROVISIONING → ACTIVE ⇄ SUSPENDED`（无下架终态）
- **主标识**：`code = {currency}-{network}`（如 `USDT-TRC20`），无 network 时 = currency；身份字段 currency/network/decimals 一旦创建即锁定
- **创建无审批门**，同事务完成系统账本账户 provisioning；激活/暂停/恢复各走**独立 CISO 审批**（`ApprovalActionTypes.ASSET_ACTIVATION / SUSPENSION / REACTIVATION`）
- **激活就绪检查两项**：① 系统账本账户齐全 ② ≥1 个 ACTIVE 钱包
- **PROVISIONING 期可编辑运营字段**（开关/描述等，身份字段锁定）；单笔 min/max 限额已移交 `transaction_limit_rules` SINGLE 行（见 §5），资产表单不再配
- **客户端守卫双侧**：前端只列 ACTIVE 资产；后端钱包创建 API 拒绝非 ACTIVE 资产
- **锚点**：`assets.service.ts` ｜ `asset-activation-workflow.service.ts → checkReadiness()`（就绪检查）｜ `AssetEdit.tsx`（PROVISIONING 期字段锁定守卫）
- ⚠️ **已知残留**：`contractAddress` 字段前端已移除但 schema/DTO 仍保留（无害，见 BACKLOG）

## 2. 托管钱包（Wallet）

物理层：crypto = HexTrust（`vaultId`），fiat = Zand Bank（`iban`）。**钱包不持有余额——余额唯一真相在 TigerBeetle。** Wallet 模型已去除旧 Journal/Balance 依赖。

| 角色 | ownerType | 资产类型 | 用途 | 状态 |
|---|---|---|---|---|
| `C_DEP` | CUSTOMER | CRYPTO | 客户充值地址 | 现役 |
| `C_VIBAN` | CUSTOMER | FIAT | 客户虚拟 IBAN（每客户每资产限 1）| 现役 |
| `C_CMA` | PLATFORM | FIAT | 法币主账号（查询用）| 现役 |
| `F_OPS` / `F_SET` / `F_FEE` / `F_LIQ` | PLATFORM | 两者 | 运营 / 结算中转 / 手续费 / 流动性 | 现役 |
| `C_MAIN` / `C_OUT` | — | — | 旧平台归集 / 出金池 | **已退役**，不再 provision，仅枚举残留 |

- 双入口：Admin 建系统钱包 / Client 建客户地址，按 `ownerType + walletRole` 策略区分
- **锚点**：`wallet-role-policies.constant.ts` ｜ `system-wallet.util.ts`（C_MAIN/C_OUT 退役注释 + `CRYPTO_SYSTEM_WALLET_ROLES`）

## 3. 账本账户开设（COA provisioning）

> 📖 **8 码 COA 定义 / TB 记账机制 / 不变量** → [accounting-coa.md](accounting-coa.md)（跨版本共享域）。本节只写 **V3 关注的"账户何时开设"**。

- **系统级**（CLIENT_ASSET/FIRM_ASSET/FIRM_OPS/FIRM_FEE/FIRM_LIQ + 法币 FIRM_SET）：资产创建**同事务** provision
- **客户级**（CLIENT_PAYABLE/DEPOSIT_SUSPENSE）：**首笔交易懒解析**，失败则该笔交易失败；兜底 `POST /admin/tb/accounts`
- **锚点**：`asset-provisioning.service.ts → provision()` ｜ `deposit-workflow.service.ts → executeDepositAccounting()`（客户账户懒解析）
- ⚠️ **已知薄弱点**：账户创建失败无 backlog 重试（仅转账凭证有 `TbEvidenceBacklog`）；`asset.provisioned` 事件 + `TbAccountBacklog` 已不存在（旧 roadmap 记载已过期）

## 4. 提现地址（WithdrawalAddress）

- **状态机**：`PENDING_ACTIVATION →(24h)→ ACTIVE`；冷却期内客户可取消 → `CANCELLED`；ACTIVE 可被管理员 `SUSPENDED`；ACTIVE 可被**客户自助软停用** → `DEACTIVATED`（终态，客户侧归档保留，非删除）
- **首个法币（BANK）提现地址登记即 ACTIVE**（免 24h 冷却）；同客户后续 BANK 地址仍走标准 24h 冷却
- **crypto 地址登记前置门（2026-07-11 起）**：`registerAddress`（crypto）要求客户已有 ≥1 个 ACTIVE 法币（BANK）提现地址，否则 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`；`registerBankAccount`（fiat）**不设此门**（法币地址是所有业务的引导起点）。锚点 `withdrawal-address-workflow.service.ts → registerAddress()`（复用 `withdrawal-address.service.ts → hasActiveFiatWithdrawalAddress`）
- **前端就绪门形态（2026-07-11，钱包页 UX）**：无 active 法币提现地址的已认证客户——① 访问订单页 `/deposit /withdraw /swap /wallet` 时 `AuthGuard` 渲染独立引导页 `TradingStartGuide`（**不重定向**，URL 停在订单页；单 CTA「Go to Wallet」→ `/withdrawal-addresses`）；② `/withdrawal-addresses`（侧栏标签"Wallet"页）顶部显示说明 banner + **禁用「Crypto Addresses」tab（锁图标）+ 强制「Bank Accounts」tab**，逼客户先加法币地址；加成功首个法币地址（即 ACTIVE）后 `refetch` 就绪态在页内即时解锁。⚠️ AuthGuard 路径匹配须**段边界**（`=== p || startsWith(p+'/')`），否则 `/withdraw` 前缀误吞其目的地 `/withdrawal-addresses` → 自循环渲染 null 白屏。锚点 `AuthGuard.tsx` ｜ `TradingStartGuide.tsx` ｜ `WithdrawalAddresses.tsx`（crypto tab disabled + 强制 bank）｜ `useTradingReadiness.ts`。（注：`/wallet` = WalletManagement "Deposit Wallets" 充值钱包页，与"Wallet"侧栏项`/withdrawal-addresses`是两个页面）
- **冷却常量**：`COOLING_PERIOD_HOURS = 24`（`withdrawal-address.service.ts`）
- **激活双机制**：cron 每 5 分钟扫 + 客户查询前懒激活
- **管理员后门**：`POST :addressNo/skip-cooling`（带审计）
- **客户停用**：`POST /client/withdrawal-addresses/:addressNo/deactivate`，两道守卫——① 末位 ACTIVE 法币地址不可停用（`LAST_ACTIVE_FIAT_ADDRESS`）② 该地址有在途提现引用不可停用（`ADDRESS_HAS_INFLIGHT_WITHDRAWAL`）；成功写 `deactivatedAt`/`deactivatedBy` + 审计 `ADDRESS_DEACTIVATED`
- **字段**：crypto = `address` / `network`；bank = `beneficiaryName` / `bankName` / `iban` / `swiftBic`；停用 = `deactivatedAt` / `deactivatedBy`
- **注册时** 经 `TravelRuleAdapter` 做地址归因（VASP attribution）
- **锚点**：`withdrawal-address.service.ts → deactivate() / createBankAccount()`（首地址免冷却判定）｜ `withdrawal-address-sweep.service.ts → handleCoolingExpiry() @Cron`
- ⚠️ **已知缺口**：提现创建流程**不校验**地址是否 ACTIVE/已注册——前端过滤 ACTIVE、后端裸奔，绕过前端可用任意地址提现（安全守卫卡片 task_20678a2c，见 BACKLOG）

## 5. 金额闸门（Transaction Limits）

统一规则表 `transaction_limit_rules`（模型 `TransactionLimitRule`，模块 `asset-treasury/transaction-limits/`）+ 一台 L1 判定引擎，取代旧 `governance/transaction-limits` 半成品（已退役）。

- **三种 gateType 行形状锁死**（每型固定哪些维度必填/必空，无通配优先级问题）：
  - `SINGLE`（A 单笔）：operationType × assetId，`minAmount`/`maxAmount`（原生币种，可只填一边）
  - `CUMULATIVE`（B 累计）：operationType × tradingTier(BASIC/PREMIUM) × period(DAILY/MONTHLY)，`defaultLimit` + `cap`（AED；`cap` = 客户微调层上限占位，本轮引擎不消费）
  - `LARGE_APPROVAL`（D1）：operationType，`threshold`（AED）
  - 唯一约束 =（gateType, operationType, assetId?, tradingTier?, period?）；SQLite 复合唯一对 NULL 不去重 → 服务层 `assertUnique()` 预检
- **配置台**：admin **Transaction Limits** 页（Assets 菜单组，三 tab 各一 gateType）；创建/变更走 **OPS_OFFICER 单步审批**（maker-checker，`TransactionLimitRuleWorkflowService` + 两个审批发射器 `TransactionLimit{Creation,Change}ApprovalService`，apply-time before-vs-current 冲突守卫 + PENDING 守卫），权限 `TRANSACTION_LIMIT_READ/WRITE`
- **L1 执行接入**：提现 `createWithdrawal()` + 兑换 `executeSwap()` 在订单 persist 前调 `TransactionLimitGateService.evaluate({operationType,customerId,assetId,amount})`——A/B 拒绝不建单不耗 quote、D1 提现大额门读 LARGE_APPROVAL 行（详见 [v5-withdraw.md](v5-withdraw.md) §3 / [v6-swap.md](v6-swap.md) §3）
- **种子**：`seedTransactionLimitRules`（`prisma/seed.business.ts`，`db:biz:init` 注入）——A 每资产×WITHDRAWAL/SWAP、B 8 行（BASIC/PREMIUM × 方向 × 周期）、D1 WITHDRAWAL 200000 AED
- **锚点**：`transaction-limits/transaction-limit-rules.service.ts`（CRUD+三查找+校验）｜ `transaction-limit-gate.service.ts → evaluate()`（L1 引擎）｜ `transaction-limit-rule-workflow.service.ts`（审批工作流）｜ `prisma/seed.business.ts → seedTransactionLimitRules()`
- ⚠️ **Asset 4 列 `min/maxDeposit/WithdrawAmount` 已成弃用残留**：单笔上下限归 `transaction_limit_rules` SINGLE 行，资产表单已撤 4 输入框；schema 列暂留待 drop（见 BACKLOG）
- ⚠️ **DEPOSIT 配置先行、执行未接**：规则表接受 `operationType='DEPOSIT'` 行，但充值工作流暂不消费此闸（待充值任务，见 BACKLOG）
- ⚠️ **TR 阈值 3,500 不属本模块**（合规域，刻意排除；见 roadmap V4 TR 闸门）
