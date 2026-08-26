# Seed 重做计划（base 纯配置 / business 可交易演示）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** 重做 `seed.base.ts` / `seed.business.ts`，干净分层：**base = 纯 IAM/治理配置（零资产/客户/TB账户）**；**business = 可交易演示环境（资产 + 系统TB账户/钱包 + 交易配置 + 8客户 + 客户TB账户）**。修复 `reset-business-data.ts` 为"完整重置到初始"。

**⚠️ git 纪律：** 用户有 4 个 dirty admin-web 文件（DashboardLayout/PageTitleBar/AccountStatementPage/CustomerDetail）——勿动。每 subagent 只用显式精确路径 `git add`，禁 `git add -A`。验收 = 不新增失败。seed 文件均已提交（非 WIP），可改。

## 锁定的设计决策（用户确认）
1. **base = 纯 IAM/治理**：roles / permissions / role_permissions / user_roles / 8 admin / approval_action_policies / approval_sod_rules。**移除**：seedAssets、客户 upsert、`provisionTbAccounts` 及所有 TB 账户（系统级 TB 账户是资产 provisioning 产物，归 business）。
2. **business 三层**（按依赖、全幂等 upsert）：
   - **① 资产层**：2 资产 `USDT-TRON`(crypto,network=TRON) + `AED`(fiat) → 直接建成 `ACTIVE`（绕过上线审批门，演示可接受）；provision **系统 TB 账户**（crypto: CUSTODY10/TRADE_CLEARING110/FEE_RECEIVABLE120；fiat: BANK1/TRADE_CLEARING110/FEE_RECEIVABLE120，按各自 ledger）；建**系统钱包** C_MAIN/C_OUT/F_LIQ/F_OPS（PLATFORM/ACTIVE，直接 upsert）。
   - **② 配置层**：`seedSwapFeeLevels`（**新增**，替换废弃 `seedPricingPolicies`）+ `seedWithdrawalFeeLevels` + `seedTransactionLimitPolicies`。
   - **③ 客户层**：8 个 demo 客户（覆盖各种 onboarding/compliance/risk/tier 状态）+ 每客户×每资产的**客户级 TB 账户** CLIENT_CREDIT(100)/CLIENT_AUDIT(101)。**不建** C_DEP/C_VIBAN 收款钱包、**不灌**余额。
3. **TB provisioning 机制**：复用 base 现有的 `tbAccountRegistry` 写行 + `provisionTbAccounts`（直连 tigerbeetle-node，sha256 确定性 tbAccountId）。把这套 helper **抽到共享模块**供 business 用（base 不再用）。
4. **完整重置（A）**：`reset-business-data.ts` 重写为"恢复到初始"：停后端→清 Prisma 业务表→**重格式化 TB 数据文件**→重启 TB→重跑 business seed。修掉对已删表（complianceAlert/complianceIncident 等）的残留引用。
5. **清死变量**：`stack-up.sh` 里 `GOVERNANCE_DEMO_ENABLED=true` 已无人读，删掉。
6. **命令**：`dev:start` 只灌 base；`npm run db:seed:business`（=`--mode=business`）灌演示；重置走重写后的 reset 脚本。

---

## Task S1: 净化 base seed（→ 纯 IAM/治理）

**Files:** `prisma/seed.base.ts`（+ 抽出的共享 TB helper）、可能新建 `prisma/seed-tb.helper.ts`。

- [ ] **Step 1: 抽出 TB provisioning helper**：把 `seed.base.ts` 里的 `provisionTbAccounts` + 确定性 tbAccountId 计算 + "写 tbAccountRegistry 行" 的逻辑抽到 `prisma/seed-tb.helper.ts`，导出 `ensureTbAccount(prisma, {code, ledger, ownerType, ownerUuid?})`（写 registry 行，幂等）+ `provisionTbAccounts(prisma)`（推进 TB）。base 与 business 都从这里 import。
- [ ] **Step 2: 从 base 移除资产/客户/TB**：删 `seedAssets` 调用 + 函数；删客户 upsert（line ~533 区域）；删 base 内的 `provisionTbAccounts` 调用（base 不再建 TB 账户）。base `seedBase` 只剩：seedRolesPermissions / seedAdminUsers / seedApprovalPolicies / seedSodRules（按现有函数名调整）。保留 `ensureBaseSeeded` 导出（business 前置仍要它确保 IAM 在）。
- [ ] **Step 3: 验证 base 纯净**：临时 DB 跑 `--mode=base` → 断言 `assets=0`、`customer_main=0`、`tb_account_registry=0`；`roles/permissions/users/approval_action_policies` 仍在。`npm run build` 0 错误。
- [ ] **Step 4: Commit**（显式路径）`refactor(seed): purify base seed to IAM/governance only (移除资产/客户/TB账户)`。

---

## Task S2: 重建 business seed（可交易演示）

**Files:** `prisma/seed.business.ts`、可能 `src/config/manifests/assets.manifest.ts`（确认 USDT-TRON/AED 定义）。

