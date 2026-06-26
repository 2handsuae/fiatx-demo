# Phase B 对账重写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `2026-06-26-phase-b-reconciliation-design.md`，搭起"按钱包 1:1 外部对账"基建——给 TB 证据加 walletRef/externalRef/isExternalCrossing 三列、记账写入路径逐腿供给、新建 AccountFlow 投影表、改 Account Statement 页按钱包合并视图；引擎重写为 §7 余额直比 + §8 流水匹配；recon:demo 重写为 pass/break。

**Architecture:**
- 流水基建（T1-T3）：schema 加列 → 记账写入处 4 条流程逐腿填值（充值/提现/swap/手续费）→ 新建 `AccountFlow` 投影表（materialized，2 行/transfer，记账处或后台投影器写入）。
- Account Statement 页改用 AccountFlow（T4）：左栏可选「按账户 / 按钱包」，按钱包视图合并该客户 `SUSPENSE[c]+PAYABLE[c]` / 该公司钱包对应权益账户的流水；两视图切换：全量 / 外部对账（`isExternalCrossing=true`）。
- 对账引擎重写（T5-T7）：弃 V8 五公式；新 `WalletReconEngineService` = 第一层恒等前置门 → 逐钱包余额直比（§7）→ 逐笔流水匹配（§8）；ExternalBalance/Case/LineItem 加 walletRef/coaCode/ownerNo 定位列。
- recon:demo 重写（T8）：anchor-free pass/break + manifest 答案键，对每钱包逐项验。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle；React admin-web。

---

### Task 1: TB 证据加 walletRef / externalRef / isExternalCrossing

**Files:**
- Modify: `prisma/schema.prisma`（`TbTransferEvidence` model）
- Create: `prisma/migrations/<ts>_evidence_wallet_ref/migration.sql`
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（写入 + 投影查询）

- [ ] **Step 1: schema 加 4 列**

```prisma
model TbTransferEvidence {
  // existing fields...
  debitWalletRef       String?
  creditWalletRef      String?
  externalRef          String?
  isExternalCrossing   Boolean  @default(false)
  @@index([debitWalletRef])
  @@index([creditWalletRef])
  @@index([externalRef])
}
```

- [ ] **Step 2: db push 到 main + 写迁移文件（参 `20260625160000_withdraw_internal_fund_link` 风格 — RedefineTables）**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx prisma db push
```
然后写 `prisma/migrations/20260626120000_evidence_wallet_ref/migration.sql`（ALTER TABLE 加 4 列 + 3 个索引）。

- [ ] **Step 3: tb-evidence.service.writeEvidence 接受 4 个新字段（向后兼容默认 null/false）**

```ts
export interface WriteEvidenceParams {
  // existing...
  debitWalletRef?: string | null;
  creditWalletRef?: string | null;
  externalRef?: string | null;
  isExternalCrossing?: boolean;
}
```
持久化时全部传到 prisma create。

- [ ] **Step 4: 跑 build + verify:coa（确保新增列不破现有对账）**

```bash
npm run build && DATABASE_URL=... TB_ADDRESS=... npm run verify:coa
```
Expected: build 绿；verify:coa ALL PASS。

- [ ] **Step 5: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260626120000_evidence_wallet_ref/ src/modules/accounting/tigerbeetle/tb-evidence.service.ts
git commit -m "feat(recon): TB evidence + walletRef/externalRef/isExternalCrossing"
```

---

### Task 2: 记账写入处逐腿填值（4 条流程）

