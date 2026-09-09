# 波一 · 清地基（纯减法 + 对账本）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除三个交易域已取证的死码、修正失真注释、把文档与 BACKLOG 同步到代码现实——零行为新增，净减行数。

**Architecture:** 纯减法批次。四组文本任务（BACKLOG/文档/注释）先行，代码删除居中，schema 迁移殿后，一次重铺闸收尾。每个删除项先在 HEAD 复现零引用再动手。

**Tech Stack:** NestJS + Prisma(SQLite) 后端、React admin-web/client-web、jest、TigerBeetle（重铺闸涉及）。

**Spec:** `doc-final/superpowers/specs/2026-09-09-wave1-cleanup-spec.md`（判点与纪律以 spec 为准，本 plan 引用不重抄）

## Global Constraints

- **每条 shell 命令前置 Node 20**：本机默认 node18，`npm i`/构建会被 engines 拒。每个任务的第一条命令固定为 `export PATH="$HOME/.nvm/versions/node/$(ls ~/.nvm/versions/node | grep '^v20' | tail -1)/bin:$PATH"`；禁止管道尾接 `tail`/`grep` 吞退出码（zsh 下 `${PIPESTATUS[0]}` 无效，用 `${pipestatus[1]}` 或不走管道）。
- **jest 必须在 `Exchange_js/` 根目录跑**（worktree 根），不能在子目录。
- **删码三纪律（spec §1，逐字执行）**：① 删前在 HEAD 复现零引用，且加搜模板串 `${...}` 拼接形态与字符串值形态（`AuditActions[变量]` 动态键、事件名字面量）；复现不出 → 不删，写进任务报告交主会话。② 仅-spec-引用项：先改/删假绿断言（断言的是生产从不发生的行为），该 spec 文件改后整体跑绿，再删符号。③ 删 admin 端点同步删 `rbac.catalog.ts` 登记 + grep `scripts/verify-rbac.ts` `scripts/verify-act1.ts` 无判据引用。
- **只减不加**：不新增行为/端点/字段；发现注释揭示真 bug → 登 BACKLOG 不顺手修；中文注释不动（业主 2026-09-09 裁定，decisions.md）。
- **worktree 隔离**：本波在 `.claude/worktrees/wave1-cleanup/`（分支 `chore/act345-wave1-cleanup`）执行；栈用 self（`bash scripts/stack.sh up`），DB 在 `/tmp/exchange_js_wt_wave1-cleanup/`；12 个 demo/recon 脚本必须经 `bash scripts/on-stack.sh self <script>`。
- 派发 subagent 的任务 prompt 必须带项目总纲 §0–§5 要点（演示系统定位/禁做清单/六铁律）。

---

### Task 1: BACKLOG 销账与订正（组 E）

**Files:**
- Modify: `doc-final/BACKLOG.md`

**Interfaces:** 无代码。产出：BACKLOG 四处变更。

- [ ] **Step 1: 销 D7**——§D「⭐充值详情页通用 Actions 组在终态仍全显」整条移至文末「本轮销账」新节（节名 `## 本轮销账（2026-09-09 三四五幕波一）`），改写为一行：
  `- [x] ⭐ 充值详情页终态仍全显 6 按钮 —— 已腐烂销账：通用 ACTIONS 组早在 2026-07-30（9b391f19）整体删除，现为按状态门控的 Ops/Frozen Disposition + SimulationPanel；体检复现 grep 'Approve'|>Expire< 零命中`
- [ ] **Step 2: 拆销 I7①**——§I「按键 × 按状态置灰精度（两条同族，合并登记）」条目：删去①（兑换 ①Approved 过度点亮），保留②（充值/提现 ⑧On hold）并把导语改为单条；文末销账节加一行：
  `- [x] 兑换 ①Approved 在 SUCCESS/REJECTED 过度点亮 —— 已腐烂销账：2026-08-24 业主裁定只在 COMPLIANCE_PENDING 高亮（SwapTransactionDetail.tsx:34 isSwapVerdictActionable，注释载裁定），修复晚于登记日`
