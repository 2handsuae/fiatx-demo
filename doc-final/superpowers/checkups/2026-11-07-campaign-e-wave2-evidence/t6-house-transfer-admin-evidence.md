# T6 证据 · 公司调拨单——管理台

分支 `claude/campaign-e-wave2-e761d7`，基线 HEAD `d68cac32`（T5）。命令均在 worktree 根执行，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；退出码取自重定向文件，不经管道。

## 1. 闸门

| 闸 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| ① 后端 | `npx tsc --noEmit -p tsconfig.json` | 0 | 0 行输出 |
| ② 管理台 | `cd admin-web && npx tsc -b --noEmit` | 0 | 0 行输出（改完最后一次编辑后又跑一次，仍 0 行） |
| ③ 客户端 | `cd client-web && npx tsc -b --noEmit` | 0 | 0 行输出 |
| ④ 单测 | `npx jest admin-web/src/utils/houseTransferStatusMap.spec.ts admin-web/src/pages/approvalEntityRoutes.spec.ts` | 0 | `Test Suites: 2 passed`，`Tests: 8 passed`（本任务 7 例 + 既有路由表锁 1 例） |
| S6 | `bash scripts/on-stack.sh self verify:rbac` | 1（仅既有 S7） | `✓ S6 … 前端 permissions.ts 162 个权限码字面量，全部能在后端 catalog（275 条）里找到`（T5 后 158 → 本任务 +4 = 162）；`✗ S7` 只列四条 sumsub demo 死行，`TOOLING-DEBT.md:141` 既有，与 T5 报告同款 |

## 2. 失效验证（`houseTransferStatusMap.spec.ts` 会不会红）

- 变异 M1：把 `isHouseTransferStuck` 的判据改成恒 `false` → `npx jest …spec.ts` exit 1，`✕ EXECUTING + POSTING_FAILED 显示为「卡住」…`，`1 failed, 6 passed`。
- 变异 M2：把 `isFeeSweepRoute` 改成「to = F_OPS 或 to = F_FEE」（运营户 → 手续费户也算扫费）→ exit 1，`✕ 只有手续费户 → 运营户是扫费路线…`，`1 failed, 6 passed`。
- 每次变异后 `cp` 还原，`diff -q` 与备份一致，再跑 exit 0（`7 passed`）。

没有 React 组件单测（本仓库无法单测 React 组件，见记忆「admin 三域一致性」）——页面行为的证据是下面的真实渲染走查。

## 3. 走查（self 栈：API 3110 / admin 3111；先前 T5 收尾留下的干净栈）

驱动方式：`scripts/demo-shot.js`（无头 Chrome，按可见文本点击）。**每一步都是真实 UI 点击**，只有「造另外几种态」用了 HTTP API（见 §3.2）。

### 3.1 主线（全程 UI）

| # | 谁 | 动作 | 证据 |
|---|---|---|---|
| 1 | treasury | 打开 `/admin/house-transfers` → 点 Initiate transfer → 资产选 USDT-TRON（**未手填金额**）→ 理由 | `t6-house-transfer-create.png`：弹层默认值——用途 Fee sweep、From = `WA2601018135 · Company Fees · balance 36.000000 USDT`、To = `WA2601018867 · Company Operations`、金额 `36.000000`（= From 全额）、扫费提示一行 |
| 2 | treasury | 点弹层 Initiate | `t6-house-transfer-list.png`：列表一行 `HTR261107263070`、`Pending CFO review`，顶部通知条带 approval 号与 View approval 链接。后端读回：`PENDING_APPROVAL`、`approvalNo APR261107879567` |
| 3 | cfo | 打开 `/admin/governance/approvals/APR261107879567` → Approve → 弹层 Approve | 后端读回 `EXECUTING`、`fundsOrderNo FDO261107089274`（腿 CREATED）。审批页的 Entity Ref 链接指向新详情页（`approvalEntityRoutes` T5 已登记） |
| 4 | treasury | 资金单页 `/admin/funds-orders/FDO261107089274`（`shared_simulation_mode=true`）：`t6-funds-order-leg.png` | 「Linked House Transfer」卡 + 侧栏说明「House-transfer leg — advance it with the ⚡ simulation actions…」，**没有** Sync / Manual Confirm 按钮；⚡ Simulation 只有 Broadcast |
| 5 | treasury | 依次点 ⚡ Broadcast → ⚡ Seen in Mempool → ⚡ Confirm（USDT 是 CRYPTO 资产，对应按钮名 ≠ 法币的 Submit / Settle），每步间隔 3 s | 后端读回 `SUCCESS`、`closeTbTransferIds` 两笔、腿 `CLEARED` |
| 6 | treasury | 打开 `/admin/house-transfers/HTR261107263070` | `t6-house-transfer-detail.png`：`Completed`；Funds Order 腿 `Cleared`；落账两行——`Move cash (89)`：`Dr WA2601018867 cash / Cr WA2601018135 cash`、`36.000000 USDT`、凭证链接；`Close fee income to equity (90)`：`Dr E.INCOME_SWAP_FEE / Cr E.FIRM_EQUITY 8.000000` + `Dr E.INCOME_WITHDRAW_FEE / Cr E.FIRM_EQUITY 28.000000`，`Σ 36.000000 USDT`（= 89 的金额，封顶 = Σ 收入），两个凭证链接 |
| 7 | treasury | 点 90 的第一个凭证链接 | 落到 `/admin/ledger/transfer-evidence/64351a06…`（凭证页：`FEE_INCOME_CLOSE_SWAP`、`E.INCOME_SWAP_FEE → E.FIRM_EQUITY`、`8.000000 USDT`、Source No = HTR 号） |