判定规则（不维护分类表，写代码处遵循）：
- `externalRef != null` ⇒ `isExternalCrossing = true`；否则 false。
- 客户负债行（SUSPENSE/PAYABLE 该客户）`walletRef` = 该客户钱包 ID（payin.toWalletId / payout.fromWalletId / withdrawTransaction.fromWalletId 等）。
- 公司权益行（FIRM_OPS/SET/FEE）`walletRef` = 对应公司钱包 ID。
- 聚合行（CLIENT_ASSET/FIRM_ASSET）`walletRef` 取该笔涉及的具体钱包（便于审计），不参与对账。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（充值到账 + 放行）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（提现 NET/FEE POST + 公司侧 FEE_FIRM）
- Modify: `src/modules/trading/swap-transactions/swap-settlement.service.ts`（4 腿逐腿）
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts`（如执行层包了 evidence，则在 executeTransfer/postPending 入参增加可选 walletRef/externalRef 透传）

- [ ] **Step 1: 充值到账 (`DEPOSIT_ASSET_TO_SUSPENSE`) — true**

deposit-workflow.service.ts 写 TB Step 1 处（旧约 line 411-440）：
- `debitWalletRef = null`（聚合 CLIENT_ASSET 资产行 — walletRef 仍填具体钱包供审计：=`payin.toWalletId`）
- `creditWalletRef = payin.toWalletId`（客户充值地址）
- `externalRef = payin.txHash || payin.referenceNo`
- `isExternalCrossing = true`

- [ ] **Step 2: 合规放行 (`DEPOSIT_SUSPENSE_TO_PAYABLE`) — false**

deposit-workflow.service.ts 写 TB Step 2 处（约 line 464-468）：
- `debitWalletRef = creditWalletRef = payin.toWalletId`（同一钱包，钱不挪）
- `externalRef = null`
- `isExternalCrossing = false`

- [ ] **Step 3: 提现 NET POST + FEE POST + FEE_FIRM**

withdraw-workflow.service.ts finalize（约 line 466-544）：
- NET_POST / FEE_POST：客户负债侧出账。`debitWalletRef = withdraw.fromWalletId`（客户出币钱包/vIBAN），`creditWalletRef = withdraw.fromWalletId`（资产聚合腿也带钱包供审计）；`externalRef = withdraw.txHash || withdraw.referenceNo || payout.txHash`；`isExternalCrossing = true`。
- FEE_FIRM（公司侧 FIRM_ASSET→FIRM_FEE）：`creditWalletRef = FIRM_FEE_wallet`（公司手续费钱包）；`debitWalletRef = null`（聚合资产）；`externalRef = 同上 fee 那笔 ref`（与客户侧 FEE_POST 同 ref，实现 §8 同 ref 双行交叉印证）；`isExternalCrossing = true`。

- [ ] **Step 4: swap 4 腿**

swap-settlement.service.ts initiateLegPending / postLeg（每腿 a.eventCode 处）：
- 跨钱包真实腿（C_DEP↔F_OPS、F_SET↔C_VIBAN、客户负债→FIRM_FEE）：`debitWalletRef`/`creditWalletRef` = 该腿对应物理钱包；`externalRef = swap.swapNo + ':' + legSeq + ':' + (txHash||refNo)` 或留 null 待回填；`isExternalCrossing = true`。
- 纯账面腿（若存在）：walletRef 填该客户钱包；externalRef null；isExternalCrossing false。

- [ ] **Step 5: 跑 demo 并 grep 新列已填**

```bash
bash /tmp/exchange_js_main/start-stack.sh && sleep 12
DATABASE_URL=... TB_ADDRESS=... npx ts-node -r tsconfig-paths/register scripts/demo-all.ts
sqlite3 /tmp/exchange_js_main/dev.db "SELECT eventCode, debitWalletRef IS NOT NULL AS dW, creditWalletRef IS NOT NULL AS cW, externalRef IS NOT NULL AS ref, isExternalCrossing FROM tb_transfer_evidence GROUP BY eventCode;"
```
Expected: `DEPOSIT_ASSET_TO_SUSPENSE`/`WITHDRAW_*_POST`/`WITHDRAW_FEE_FIRM`/swap 真实腿 isExternalCrossing=1 且 externalRef 非空；`DEPOSIT_SUSPENSE_TO_PAYABLE` 全 0/0/null/0。

- [ ] **Step 6: 提交**

```bash
git commit -m "feat(recon): wire walletRef/externalRef into deposit/withdraw/swap accounting"
```

---

### Task 3: 新建 AccountFlow 投影表

**Files:**
- Modify: `prisma/schema.prisma`（add `AccountFlow` model）
- Create: `prisma/migrations/<ts>_account_flow_table/migration.sql`
- Create: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（writeEvidence 后调 projector）

- [ ] **Step 1: schema**

```prisma
model AccountFlow {
  id                   String   @id @default(uuid())
  tbTransferId         String
  tbAccountId          String
  walletRef            String?
  direction            String   // IN | OUT
  amount               Decimal
  isExternalCrossing   Boolean  @default(false)
  externalRef          String?
  eventCode            String
  sourceType           String
  sourceNo             String
  transferType         String   // POSTED | PENDING | POST_PENDING | VOID_PENDING
  assetCode            String
  createdAt            DateTime
  @@index([tbAccountId, createdAt])
  @@index([walletRef])
  @@index([externalRef])
  @@index([tbTransferId])
  @@map("account_flows")
}
```

- [ ] **Step 2: db push + 迁移文件**

- [ ] **Step 3: AccountFlowProjectorService**

写一个纯函数 `projectEvidence(evidence): AccountFlow[2]`：1 笔 evidence 投出 2 行（debit→OUT、credit→IN），共享 evidence 的 sourceType/eventCode/externalRef/isExternalCrossing/createdAt，各自 tbAccountId/walletRef/direction/amount。

- [ ] **Step 4: writeEvidence 持久化 evidence 后同 tx 调 projector 写 2 行 AccountFlow**

注意幂等：(tbTransferId, tbAccountId) 唯一约束，重复投影忽略。

- [ ] **Step 5: 回填脚本**

`scripts/backfill-account-flow.ts`：扫 `tb_transfer_evidence` 全量投影到 `account_flows`（一次性补齐历史数据）。

- [ ] **Step 6: 验证**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT COUNT(*) AS evidence FROM tb_transfer_evidence; SELECT COUNT(*) AS flows FROM account_flows;"
```
Expected: `flows == 2 * evidence`。再抽样验：

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT walletRef, direction, COUNT(*) FROM account_flows WHERE eventCode='DEPOSIT_ASSET_TO_SUSPENSE' GROUP BY walletRef, direction LIMIT 5;"
```

- [ ] **Step 7: 提交**

```bash
git commit -m "feat(recon): AccountFlow projection table (2-rows-per-transfer)"
```

---

### Task 4: Account Statement 页改用 AccountFlow + 钱包视图

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`（端点加 `mode=account|wallet` + `crossingOnly`）
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（新方法 `getWalletStatement(walletRef, crossingOnly?)`）
- Modify: `admin-web/src/pages/AccountStatementPage.tsx`（左栏切换 账户/钱包；右栏加 全量/外部对账 toggle）