- [ ] **Step 3: 订正 D11**——§D「TR 适用判定未自动计算」条目中删去「③(3,500 阈值判定)代码未自动计算」相关表述，改为：条件③金额阈值已实现（`kyt-txn-type.resolver.ts` `TR_THRESHOLD_BY_CURRENCY`，USDT 1000 / AED 3500，边界取 ≥）；仅剩条件②（对手方 VASP 打标靠 DTO 自报）未自动化。
- [ ] **Step 4: 订正 F3**——§F「提现报价审计未落地」条目：把「常量 `WITHDRAW_PRICING_QUOTE_CREATED/_USED/_CANCELLED` 已定义但从不调用」改为「该三常量全仓不存在（2026-09-09 复核）；`withdraw-quote.service.ts` 全文件零 audit 引用、V5 名册零 QUOTE 码——缺口本体成立，实施归波二报价单收口」。
- [ ] **Step 5: Commit**

```bash
git add doc-final/BACKLOG.md
git commit -m "docs(波一): BACKLOG 对账——销 D7/I7①（已腐烂），订正 D11/F3 行文"
```

---

### Task 2: 文档同步（组 D）

**Files:**
- Modify: `doc-final/modules/v4-deposit.md`（:63 :70 :85 一带）
- Modify: `doc-final/modules/v5-withdraw.md`（:64 :71 一带）
- Modify: `doc-final/modules/v6-swap.md`（:61 :66 一带）
- Modify: `doc-final/modules/funds-orders.md`（:55 :62 一带）
- Modify: `doc-final/demo/script.md`（:139 一带）

**Interfaces:** 码数暂按 47/30/22 写入；Task 11 收尾复数（A2/A3 只动旧扁平对象，不动 V4/V5/V6 名册，正常不变；若 Task 6 触发名册变化以其报告为准）。

- [ ] **Step 1**: v4-deposit.md——「31 码封闭」改「47 码（=V4_DEPOSIT_AUDIT_ACTIONS 名册键数，扩码时同步本数）」；§5 PATCH 相关句改为「状态直改侧门已物理删除——`PATCH :id/status` 端点 2026-08-30（00b0eb83）连黑名单守卫一并移除，controller 注释自证」；删 :85「三条弧在客户流水里都误标成"没收"…」整行（判定依据：体检轴③#4，客户流水只读 CLIENT_PAYABLE、三弧不出现；管理台侧病根仍在 BACKLOG D6）。
- [ ] **Step 2**: v5-withdraw.md——「25 码封闭」改「30 码（=V5_WITHDRAW_AUDIT_ACTIONS 名册键数）」；`getWithdrawStatusView()` 条目标注「client-web 前端函数（`client-web/src/utils/withdrawStatusView.ts`），后端 `toCustomerWithdrawView` 只做字段白名单裁剪」。
- [ ] **Step 3**: v6-swap.md——「18 码」改「22 码（=V6_SWAP_AUDIT_ACTIONS 名册键数）」；`fee-audience.util.ts → resolveBestLevel()` 改为「`swap-quote.service.ts → resolveBestLevel()`（内部调 `fee-audience.util.ts → matchesAudience()`）」。
- [ ] **Step 4**: funds-orders.md——`directionOf()` 归属标注「`funds-order.service.ts:36`（迁移表在 constants 文件，方向判定在 service）」；「代码与权限包仍用旧名 INTERNAL_FUND_*」删「与权限包」三字（rbac.catalog.ts 零匹配，2026-09-09 复核）。
- [ ] **Step 5**: script.md:139——「充值 31 码 / 提现 25 码 / 兑换 18 码」改「充值 47 码 / 提现 30 码 / 兑换 22 码」。
- [ ] **Step 6**: 五份文档「Last Verified」（有此栏者）更新为 2026-09-09。
- [ ] **Step 7: Commit**

```bash
git add doc-final/modules/v4-deposit.md doc-final/modules/v5-withdraw.md doc-final/modules/v6-swap.md doc-final/modules/funds-orders.md doc-final/demo/script.md
git commit -m "docs(波一): 三域文档同步——审计码实数/PATCH 已删/函数归属/删过时缺口行"
```