### 3.2 另外几种态（HTTP API 造态 + UI 渲染 + 截图；为的是让页面的每个分支都被真实渲染过）

| 态 | 造法 | 证据 |
|---|---|---|
| 运营户 → 手续费户（只有 89） | API：treasury 建 `F_OPS → F_FEE 10`，cfo 批，三步 advance 腿 | `t6-house-transfer-detail-ops-to-fee.png`：90 行 `— not applicable (only a fee wallet → operating wallet sweep closes fee income)` |
| 扫费但无收入可结转 | API：手续费户已被首单扫空 10 后再建 `F_FEE → F_OPS 10`（B） | `t6-house-transfer-detail-no-income.png`：`closeTbTransferIds = []`，90 行 `— none (no income to close)`，89 行 10.000000 |
| 卡住（POSTING_FAILED） | API：同时批两张 `F_FEE → F_OPS 10`（C），B 先落后 C 的 89 被真 TB 拒 | `t6-house-transfer-detail-stuck.png`：状态徽章 `Stuck — posting failed`（红，不是 Failed），红色提示条，Failure 字段带后端原因，落账两行 `— not posted`。列表 `t6-house-transfer-list-states.png`：同一行显示 `Stuck — posting failed`，其余 `Completed` |
| 待审批 + 撤回 | API 建 `F_OPS → F_FEE 1`；UI：详情页点 Cancel（`--prompt-text` 自动填理由） | 待审批页（琥珀横幅、Cancel 在头部）与撤回后 `Cancelled` 页均核对（截图落草稿目录，未入库） |
| 建单弹层换 From | UI：From 改选 `Company Operations` | To 自动翻成 `Company Fees`、金额回到 From 全额 `114035.428189`、扫费提示消失（截图落草稿目录，未入库） |

草稿目录 = 本会话 scratchpad，不入库；入库的 PNG 共 8 张（§5）。

## 4. 栈收尾

`bash scripts/stack.sh reset self`（exit 0，`verify:demo-data ALL PASS`）→ `bash scripts/stack.sh up`（exit 0）→ `bash scripts/on-stack.sh self demo:all`（exit 0，`花名册：35/35 符合预期`、`asserts: 5/5 PASS`、`demo:all DONE`）→ `bash scripts/on-stack.sh self verify:coa`（exit 0，4 条恒等式 + `负余额检查 通过 (105 个科目全部 ≥ 0)`）。收尾后 `GET /admin/house-transfers` = `{"items":[],"total":0}`；`git status` 无 `doc-final/demo/data.md` 改动（demo:all 没有弄脏它）。

## 5. 截图清单（本目录）

- `t6-house-transfer-create.png`（必交）建单弹层，默认值已填
- `t6-house-transfer-list.png`（必交）列表，建单后
- `t6-house-transfer-detail.png`（必交）详情，SUCCESS，89 + 90 两行
- `t6-funds-order-leg.png` 资金单页：调拨腿回链 + 侧栏说明 + ⚡ 面板（`FundsOrderDetail` / `FundsOrderList` 改动的渲染证据）
- `t6-house-transfer-detail-ops-to-fee.png` / `-no-income.png` / `-stuck.png`，`t6-house-transfer-list-states.png`

每张 PNG 都用 Read 看过，渲染内容与上表一致。

## 6. 超出 brief 清单的改动（及理由）

- `FundsOrderDetail.tsx`：`resolveParent` 加 House transfer、`parentLinkAllowed` 加 `HOUSE_TRANSFERS_READ` 门、`isHouseTransferLeg` 把调拨腿排出 `canPush`（后端 `loadPushable` 显式拒调拨腿，页面不能再摆 Sync / Manual Confirm 两个点了必被拒的按钮）、侧栏一段说明。`FundsOrderList.tsx`：筛选项 + 父单列。——T5 报告 §8.8 / 证据 §10 明确点名「T6 的活」；同款登记点对齐（改前写下预期数、改后 `rg` 核对）：`FundsOrderList.tsx` 付款单 4 处（`ParentType`、item 字段、筛选项、`parentOf`）→ 调拨单 4 处；`FundsOrderDetail.tsx` 付款单 3 处（接口字段、`resolveParent`、`parentLinkAllowed`）→ 调拨单同样 3 处，另加 3 处调拨腿特有（`houseTransferId` 字段、`isHouseTransferLeg` 排出 `canPush`、侧栏说明块）。
- 搜法边界：在 `admin-web/src` 内用 `rg "CAPITAL_INJECTION\b|'VENDOR_PAYMENT'|'INTERNAL_TRANSFER'"` 与 `rg -l "capital-injections|cinNo"` 找同款登记点，除 `App.tsx` / `DashboardLayout.tsx` / `approvalEntityRoutes.ts`（T5 已加）/ 两个 FundsOrder 页 / `permissions.ts` 外未发现别处；动态拼接的路径与后端不在这两条搜法覆盖内。
