# FeeAccrual 三项收尾 — 设计

日期：2026-06-15
状态：已确认（用户拍板：A 加 fee allDone 条件；B 一行；C `dev:reset:branch` 强限定+TB format）

## 背景

FeeAccrual 重设计落地后留下 3 个非阻塞尾巴（live e2e 已通、累计 905 jest 绿），本轮一次性扫平：

| # | 名 | 痛点 | 范围 |
|---|---|---|---|
| A | recomputeBatch 填 fee 计数 + 加入 allDone | `settlement_batches.total/settledFeeAccrualCount` 永远 0；FEE batch 的完成判定仅靠 outstanding (=0 vacuously true)，无 fee 闭环 | 后端 service + spec |
| B | constant.spec 行 17 cryptoPaths 数组漏 `CRYPTO_SWAP_FEE_COLLECT` | "crypto 路径都该是 CHAIN medium" 断言**跳过**了新路径 | 1 行 spec 数组 |
| C | branch-safe reset 脚本 | `npm run dev:reset` 实际跨栈 reset main；branch 无干净重置能力 | 新脚本 + npm script |

## A. recomputeBatch 填 fee 计数 + allDone 含 fee

**文件**：`src/modules/funds-layer/domain/settlement-batch.service.ts:103-148`

新增一次 `feeAccrual` 聚合，把字段填上 + 把完成条件升级：

```ts
const feeAccruals = await (client as any).feeAccrual.findMany({
  where: { settlementBatchId },
  select: { status: true },
});
const totalFeeAccrualCount = feeAccruals.length;
const settledFeeAccrualCount = feeAccruals.filter((f: any) => f.status === 'SETTLED').length;

const allDone =
  totalAssetCount > 0 &&
  settledAssetCount === totalAssetCount &&
  settledOutstandingCount === totalOutstandingCount &&
  settledFeeAccrualCount === totalFeeAccrualCount;  // 新增：fee 闭环

return (client as any).settlementBatch.update({
  where: { id: settlementBatchId },
  data: {
    status, totalAssetCount, settledAssetCount,
    totalOutstandingCount, settledOutstandingCount,
    totalFeeAccrualCount, settledFeeAccrualCount,  // 新增
    completedAt: allDone ? new Date() : null,
  },
});
```

**等价性**（不破现状）：
- PRINCIPAL batch fee=0 → `0 === 0` 永真 → status 行为不变。
- FEE batch outstanding=0 → 这条"vacuously"原本即真 → 现在多了 fee 闭环、更严，与本金侧对称。

**TDD（2 测）**：
1. FEE batch 含 2 LOCKED accrual → recompute → `total=2, settled=0, status=PROCESSING`。
2. 全 SETTLED → `total=2, settled=2, status=SUCCESS`。

## B. constant.spec.ts:17 cryptoPaths 补 `CRYPTO_SWAP_FEE_COLLECT`

**文件**：`src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts:17`

```diff
-  const cryptoPaths = ['CRYPTO_DEPOSIT_SWEEP', 'CRYPTO_WITHDRAW_FEE_COLLECT', 'CRYPTO_HOTWALLET_FUND', 'CRYPTO_HOTWALLET_RETURN', 'CRYPTO_SETTLE_IN', 'CRYPTO_SETTLE_OUT'];
+  const cryptoPaths = ['CRYPTO_DEPOSIT_SWEEP', 'CRYPTO_WITHDRAW_FEE_COLLECT', 'CRYPTO_SWAP_FEE_COLLECT', 'CRYPTO_HOTWALLET_FUND', 'CRYPTO_HOTWALLET_RETURN', 'CRYPTO_SETTLE_IN', 'CRYPTO_SETTLE_OUT'];
```

跑通：whitelist `CRYPTO_SWAP_FEE_COLLECT.medium === 'CHAIN'` 也被该断言覆盖。

## C. branch-safe reset：`dev:reset:branch` 强限定 + TB format

### 顶层设计
`reset-main.sh` 已经栈参数化（用 `stack-common.sh::load_stack_config <stack>`），只是入口写死 `main`。复用其模板**升一级**为 `reset-stack.sh <stack>`；branch 入口 `reset-branch.sh` = 薄包装 + 3 道隔离闸。`dev:reset` 不动（保持 main 工作流），新增 `dev:reset:branch` 入口。