---

### Task 3: 五条已逮失真注释修正（组 C 前半，只改注释）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（:1101-1119、:624 一带）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（:2174、:2443、:2700 一带）
- Modify: `src/modules/swap-sumsub/swap-kyt-verdict.handler.ts`（:41-42 一带）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（:855 一带）

**Interfaces:** 无代码行为变化；本波起注释引用一律用函数名锚点、不写裸行号。

- [ ] **Step 1**: swap-workflow.service.ts:1101-1119 注释块——四个行号引用改函数名锚点：`（:501）`→`（applyKytVerdict 顶部）`；`（…:1624 附近）`→`（onCustomerRestrictionOpened 广播 handler）`；`:517 的 FROZEN 幂等闸`→`applyKytVerdict 入口的 FROZEN 幂等闸`；`（:1679 附近）`→`（onCustomerRestrictionOpened 侧的良性抢跑判据）`。其余文字保持原样。
- [ ] **Step 2**: deposit-workflow.service.ts 三处 JSDoc——`delegate to the onReturnApproved stub (real settlement lands in A3)` → `delegate to onReturnApproved (settlement lives there: disposition leg + status transition + audit)`；:2443 Seize 同款（`onSeizeApproved`，去掉 `stub`/`lands in A4`）；:2700 Unfreeze 同款（`onUnfreezeApproved`，去掉 `stub`/`lands in A5`）。
- [ ] **Step 3**: swap-workflow.service.ts:624——`移交处置(Task 7 打桩)` → `移交处置（handleRejectDisposition，已落地且幂等）`。
- [ ] **Step 4**: swap-kyt-verdict.handler.ts:41-42——`(Task 6 落地状态机; 本任务只定调用契约 + 打桩)` → `（getTxn 详情拉取、sceneTag 归约、dispoTag 识别均已实现）`。
- [ ] **Step 5**: withdraw-transactions.service.ts:855——`目前零调用方——…留着是给后面「模拟超时」端点用的` → `唯一调用方是 setSlaDeadlineByNo（⚡ 模拟超时端点）；计时主路径见 resolveSlaFields`。
- [ ] **Step 6: 验证零行为变化**

```bash
npx tsc --noEmit -p tsconfig.json
git diff --stat   # 确认只有注释行
```

- [ ] **Step 7: Commit**

```bash
git add -u src/
git commit -m "docs(波一): 修五条失真注释——stub 已落地/行号漂移改函数名锚点"
```

---

### Task 4: 402 条带日期/任务号注释全量核对（组 C 后半，批量）

**Files:**
- 输入清单：会话 scratchpad `checkup-E-backlog.md` 附录（执行时由派发者把清单粘进任务 prompt，按文件分包）
- Modify: 清单中判定失真的注释所在文件（只改注释）

**Interfaces:** 产出核对表（每条：位置｜判定 相符/失真｜失真的给修正 diff）。

- [ ] **Step 1**: 按文件分包核对，判据 = 注释对**行为/行号/文件归属**的事实性描述与代码一致。带日期的业主裁定语境、设计理由、历史演进说明**不是清理对象**——只修「说的和代码不一样」。
- [ ] **Step 2**: 失真项就地改注释（同 Task 3 规矩：函数名锚点、不写裸行号；不改代码）。发现注释揭示真 bug → 记入任务报告（主会话决定是否登 BACKLOG），不顺手修。
- [ ] **Step 3**: `npx tsc --noEmit -p tsconfig.json` + `git diff` 抽查确认纯注释。
- [ ] **Step 4: Commit**

```bash
git add -u src/ admin-web/src client-web/src
git commit -m "docs(波一): 全量核对带日期/任务号注释——失真项改真实描述（N 条，见任务报告）"
```

---

### Task 5: 后端零调用导出删除（组 A1，18 项）