- [ ] **Step 1: 后端方法 `getWalletStatement(walletRef, crossingOnly)`**

读 `account_flows where walletRef=? [and isExternalCrossing=true]`，运行余额累加（按 §1 资产/负债类别分号），返回 items + currentBalance + 元信息（walletRef、ownerNo、关联账户列表 [SUSPENSE,PAYABLE] 等）。

- [ ] **Step 2: 端点扩参**

`/admin/tb/account-statement` 增加 `walletRef`（与 `tbAccountId` 互斥）+ `crossingOnly` 布尔。

- [ ] **Step 3: 前端**

`AccountStatementPage.tsx`：左栏顶部 segmented "Accounts | Wallets"；Wallets 模式列 wallets（取 distinct walletRef）+ owner 标签；右栏顶部 toggle "全量 / 外部对账（仅 true）"。

- [ ] **Step 4: 渲染验证**

`bash /tmp/exchange_js_main/start-stack.sh` → 预览导航到 Account Statement → 切到 Wallets 视图 → 选一个客户钱包 → 看到合并的 SUSPENSE+PAYABLE 流水；切外部对账模式 → 仅看到 isExternalCrossing=true 的行；截图。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(recon): Account Statement adds wallet view + crossingOnly toggle (reads AccountFlow)"
```

---

### Task 5: ExternalBalance / Case / LineItem 加定位列

**Files:**
- Modify: `prisma/schema.prisma`（`ExternalBalance`/`ReconciliationCase`/`ReconciliationLineItem`）
- Create: `prisma/migrations/<ts>_recon_locator/migration.sql`

- [ ] **Step 1: schema 加列**

```prisma
model ExternalBalance {
  // existing...
  walletRef  String?
  coaCode    String?  // 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE' | 'E.FIRM_OPS' ...
  ownerNo    String?
  @@index([walletRef])
}
model ReconciliationCase {
  // existing...
  walletRef  String?
  coaCode    String?
  ownerNo    String?
  @@index([walletRef])
}
```
`ReconciliationLineItem` 已有引用 case + 异常类型字段，按需补 `externalRef`/`walletRef` index。

- [ ] **Step 2: db push + 迁移**

- [ ] **Step 3: 提交**

```bash
git commit -m "feat(recon): wallet/coa/owner locator columns on ExternalBalance + Case"
```

---

### Task 6: 余额对账（§7，1:1 直比）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts`

