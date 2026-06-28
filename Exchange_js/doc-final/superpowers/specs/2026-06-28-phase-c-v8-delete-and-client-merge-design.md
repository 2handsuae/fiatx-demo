# Phase C — V8 引擎物理删除 + 客户端流水合并展示

> 状态：设计基线（pre-implementation），已与用户逐段确认
> 日期：2026-06-28
> 适用：reconciliation 模块（删 V8 残留）+ `client-web` 流水页 + `journal-lines` 加工层

---

## 1. 范围

Phase C 收口本次只做两个子项，**互相独立**，可并行实现：

| # | 子项 | 一句话 |
|---|------|--------|
| C-1 | V8 引擎物理删除 | 删 7 个 V8 service+spec、删 schema 列+表、清前端类型引用 |
| C-2 | 客户端流水合并 | `journal-lines` API 增加 group-by-source 加工层；`TransactionHistory.tsx` 主行展示总额，下钻看拆解 |

明确**不在本次范围**的 Phase C 原 deferred 项：Case 处置 workflow、自动 reimbursement、FROZEN_FUNDS COA、capital injection evidence、V7 死服务 hard delete（internal-transfer / fx-eod / fiat-settlement / Outstanding / FeeAccrual / SettlementBatch）。这些下轮再单独立 spec。

---

## 2. 子项 C-1：V8 引擎物理删除

### 2.1 现状

V8 五公式引擎已在 Phase B 退役（runtime 走 `WalletReconRunService`），但代码层留下 7 个 service 和对应 spec、Module provider、controller 路由、前端类型、schema 字段：

- `RedesignReconRunService` 已 deprecated（runtime 委派 wallet 引擎）
- `ReconciliationRunWorkflowService` 唯一 caller `ReconciliationSweepService` 已切到 wallet 引擎
- `CreditNetService` / `FormulaCheckerService` / `InvariantCheckerService` runtime 无人调（仅历史 spec/skewed run row 引用）
- `ReconciliationRunService` / `ReconciliationCaseService` 是旧域 CRUD 生成器（`RUN-{date}-{layer}-{seq}` 格式）
- 数据库 `reconciliation_runs.engineVersion` 列（仅做 V8 vs WALLET_V1 区分，wallet 后单引擎不需要）
- 数据库 `reconciliation_invariant_checks` 表（V8 五公式产物，wallet 引擎不写）

DB 当前 V8 数据 = 0 行（上轮已手工清掉 `RUN-20260626-FIAT-1`），删 schema 零数据损失。

### 2.2 删除清单

| 类别 | 文件 / 操作 |
|------|------------|
| Backend service | `engine/credit-net.service.ts` + spec |
| | `engine/formula-checker.service.ts` + spec |
| | `engine/invariant-checker.service.ts` + spec |
| | `workflow/reconciliation-run-workflow.service.ts` + spec |
| | `workflow/redesign-recon-run.service.ts` + spec |
| | `domain/reconciliation-run.service.ts` + spec |
| | `domain/reconciliation-case.service.ts` + spec |
| Module | `reconciliation.module.ts` 删 provider / export |
| Controller | `controllers/reconciliation-admin.controller.ts` 删 `POST /admin/reconciliation/runs/redesign` 路由（如存在）+ RBAC catalog 同步移除 |
| Frontend | `ReconciliationRunsDetailPage.tsx` 删 `InvariantCheck` interface + 历史引用（不渲染但仍声明） |
| Prisma schema | drop column `reconciliation_runs.engineVersion`；drop model+table `ReconciliationInvariantCheck` |
| Migration | 新增 `prisma/migrations/{ts}_drop_v8_engine_residue/migration.sql`：`DROP TABLE reconciliation_invariant_checks; ALTER TABLE reconciliation_runs DROP COLUMN engineVersion;` |
| Tests | 删上面 7 个 spec；run jest 确保剩余 ~127 测试全绿 |

### 2.3 验收

- `npm run build` exit 0（无 dangling import）
- `npm test` reconciliation module 全绿
- `npm run prisma:generate` + `prisma migrate dev` 成功
- `npm run verify:coa` ALL PASS
- `recon:demo:break` 仍能跑出 5/5 manifest 命中
- Admin 列表页 / 详情页 / Case 详情页 三处 render 截图无空字段无 broken UI

### 2.4 风险

| 风险 | 缓解 |
|------|------|
| 历史 V8 run 行无法承载 engineVersion | DB 已 0 行 V8，删列零损失 |
| 漏删某个 V8 import 导致 TS 编译失败 | build/jest 是双重 gate |
| RBAC catalog 不同步导致前端 403 | 清单中显式列出 catalog 移除步骤 |

---

## 3. 子项 C-2：客户端流水合并展示

### 3.1 现状

`client-web/src/pages/TransactionHistory.tsx` 数据源 = `GET /journal-lines/customer-balance-history`，每个 journal line = 1 行 UI。

**问题**：

- Withdraw 100 + fee 5 → 列表显示 2 行（本金 -100 + 手续费 -5），客户需心算才知道实际扣 105
- Swap 1 笔 → 4 腿 = 4 行，客户看不懂"Swap"业务语义