**Files:**
- Modify: `src/modules/trading/pricing-center/types/pricing.types.ts`（:8,9,93,104,116,129,208,209 → `SwapFeeItemCode`/`WithdrawalFeeItemCode`(此文件那半)/`SwapPricingPolicyConfig`/`WithdrawalPricingPolicyConfig`/`PricingPolicyListItem`/`ProviderRateQuote`/`SWAP_POLICY_CODE`/`WITHDRAWAL_POLICY_CODE`）
- Modify: `src/modules/trading/pricing-center/dto/pricing-center.dto.ts`（:12 `SwapSimulatorDto`、:52 `AdminPricingQuoteQueryDto`；保留 `WithdrawalSimulatorDto`/`CreateWithdrawPricingQuoteDto`——有 controller 消费）
- Modify: `src/modules/trading/swap-transactions/dto/swap-quote.dto.ts`（:12 `SwapSide` enum）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（:84 `SwapQuoteComputationResult`）
- Modify: `src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts`（:126 `ComplianceStatus`、:134 `KytStatus`、:140 `TravelRuleStatus`）
- Modify: `src/modules/sumsub-applicant-client/sumsub.types.ts`（:1 `SumsubVerificationSubstatus`）

**Interfaces:** 各 fee-level `types/fee-level.types.ts` 里的同名 type **不动**（活口径）。

- [ ] **Step 1: 逐符号在 HEAD 复现零引用**（18 个符号逐个跑，任一 >1 处命中即跳过该项并记报告）

```bash
for s in SwapPricingPolicyConfig WithdrawalPricingPolicyConfig PricingPolicyListItem ProviderRateQuote SWAP_POLICY_CODE WITHDRAWAL_POLICY_CODE SwapSimulatorDto AdminPricingQuoteQueryDto SwapSide SwapQuoteComputationResult ComplianceStatus KytStatus TravelRuleStatus SumsubVerificationSubstatus; do echo "== $s"; grep -rnw "$s" src scripts test prisma admin-web/src client-web/src --include='*.ts' --include='*.tsx'; done
```

（`SwapFeeItemCode`/`WithdrawalFeeItemCode` 单独跑：预期恰 2 处命中=两份定义行，删 pricing.types.ts 那份。`ComplianceStatus`/`KytStatus` 是常见词，命中多于定义行时逐条人工看是不是同名别物。）

- [ ] **Step 2**: 删除符号（连带各自的注释块；若删空 import 顺手清）。
- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading/pricing-center src/modules/trading/swap-transactions src/modules/trading/withdraw-transactions --silent
```

预期：0 error / 相关 suite 全绿。
- [ ] **Step 4: Commit**

```bash
git add -u src/
git commit -m "chore(波一): 删 18 个零调用导出（pricing-center 空转类型族/DTO 死枚举等）"
```

---

### Task 6: 死审计码处理（组 A2+A3）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（旧扁平 `AuditActions` 对象，:169-488 区间）
- Modify: 引用 A3 码的 spec 文件（Step 3 现场定位）

**Interfaces:** **V4/V5/V6 分域名册（:769-925）与 V2/V8 名册一律不动**；若 A3 某码同时存在于分域名册 → 该码不删、写报告交主会话终审（名册是业主终审的业务词表，不单方面动）。

- [ ] **Step 1: A2 十五码逐个复现全零**（含动态键访问排查）

```bash
for c in DEPOSIT_RETURN_APPROVAL_REQUESTED DEPOSIT_SEIZE_APPROVAL_REQUESTED DEPOSIT_UNFREEZE_APPROVAL_REQUESTED WITHDRAW_UNFREEZE_APPROVAL_REQUESTED WITHDRAW_SANCTION_REFUND_APPROVAL_REQUESTED WITHDRAW_APPROVAL_GRANTED WITHDRAW_APPROVAL_DECLINED WITHDRAW_SANCTION_REFUNDED DEPOSIT_AWAITUSER_EMPTY_ACTIONS WITHDRAW_AWAITUSER_EMPTY_ACTIONS DEPOSIT_ACCOUNTING_BLOCKED DEPOSIT_COMPLIANCE_STARTED DEPOSIT_CONFISCATION_FAILED DEPOSIT_CONFISCATION_UNLOCK_FAILED DEPOSIT_GATE0_PASSED DEPOSIT_LEG_CLEAR_FAILED DEPOSIT_PAYIN_CONFIRMED DEPOSIT_PAYIN_FAILED; do echo "== $c"; grep -rn "$c" src scripts test admin-web/src client-web/src --include='*.ts' --include='*.tsx' | grep -v "audit-actions.constant.ts"; done
grep -rn "AuditActions\[" src --include='*.ts' | grep -v spec   # 动态键访问排查，预期零命中
```

- [ ] **Step 2**: 删 A2 十五键（`DEPOSIT_CONFISCATION_UNLOCK_FAILED` 连 :236-238 那段「死常量清理留给审计那一轮」的注释一并删——那一轮就是现在）。
- [ ] **Step 3: A3 八码逐个处理**：`DEPOSIT_COMPLETED`/`DEPOSIT_HELD_BELOW_MIN`/`DEPOSIT_HELD_NOT_TRADING_READY`/`DEPOSIT_MANUAL_APPROVED`/`DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT`/`WITHDRAW_LOCK_RELEASED`/`WITHDRAW_MANUAL_APPROVED`/`WITHDRAW_REFUNDED_BY_TAG`——每码：(a) 先查是否在 V4/V5 分域名册内（在 → 不删、记报告）；(b) 找到引用 spec，看断言：断的是生产从不写的码 → 改断言指真实写入码或删该断言（改后跑绿该 spec 文件）；(c) 删扁平对象里的键。
- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/audit-logging src/modules/trading --silent
```