### 新建/修改
1. **`scripts/reset-stack.sh`**（拷 `reset-main.sh`）：
   - 入参：`STACK="$1"`；校验 `is_valid_stack "${STACK}"`。
   - `load_stack_config "${STACK}"` 取代写死的 `main`。
   - 所有 `[main]` 日志 → `[${STACK}]`。
   - **当 `STACK == branch` 时**，在 `stack-stop.sh branch` 之后、`apply-local-migrations.sh` 之前，调用 `bash "${SCRIPT_DIR}/dev-tigerbeetle.sh" format`（该脚本已硬编码 branch TB 路径 `/tmp/exchange_js_branch/0_0.tigerbeetle` + 3503 端口、零跨栈风险）。其他栈不动 TB（不在本轮范围）。

2. **`scripts/reset-branch.sh`**：3 道闸：
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   # 闸①：当前 git 分支必须是 branch
   current_branch="$(git -C "${SCRIPT_DIR}/.." symbolic-ref --short HEAD 2>/dev/null || echo "")"
   if [[ "${current_branch}" != "branch" ]]; then
     echo "[reset-branch] refuse: git branch is '${current_branch}', expected 'branch'." >&2
     exit 2
   fi
   # 闸②：路径必须含 .wt/branch
   if [[ "$(pwd)" != *".wt/branch"* ]]; then
     echo "[reset-branch] refuse: cwd does not look like branch worktree (no .wt/branch in path)." >&2
     exit 2
   fi
   # 闸③：DATABASE_URL（来自 .env）必须指向 branch DB
   if ! grep -qE "^DATABASE_URL=\"?file:/tmp/exchange_js_branch/dev\.db\"?" "${SCRIPT_DIR}/../.env" 2>/dev/null; then
     echo "[reset-branch] refuse: .env DATABASE_URL is not branch DB." >&2
     exit 2
   fi
   exec bash "${SCRIPT_DIR}/reset-stack.sh" branch
   ```

3. **`package.json`**（branch worktree 的 Exchange_js/package.json）：加一条 npm script：
   ```json
   "dev:reset:branch": "bash scripts/reset-branch.sh"
   ```
   `dev:reset` 不动（保持向后兼容；调用者按需选）。

4. **`stack-common.sh` 的 branch 配置**：探一下 `is_valid_stack` 是否含 `branch`（dev-stop/down 都用了 → 应已含）；若 `load_stack_config branch` 缺则按 main 模板补：DB=`/tmp/exchange_js_branch/dev.db`、APP_DIR、端口段 3500-3503。spec 阶段标记为"实施时验证"。

### 流程
```
[branch] guard 3-gate (git/cwd/.env 都必须 branch)
[branch] stop services (3500/3501/3502)
[branch] TB format (rm /tmp/exchange_js_branch/0_0.tigerbeetle + 重 format)
[branch] TB start (seed.business.ts 需要 TB 在线否则 ConnectionRefused 阻塞)
[branch] prisma apply migrations
[branch] db:base:sync
[branch] db:biz:reset
[branch] db:seed:business
[branch] dev-start-all.sh (nohup, 自动起 backend/admin/client；TB 已在跑、idempotent)
[branch] complete; URLs live: 3500/3501/3502
```
> main 栈不自动起服务（保持向后兼容），仍打印 "Run next" 提示。

### 验证
- 在 branch worktree 执行 `npm run dev:reset:branch` → 应一路绿，最终 sqlite3 数 fee_accruals=0、settlement_batches=0、F_FEE 钱包=2（含 USDT 0 起）、wallets 含 seed。
- 切到 main worktree（或假装 git branch != branch）调用脚本 → 应 exit 2 拒绝。
- 跑一遍 sim → F_FEE(USDT) 0→24.86、F_FEE(AED) 0→88.86（**精确干净对账**，不再带旧 session 基线）。

## 影响面 / 不动表

- **改**：1 service + 1 spec（A）、1 行（B）、2 个 shell + 1 npm script（C）。
- **不动**：FeeAccrualService 业务逻辑；`dev:reset` 原入口；TB 主栈数据；任何 main 路径。
- **不引入**：tooling 依赖、CI 改动、文档大重构。

## 验收

- `npx jest` 0 failed（+2 新测）；`npm run build` 0 error。
- `npm run dev:reset:branch` 在 branch 跑成功且仅作用于 branch；在非 branch 拒绝。
- sim 重跑后 F_FEE 两币种与 Σ SETTLED accrual 精确吻合（USDT/AED 都从 0 起）。
- 后续可读到 batch.totalFeeAccrualCount/settledFeeAccrualCount 非 0；FEE batch 仅在所有 accrual SETTLED 后状态 SUCCESS。