- [ ] **Step 1: 接口**

```ts
checkBalance(walletRef, externalClosing): { pass: boolean; internal: { payable?; suspense?; firmEquity? }; delta }
```
- 客户钱包：internal = `PAYABLE[c] + SUSPENSE[c]`（从 account_flows 累计或直接读 TB），pass = `external == internal`。
- 公司钱包：internal = 对应权益账户余额，pass = `external == internal`。
- pass=false → 调 Case 服务开 Case，附 walletRef/coaCode/ownerNo/Δ。

- [ ] **Step 2: 单测**

`wallet-balance-checker.service.spec.ts`：
- 客户钱包 external=PAYABLE+SUSPENSE → PASS。
- 客户钱包 external=PAYABLE 但 SUSPENSE≠0 → FAIL（不分层）。
- 客户钱包 external≠PAYABLE+SUSPENSE → FAIL + 正确 Δ。
- 公司钱包 1:1 → PASS / FAIL。

- [ ] **Step 3: 提交**

```bash
git commit -m "feat(recon): per-wallet balance checker (external == PAYABLE+SUSPENSE / firm 1:1)"
```

---

### Task 7: 流水对账 + 引擎编排（§8 + §10）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts`（新端点 `/admin/reconciliation/runs/wallet` 触发）

- [ ] **Step 1: 流水匹配器**

`matchFlows(walletRef, externalLines): { matched, orphanExternal, orphanInternal, mismatch }`
- 内部源 = `account_flows where walletRef=? AND isExternalCrossing=true`。
- 匹配键 = (金额, 方向, 时间窗±60min, externalRef)；externalRef 精确为主。
- 三类异常按 §8。

- [ ] **Step 2: Run 编排器**

`WalletReconRunService.run(cutoff)`：
1. 前置：跑 `verify-realtime-coa` 等价逻辑；不平 → Run status=INTERNAL_BREAK，停。
2. 列出全部外部对账单（每钱包 ExternalBalance + ExternalStatementLine）。
3. 逐钱包：balanceChecker → flowMatcher → 异常入 Case/LineItem。
4. 汇总 walletsChecked / casesOpened / orphan/mismatch counts / PASS|BREAK。

- [ ] **Step 3: 端点**

`POST /admin/reconciliation/runs/wallet { cutoff }` → 触发 run，返回 runId。复用现有 Recon Runs / Cases 页（加 walletRef/coaCode 列）。

- [ ] **Step 4: 跨钱包同 ref 互证（提现手续费 / swap 本金）**

flowMatcher 额外断言：客户侧 OUT(ref X) 与公司侧 IN(ref X) 金额相等。不等 → 也开 Case（cross_match_mismatch）。

- [ ] **Step 5: 单测**

3 类异常 + 跨 ref 互证 case，各一个测试。

- [ ] **Step 6: 提交**

```bash
git commit -m "feat(recon): per-wallet flow matcher + run orchestrator (replaces V8 formula engine)"
```

---

### Task 8: recon:demo 重写（pass + break）

**Files:**
- Modify: `scripts/recon-demo.ts`（重写为按钱包生成外部对账单 + 注入 4 类异常）
- Modify: `package.json`（demo 脚本继续指向 main 栈 DB）

- [ ] **Step 1: pass 模式**

