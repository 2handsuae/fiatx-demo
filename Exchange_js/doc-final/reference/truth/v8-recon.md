# V8 对账流程 — 当前实现真相

Last Verified: 2026-07-04（核对方式：三路 subagent 走查 + 主线抽验 effectiveDate 透传/资本注入/reimbursement 残留）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。
> ⚠️ 历史：V8 经 I1-I5 → credit-net 五公式 → Phase B 三轮重构；**旧 credit-net 五公式引擎已 Phase C 物理删**（11 文件全 0 引用）。本文只写现行 Phase B。

---

## 0. 一句话定位

客户/公司资产对账：**内部账本**（TB / AccountFlow 投影）vs **外部数据**（银行/HexTrust/链上，归一化为 external_balances + external_statement_lines）**逐物理钱包 1:1 直比** + 差异分五桶 + 平账处置。实时1:1 后模型 = 逐钱包直比（不再五公式分层）。**当前止于 Case OPEN + 推单一个处置动作**；人工核实/RESOLVED/SLA 及其余 6 动作 deferred。

## 1. 状态机

- **Run**：`reconciliation_runs`（含五桶计数 matched/inTransit/softFlag/break + 三元组 opened/reObserved/closed）
- **Case**：`OPEN → RESOLVED`（auto-heal 或人工，但人工路径 deferred）；`bucket` 列 = IN_TRANSIT/SOFT_FLAG/BREAK；**每钱包跨日唯一 OPEN**
- **五桶**（`bucket-classifier.ts → computeBucket()`）：残差 = `delta − 在途签名和`；残差≠0→**BREAK**；残差=0且有在途→**IN_TRANSIT**；残差=0且有流水异常→**SOFT_FLAG**；否则→**MATCHED**（命中即止，180 组网格验证互斥）
- 锚点：`bucket-classifier.ts → computeBucket()` ｜ prisma `reconciliation_runs`/`reconciliation_cases`

## 2. 数据模型要点

- `reconciliation_run_wallets`（**Round3 快照表**）：run 完成时每钱包定格一行（bucket/内外余额/差额/在途/流水计数/caseNo）——根治"run 详情历史数字漂移"bug
- `reconciliation_line_items`：`matchStatus` = MATCHED/ORPHAN_INTERNAL/ORPHAN_EXTERNAL/AMOUNT_MISMATCH/IN_TRANSIT；IN_TRANSIT 挂 `internalSourceNo=fundsOrderNo`；**delete-then-insert 重写**（每 run 清空）
- `external_balances`（头）+ `external_statement_lines`（行）：外部数据归一化两表
- `account_flows`（**AccountFlow 投影**）：2 行/transfer + `walletRef`/`externalRef`/`isExternalCrossing` + **`effectiveDate`**（生效日/结算日）
- 锚点：prisma schema `reconciliation_*` ｜ `account-flow-projector.service.ts`

## 3. 关键流程

- **触发**：`ReconciliationSweepService → dailyRecon()` `@Cron('0 30 2 * * *', Asia/Dubai)`（T+0 银行/托管账单入库后，对 T-1）→ `WalletReconRunService.run()`
- **Run 编排**（`wallet-recon-run.service.ts → run()`）：
  ① **内部恒等预门** `computeInternalIdentity()`（TB 直读，验 `Σ CLIENT_ASSET == Σ CLIENT_PAYABLE+DEPOSIT_SUSPENSE`，破则 INTERNAL_BREAK 中止）
  ② **逐钱包余额** `WalletBalanceCheckerService → checkBalance()`：客户钱包 `external == PAYABLE[c]+SUSPENSE[c]`、公司钱包 FIRM_OPS/SET/FEE 1:1 直比；内部余额读 `account_flows`（POSTED，`effectiveCutoffFilter` 过滤）
  ③ **流水匹配** `WalletFlowMatcherService → matchFlows()` 三轮：Pass1 同 `externalRef` 跨钱包互证 / Pass2 金额+方向+窗口模糊 / Pass3 **在途**（孤儿外部行 ↔ `FundsOrderService.findNonTerminalByWallet` 非终态资金单，单号精确优先+金额方向 72h 兜底）；`isExternalCrossing=true` 过滤排除内部 reclass
  ④ 分桶 → 开 case（每钱包唯一 OPEN，`walletRef=null` 无主外部账户直接 BREAK）→ 写 `reconciliation_run_wallets` 快照 → `autoHealCases()`（本轮未破的旧 OPEN case → RESOLVED）
  ⑤ **审计** `recordSystem`：`RECON_CASE_OPENED` / `SYSTEM_RECON_CASE_AUTO_HEALED` / `SYSTEM_RECON_RUN_COMPLETED`