- [ ] **Step 5: Commit**

```bash
git add -u src/
git commit -m "chore(波一): 清死审计码——旧扁平名册 15 全零码删除 + 8 个假绿断言码逐个处置"
```

---

### Task 7: 前端死码 + 恒空展示位（组 B）

**Files:**
- Modify: `admin-web/src/utils/depositActionMap.ts`（:81 `getPayinSimActionsForStatus`、:120 `getPayinStatusBadgeClass` 删）
- Modify: `admin-web/src/utils/depositStatusMap.ts`（:86 `ALL_DEPOSIT_STATUSES`）、`swapStatusMap.ts`（:61）、`withdrawStatusMap.ts`（:128）+ 各自 spec
- Delete: `client-web/src/pages/WalletManagement.tsx`
- Modify: `client-web/src/App.tsx`（删 `/wallet` 路由与 lazy import）、`client-web/src/components/AuthGuard.tsx:103`（`readinessBlockedPaths` 删 `'/wallet'`）
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（:99,:601 `confirmations` 声明+渲染删；:117,:669 `sumsubActionId` 声明+渲染删——与 Task 9 删列配对）

**Interfaces:** `FundsOrderDetail.tsx` 7 个链上字段不动（波五判点）。

- [ ] **Step 1**: 逐项 HEAD 复现零引用（含 `${` 拼接与 `'/wallet'` 各种引号形态）：

```bash
grep -rnw "getPayinSimActionsForStatus\|getPayinStatusBadgeClass" admin-web/src
grep -rnw "ALL_DEPOSIT_STATUSES\|ALL_SWAP_STATUSES\|ALL_WITHDRAW_STATUSES" admin-web/src
grep -rn "wallet" client-web/src --include='*.tsx' --include='*.ts' | grep -vE "withdrawal-addresses|walletNo|walletRef|WalletManagement" | grep -E "navigate|to=|href|/wallet"
```

- [ ] **Step 2**: `ALL_*_STATUSES` 三常量按 spec 纪律 2：spec 拿它做穷举对照且有真值来源的改为 spec 文件内局部常量；纯回读定义的连断言删。
- [ ] **Step 3**: 删 WalletManagement 页三件套（页面文件/路由/AuthGuard 项）；删 DepositTransactionDetail 两个恒空展示位（含 TS interface 里的字段声明）。
- [ ] **Step 4: 验证 + 渲染**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npm run test:client
```

再起 preview（self 栈）渲染：admin 充值详情页截图（确认无 Confirmations/Applicant Action ID 空位）、client 直接访问 `/wallet` 应落 404/重定向，侧栏无影响。
- [ ] **Step 5: Commit**

```bash
git add -A admin-web/src client-web/src
git commit -m "chore(波一): 前端死码——死 util/ALL_* 常量/旧钱包页三件套/两处恒空展示位"
```

---

### Task 8: 零消费端点删除（组 A5）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`（:271-282 `@Get('export')` 整段删）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（:332 export 登记行删）
- Modify: `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts`（:69-74 `@Get(':id')` 整段删）