从当期 account_flows 反推：每钱包外部行 = 其 isExternalCrossing=true 行（金额/方向/externalRef/时间）；外部期末余额 = 钱包内部余额（客户 = PAYABLE+SUSPENSE，公司 = 对应权益）。anchor-free（从 demo 数据动态取）。

- [ ] **Step 2: break 模式 + manifest**

按 spec §13 注入 4 类：删一条外部行（→ORPHAN_INTERNAL）、加一条外部行（→ORPHAN_EXTERNAL）、改金额（→MISMATCH）、改一个外部余额（→balance break）。写 manifest JSON（哪个 walletRef、哪条 ref、哪种异常）。

- [ ] **Step 3: 跑 pass / break + 断言**

```bash
bash scripts/on-stack.sh main recon:demo:pass   # 0 case 全 PASS
bash scripts/on-stack.sh main recon:demo:break  # case 数量与 manifest 对得上
```
注：`recon:demo*` 当前 package.json 写死 branch DB（CLAUDE.md 已注明），脚本里改成读环境变量；测试用 `bash scripts/on-stack.sh main recon:demo:pass` 包装。

- [ ] **Step 4: 提交**

```bash
git commit -m "feat(recon): rewrite recon:demo for per-wallet pass/break with manifest"
```

---

### Task 9: 旧引擎 neuter（不删）+ 死路径文档化

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/formula-checker.service.ts`（标 @deprecated + log warning + 不暴露给新 run）
- Modify: `src/modules/clearing-settle/reconciliation/engine/credit-net.service.ts` 同上
- Modify: `src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.ts` 同上

- [ ] **Step 1: 加 @deprecated JSDoc + console.warn**

```ts
/** @deprecated V8 five-formula engine; replaced by WalletReconRunService (2026-06-26). Phase C will remove. */
```

- [ ] **Step 2: 旧 RedesignReconRunService 改为调用新 WalletReconRunService（保留旧端点，body 重定向）**

避免破坏既有 admin 页 / 既有 Run 列表。

- [ ] **Step 3: 提交**

```bash
git commit -m "chore(recon): deprecate V8 formula engine; route runs to wallet engine"
```

---

### Task 10: e2e 验收

- [ ] **Step 1: 跑全流程**

```bash
bash /tmp/exchange_js_main/start-stack.sh && sleep 12
# 走一遍 demo:all
bash scripts/on-stack.sh main demo:setup
bash scripts/on-stack.sh main demo:all
# pass + break
bash scripts/on-stack.sh main recon:demo:pass
bash scripts/on-stack.sh main recon:demo:break
# 内部恒等
DATABASE_URL=... TB_ADDRESS=... npm run verify:coa
```
Expected:
- demo:all 流程账目 PASS（COA 四式平）。
- recon:demo:pass → 0 Case 全 PASS。
- recon:demo:break → Case 数量 / 类型 / walletRef 与 manifest 完全对得上。
- verify:coa → ALL INVARIANTS PASS。

- [ ] **Step 2: 渲染验证**

预览 admin：
- Account Statement → Wallets 视图选一个客户钱包 → 看 SUSPENSE+PAYABLE 合并流水（截图）。
- Recon Runs → 触发一次 wallet run → 列表展示 walletsChecked / casesOpened；Case 详情看到 walletRef/coaCode/Δ + 三列对比（PAYABLE/SUSPENSE/external）。
- External Balances → 看到带 walletRef 的逐项余额。

- [ ] **Step 3: 文档更新**

更新记忆 [[funds-model-realtime-1to1-redesign]]：把 Phase B done 写进去，记下 manifest 路径、新引擎入口、deferred 项。

- [ ] **Step 4: 提交**

```bash
git commit -m "test(recon): e2e Phase B (per-wallet recon + demo pass/break)"
```

---

## Deferred（不在本期，写在记忆里）
- Case 处置工作流 / SLA / 自动平账。
- 资本注入流水补写（FIRM_ASSET 缺资本那笔的 evidence 行）。
- 旧 V8 引擎物理删除（Phase C 清死码统一删）。
- 模糊匹配（金额相近、时间窗内但无 ref）—— 默认关，留开关。