- **effectiveDate 平账准备**：`effective-cutoff.ts → effectiveCutoffFilter()`（生效日<截止日全进、=截止日按物理时刻卡，逐笔等价保真）；回填透传链 `FundsOrderService.advance(opts.effectiveDate)` → `writeEvidence(effectiveDate)` → `account_flows.effectiveDate`
- **推单处置**（`disposition/`，7 平账动作**第 1 个**）：`PushOrderService`——同步腿（`ReceiptLookupService` 查已摄入外部对账单行找**唯一回执**：tier-1 参考号三字段 membership / tier-2 钱包+方向+金额+时间窗）+ 人工腿（operator 强推·三件套证据）；两腿都走 `driveToCleared()` **逐步 `advance` 不直写 TB、不跳步**、回填生效日透传；双端点 `POST /admin/funds-orders/:no/push/sync|manual` + 审计 `RECON_PUSH_ORDER_SYNCED/MANUAL`
- **admin**（`reconciliation-admin.controller.ts` + `push-order.controller.ts`）：Run 驾驶舱（结论条+五桶点击过滤+三元组跳转+快照明细表）/ Case 详情（桶徽章+差额解释五格+观察历史+流水单表混排+IN_TRANSIT"已推进待重对账"徽记）/ 一键重对账；资金单详情页推单两按钮（swap 腿+终态门控）
- 锚点：`wallet-recon-run.service.ts → run()/computeInternalIdentity()/upsertCaseForWallet()/autoHealCases()` ｜ `engine/v2/wallet-balance-checker.service.ts → checkBalance()` ｜ `engine/v2/wallet-flow-matcher.service.ts → matchFlows()` ｜ `disposition/push-order.service.ts → syncPush()/manualPush()/driveToCleared()` ｜ `disposition/receipt-lookup.service.ts → findUniqueReceipt()` ｜ `reconciliation-query.service.ts` ｜ `sweep/reconciliation-sweep.service.ts → dailyRecon()`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- **止于 Case OPEN**：差异处理的 Finance 人工核实/补录/RESOLVED + 24h SLA 升级 MLRO/CFO **deferred**（Case 五桶下钻/驾驶舱已交付，人工处置工作流未做）
- **7 平账处置动作只做了推单**：补单/冲正/冲销/豁免/偿付 5-6 个 deferred
- 🐛 **`reObservedCount` 恒为 0**：line item 每 run delete-then-insert，`foundByRunId` distinct 恒 1；已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`），正确修法需专用计数列
- **Reimbursement 残留**：表已 drop，但 `reconciliation_case.reimbursementObligationId` 孤立外键列 + `reset-business-data.ts` 引用 + `permissions.ts → REIMBURSEMENT_OBLIGATIONS_READ` 孤儿权限（53f711c 清理漏网）均未清；偿付义务工作流本身 deferred（留 hook）
- **FIRM Treasury snapshot 历史残留**：旧 Run 历史数据里余额标记行误入交易下钻（Phase B 后新 run 不产生，历史未清）
- **资本注入 evidence 待核**：CAPITAL_INJECTION seed transfer 在，但 FIRM_ASSET 流水是否有对应 evidence/account_flow 行待确认（roadmap 记为欠）
- **deferred 功能**（roadmap ADVANCED）：季度 Proof of Reserves / 对账报告导出 / LP 仓位对账

## 5. 锚点

`clearing-settle/reconciliation/`：`workflow/wallet-recon-run.service.ts`（Run 编排，主文件）｜ `engine/v2/{wallet-balance-checker,wallet-flow-matcher}.service.ts` + `{bucket-classifier,effective-cutoff}.ts`（纯函数）｜ `disposition/{push-order,receipt-lookup}.service.ts` + `push-order.controller.ts`（平账推单）｜ `domain/reconciliation-query.service.ts`（读快照）｜ `sweep/reconciliation-sweep.service.ts`（cron）｜ `controllers/reconciliation-admin.controller.ts`
`accounting/tigerbeetle/projector/account-flow-projector.service.ts`（AccountFlow 投影，注册在 TigerBeetleModule 避循环依赖）
前端：`admin-web/ReconciliationRuns{List,Detail}Page.tsx`、`ReconciliationCases{List,Detail}Page.tsx`、`FundsOrderDetail.tsx`（推单按钮）
demo：`scripts/recon-demo.ts`（九场景）+ `scripts/recon-rerun.ts`（离线重跑）