**Interfaces:** `findOneForCustomer`（service 方法）保留——`findOneForCustomerByWithdrawNo` 内部复用它（Step 2 验证）。

- [ ] **Step 1: HEAD 复现零消费**（模板串形态一并搜）

```bash
grep -rn "deposit-transactions/export" admin-web/src client-web/src scripts test
grep -rn "withdraw-transactions/\${" client-web/src | grep -v "my/"
grep -rn "deposit-transactions/export\|withdraw-transactions" scripts/verify-rbac.ts scripts/verify-act1.ts | grep -i "export\|':id'"
```

预期全空/无相关命中。
- [ ] **Step 2**: 删两段路由 + rbac 登记行；验证 service 方法留存有据：

```bash
grep -n "findOneForCustomer" src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts
```

预期 ≥2 处（定义 + findOneForCustomerByWithdrawNo 内调用）。
- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions --silent
```

- [ ] **Step 4: Commit**

```bash
git add -u src/
git commit -m "chore(波一): 删零消费端点——充值导出（含 rbac 登记）与客户端提现旧详情路"
```

---

### Task 9: 死表列删除 + 迁移（组 A4，schema 殿后）

**Files:**
- Modify: `prisma/schema.prisma`（删列：`DepositTransaction.{travelRuleCheckedAt,aggregatedAt,aggregatedTransferId,sumsubExternalActionId,travelRuleTransferId}`、`SwapTransaction.{failureCode,riskDecisionRef}`、`WithdrawalFeeLevel.updatedByUserId`、`SwapFeeLevel.updatedByUserId`、`InboundTransferSignal.{lastScannedAt,supplementRequestedByUserId}`）
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts`（:527,:597,:872 `lastScannedAt` 写入与 :338,:352 `supplementRequestedByUserId` 写入删）
- Modify: 引用仅-spec 列的 spec（`deposit-transactions.service.spec.ts:207,240` `travelRuleTransferId`；`swap-transactions.service.spec.ts:249` `failureCode`）——按纪律 2 修断言/夹具
- Create: `prisma/migrations/<timestamp>_wave1_drop_dead_columns/migration.sql`（migrate dev 自动生成）

**Interfaces:** `WithdrawTransaction.pricingQuoteId` **保留**（relation 外键）。

- [ ] **Step 1: 逐列 HEAD 复现**（模板串/字符串形态一并）：

```bash
for f in travelRuleCheckedAt aggregatedAt aggregatedTransferId sumsubExternalActionId travelRuleTransferId failureCode riskDecisionRef updatedByUserId lastScannedAt supplementRequestedByUserId; do echo "== $f"; grep -rnw "$f" src scripts admin-web/src client-web/src prisma --include='*.ts' --include='*.tsx' --include='*.prisma' | grep -v /migrations/; done
```

（`updatedByUserId` 是常见名——命中要逐条确认属两费率表；别表同名列不动。）
- [ ] **Step 2**: 删 schema 列 + 两处写入点 + 修两处 spec 夹具，生成迁移（DB 用本 worktree 的，路径见 `.stackports`）：

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_wave1-cleanup/dev.db" npx prisma migrate dev --name wave1_drop_dead_columns
npm run prisma:generate
```

- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading src/modules/funds-orders --silent
```

- [ ] **Step 4: Commit**

```bash
git add prisma/ src/
git commit -m "chore(波一): 删 11 个死表列（迁移 wave1_drop_dead_columns）+ 两处只写不读写入点"
```

---

### Task 10: 孤儿 spec 改名 + TODO 收口（组 A6+A7）