### 3.2 顶层设计

**Backend 加工层**做 group-by-source 合并，**前端只渲染**。前端零业务计算。

- API 输出 schema 改成嵌套：每个 row = 1 个业务事件（withdraw / swap / payin / deposit / 其他），含 `totalAmount` + 可选 `legs[]` 数组
- 合并规则：
  - **Withdraw**：`sourceType = 'WITHDRAWAL'` 同 `sourceNo` 的所有 journal lines → 1 个 row，`totalAmount = principal + fee`，`legs = [principalLine, feeLine]`
  - **Swap**：`sourceType = 'SWAP'` 同 `sourceNo` 的 4 腿 → 1 个 row，label `"Swap {fromAmount} {fromAsset} for {toAmount} {toAsset}"`，`legs = [legA, legB, legC, legD]`
  - **其他**（PAYIN / DEPOSIT / 杂项）：1 line = 1 row，透传

### 3.3 API 改造

修改 `JournalLinesController.customerBalanceHistory`（或对应 service）：

```ts
// 输出 schema
type CustomerHistoryItem = {
  id: string;                  // group id (sourceNo or journal lineId for ungrouped)
  sourceType: string;          // WITHDRAWAL | SWAP | PAYIN | DEPOSIT | OTHER
  sourceNo: string | null;     // 业务订单号
  eventCode: string;           // 主要事件码（取主行的 eventCode）
  description: string;         // 业务白话（"Withdraw 100 AED" / "Swap 100 AED for 27 USDT"）
  direction: 'IN' | 'OUT';
  totalAmount: string;         // 合并后客户钱包净变动（withdraw=本金+fee；swap=fromAmount）
  createdAt: string;
  legs: JournalLineDetail[];   // 下钻明细（合并的原始 journal lines）
  // Swap 专有字段：
  swapFromAmount?: string;
  swapToAmount?: string;
  swapFromAsset?: string;
  swapToAsset?: string;
  // Withdraw 专有字段：
  principalAmount?: string;
  feeAmount?: string;
};
```

**分页语义**：分组在 server 端完成。`limit/offset` 作用于 **grouped rows**（不是 raw journal lines），返回 `total = 分组后的总数`。这样客户端"每页 25 条"语义稳定，无论一笔 withdraw 折叠了 2 行还是一笔 swap 折叠了 4 行。

### 3.4 前端改造

`TransactionHistory.tsx`：

- Row 主显示：description + totalAmount（signed）
- Row 右侧：可选 `▾` 图标，点开展开 `legs[]` 表格（或弹 drawer）
- 颜色：IN 绿 / OUT 红，沿用现样式
- Pagination + asset 切换不变

新组件（可选）：`TransactionDetailDrawer.tsx` 显示 `legs` 拆解 + 业务关联（withdrawNo / swapNo 等）。

### 3.5 验收

- 客户登录 client-web 看流水：
  - Withdraw 显示 1 行 "Withdraw -105 AED"（=本金 100 + fee 5），点开看到 2 legs
  - Swap 显示 1 行 "Swap 100 AED for 27 USDT"，点开看到 4 legs
  - Deposit / Payin 不变，1 行 1 笔
- 列表 totalAmount 累加 = 钱包余额变动（与 dashboard balance 一致）
- e2e：seed 1 客户 1 withdraw + 1 swap + 1 deposit → 客户端流水页见 3 行（不是 7+ 行）

### 3.6 风险

| 风险 | 缓解 |
|------|------|
| Withdraw fee 跨 pending/posted 时刻不同 | 用 `sourceNo (withdrawNo)` 严格分组，pending 阶段不显示在客户流水（仅 posted） |
| Swap 4 腿可能尚未全 POSTED | 整笔 swap 只在 SUCCESS 后显示（按 sourceNo 取最大状态） |
| `eventCode` 是 leg 级，合并后 row 用哪个？ | 取"代表性 leg"的 eventCode（withdraw=WITHDRAW_NET_POST，swap=SWAP_BUY_CLIENT），通过描述字段消歧 |
| 老版前端如果直接消费旧 API 会破坏 | 加 query param `?grouped=true` 控制 — 默认 false 保后兼容，TransactionHistory 显式传 true |

---

## 4. 实施顺序

1. **C-1 先做**：纯删除，无业务风险，结束后 commit + main 合并
2. **C-2 接着做**：backend 加 group-by 路径（query param 隔离）→ 前端切换 → e2e 截图

两个子项各自独立 commit，互不阻塞。

---

## 5. 不变量 / Out-of-Scope

- 不动 `WalletReconRunService` / `WalletBalanceCheckerService` / 8 COA 模型
- 不动 V7 死服务（internal-transfer / fx-eod / fiat-settlement）—— 下轮再清
- 不引入 Case 处置 workflow / 自动 reimbursement / FROZEN_FUNDS / capital injection evidence
- 客户端流水合并不修改任何 ledger 数据，仅 read-side 加工层