- [ ] **Step 1: ① 资产层**：`seedAssets`（从 base 搬来并改造）——只建 2 资产 `USDT-TRON`(currency USDT, network TRON, type CRYPTO, decimals 6, status ACTIVE) + `AED`(type FIAT, decimals 2, status ACTIVE)。每资产：`ensureTbAccount` 系统账户（crypto: CUSTODY/TRADE_CLEARING/FEE_RECEIVABLE @ USDT ledger；fiat: BANK/TRADE_CLEARING/FEE_RECEIVABLE @ AED ledger）；upsert 系统钱包 C_MAIN/C_OUT/F_LIQ/F_OPS（PLATFORM/ACTIVE）。
- [ ] **Step 2: ② 配置层**：新增 `seedSwapFeeLevels`（建 swap_fee_levels：至少 1 个含 USDT/AED 对的 level，参考 swap-fee-level 的现有结构/manifest）；保留 `seedWithdrawalFeeLevels` + `seedTransactionLimitPolicies`；**删除** `seedPricingPolicies` 及对 `pricing-policies.manifest` 的引用（废弃）。
- [ ] **Step 3: ③ 客户层**：`seedCustomers`（扩到 8 个，覆盖：APPROVED+CLEAR ×2、FROZEN、PENDING_VERIFICATION、NONE、HIGH risk、不同 trading tier、可加 1 机构）。每客户×每资产 `ensureTbAccount` CLIENT_CREDIT/CLIENT_AUDIT（ownerType CUSTOMER, ownerUuid=客户id）。**不建收款钱包、不灌余额**。客户保留 bcrypt 密码（可登录）。
- [ ] **Step 4: 收尾 provision**：业务 seed 末尾调一次 `provisionTbAccounts(prisma)` 把本轮新增 registry（系统+客户）推进 TB。
- [ ] **Step 5: 验证**：临时 DB 跑 `--mode=business`（含 base 前置）→ 断言：assets=2(ACTIVE)、系统钱包 4×2、tb_account_registry 含系统级+客户级(CLIENT_CREDIT 数 = 8客户×2资产=16)、swap_fee_levels≥1、withdrawal_fee_levels≥1、transaction_limit_policies≥1、customer_main=8、**C_DEP/C_VIBAN 钱包=0、CLIENT_CREDIT 余额=0**。`npm run build` 0 错误。
- [ ] **Step 6: Commit**（显式路径）`feat(seed): rebuild business seed as transaction-ready demo (assets+config+customers+TB accounts)`。

---

## Task S3: 完整重置脚本 + 命令 + 清死变量

**Files:** `scripts/reset-business-data.ts`、`package.json`（scripts）、`scripts/stack-up.sh`。

- [ ] **Step 1: 重写 reset-business-data.ts**：完整重置语义——(a) 清 Prisma 业务表（assets, wallets, customer_main + 客户相关 onboarding/compliance/kyt/edd/cdd/ubo/corporate, deposit/payin/payout/withdraw, swap_quote/swap_transaction, settlement_batches/items, outstandings, internal_transactions/funds, tb_account_registry, swap/withdrawal fee levels + bindings, transaction_limit_policies, liquidity*)；**修掉**对已删表（complianceAlert/complianceIncident/complianceAlertEvent 等）的 deleteMany（这些模型已不存在，会编译/运行报错）；(b) **重格式化 TB**：调 `dev-tigerbeetle.sh format`（或等效，需先停后端释放 TB）；(c) 重跑 business seed（`seedBusiness`，含 ensureBase 前置）。把编排写清楚（停后端→清→格式化TB→起TB→seed），或拆成 reset 脚本 + npm 编排。
- [ ] **Step 2: package.json scripts**：确保 `db:seed:business` = `ts-node prisma/seed.ts --mode=business`；`dev:reset` 指向重写后的完整重置编排。`dev:start` 维持只灌 base（确认 rebuild-local-dev-db / apply-local-migrations 只跑 base:sync，不灌 business）。
- [ ] **Step 3: 清 stack-up.sh 死变量**：移除 backend 启动 env 里的 `GOVERNANCE_DEMO_ENABLED`（src 已无人读）。
- [ ] **Step 4: 验证**：`npm run build` 0 错误；干净临时 DB 跑 reset 流程不报错（TB 格式化那步若环境不便，至少保证脚本编译通过 + Prisma 清理段无已删表引用）。
- [ ] **Step 5: Commit**（显式路径）`feat(seed): complete business reset (reformat TB + re-seed) + drop dead GOVERNANCE_DEMO env`。

---

## Task S4: 端到端验证（干净 DB → base+business → 交易就绪）

- [ ] **Step 1**：`npm run dev:rebuild`（干净迁移 + base）→ 断言纯净（0 资产/客户）。
- [ ] **Step 2**：`npm run db:seed:business` → 断言交易就绪：assets=2 ACTIVE、系统钱包成套、系统+客户 TB 账户齐（registry + TB 实际 createAccounts 成功）、swap/withdrawal fee + 限额在、8 客户在、无收款钱包/无余额。
- [ ] **Step 3**：（可选）起栈 `dev:start` 后探 1-2 个端点确认 boot 正常 + 资产可见。
- [ ] **Step 4**：报告最终就绪状态。

---

## 验收清单
- [ ] base 跑完：纯 IAM，0 资产/客户/TB账户；系统可启动可登录
- [ ] business 跑完：2 资产 ACTIVE、系统钱包+系统TB账户、swap/withdrawal费率+限额、8 客户+客户TB账户；**无收款钱包、无余额**
- [ ] 废弃的 pricing_policies 不再被 seed；swap_fee_levels 已灌
- [ ] reset = 完整重置到初始（含 TB 重格式化）；无已删表引用
- [ ] GOVERNANCE_DEMO 死变量清除；dev:start 只灌 base
- [ ] build + 现有测试不新增失败；不碰用户 admin-web WIP