**Files:**
- Rename: `src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts` → `withdraw-workflow.fee-income.spec.ts`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`（:279）

**Interfaces:** 无。

- [ ] **Step 1**: `git mv` 改名；文件头补一行注释：`// 测的是 WithdrawWorkflowService 的费腿记账行为——按行为命名；曾名 withdraw-fee-income.service.spec.ts（无同名 service，2026-09-09 波一更正）`。
- [ ] **Step 2**: :279 `// TODO Wave 9: write system alert for dead events` → `// dead events 的系统告警属通知本体缺口——见 doc-final/BACKLOG.md §I 通知 send/retry STUB 条，本轮战役不做`。
- [ ] **Step 3: 验证**（改名后必须真的还在跑）

```bash
npx jest src/modules/trading/withdraw-transactions/withdraw-workflow.fee-income.spec.ts --silent
```

预期：suite 执行且全绿（不是 0 tests）。
- [ ] **Step 4: Commit**

```bash
git add -A src/
git commit -m "chore(波一): 孤儿 spec 按行为改名（活测试勿删）+ 裸 TODO 改指 BACKLOG"
```

---

### Task 11: 收尾闸 + 承接（终验）

**Files:**
- Create: `doc-final/superpowers/specs/2026-09-09-wave2-quote-and-refno-skeleton.md`（波二骨架）
- Modify: Task 2 文档（若码数复数有变）

- [ ] **Step 1: 三道随手闸**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
```

- [ ] **Step 2: jest 全量（仓库根）**

```bash
npx jest --silent 2>&1 | tail -20
```

判据全绿；**退出码单独取**（`echo $?` 在无管道的复跑上取，或先 `npx jest --silent; echo "exit=$?"`）。
- [ ] **Step 3: 重铺闸（动了 schema）**

```bash
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
```

判据对照 `doc-final/demo/baseline.md` 全绿（花名册 29/29 + COA 恒等式；判红先按 BACKLOG §A 取证再 reset——战役纪律）。
- [ ] **Step 4: 码数复数**——`sed -n '769,925p' src/modules/audit-logging/constants/audit-actions.constant.ts` 按块数 V4/V5/V6 键数，与 Task 2 写入的 47/30/22 对不上则改文档并 commit。
- [ ] **Step 5: 净减行数报数**

```bash
git diff --shortstat $(git merge-base main HEAD)..HEAD
```

- [ ] **Step 6: 立波二骨架**——新文件内容四节：总纲链接（`2026-09-09-acts345-trading-campaign-charter.md` §2 波二）；「承接上一波」（写：波一删码后的名册/文档基线 commit 号、A3 若有「在名册内未删」的码单）；已定事实（单号违规三处清单、报价单六问题、前缀建议 WDR/FDO/WQT/SQT 待 spec 终定）；待定岔口（前缀名终定、取消动作对齐 vs 删）。
- [ ] **Step 7: Commit + 汇报**

```bash
git add doc-final/
git commit -m "chore(波一): 收尾——码数复数/波二骨架/承接记录"
```

任务报告：各任务净减行数、跳过项清单（复现不出零引用的）、A3 名册内码单、发现的真 bug 候选（登 BACKLOG 与否交业主）。

---

## Self-Review 记录

- Spec 覆盖：A1→T5、A2/A3→T6、A4→T9、A5→T8、A6/A7→T10、B→T7、C→T3/T4、D→T2、E→T1、收尾闸/承接→T11。spec §0「不做」各项无任务触碰 ✓
- 类型一致：T7 删 `confirmations`/`sumsubActionId` 展示位与 T9 删 `sumsubExternalActionId` 列是不同物（前者 admin 读面声明、后者 schema 列），互不依赖 ✓；`sumsubActionId`（DepositTransaction 列）本身不在删列清单——它是「后端零写入、前端渲染恒空」项，列去留未在体检取证为零引用，故 T7 只删前端展示位、列不动 ✓
- 占位符扫描：无 TBD/「适当处理」；批量任务（T4）的输入清单由派发者随 prompt 提供，已注明 ✓
