# Recon Run/Case 页面贴齐 admin 前端规范

> 设计文档 · 2026-06-28 · 分支 main
> 在 [2026-06-27 recon UI driver cockpit redesign](2026-06-27-recon-ui-driver-cockpit-redesign.md) 落地的基础上，对 ReconciliationRuns 与 ReconciliationCases 共 4 个页面做"贴齐 [admin 前端规范](../../rules/frontend-admin.md)"的扫尾。本次**不重排信息架构**——驾驶台/调查台的语义切分维持上一次设计。本期只修：① 硬违规；② Sidebar 字段对齐规范登记表；③ 全部 UUID / 内部 id 展示改成业务 No/Code；④ recon 模块 traceId 生成违规。

## 1. 范围（边界声明）

| 改动类别 | 在范围 | 不在范围 |
|---|---|---|
| 硬违规修复 | ✓ Hero label / Sidebar 多块 / walletRef 短 UUID 暴露 / Hero 灰色说明文 | — |
| Sidebar 字段对齐 | ✓ Run + Case 详情 Sidebar Identity Summary / Lifecycle 字段集严格 1:1 对齐 `Per-entity Sidebar Fields` 登记表 | — |
| ID → No/Code 全清扫 | ✓ 4 个页面所有 UUID / 内部 id 展示位置（含 navigate URL 参数） | React `key={obj.id}` 内部绑定不算（不暴露给操作员） |
| 后端 read model 补齐 | ✓ 4 个 endpoint 补 No 字段 + 1 个 list filter 加 `runNo` 参数 | — |
| traceId 违规修复 | ✓ recon 模块 5 处生成点改用 `randomUUID()` + Case update 不再覆盖 traceId | recon 之外的模块（即便有同类违规）不在本期 |
| RunsDetail Body 信息梯度重构 | ✗ 推后（见 §6 后续考虑） | — |
| Phase C Case 处置 workflow | ✗ 不涉及 | — |

## 2. 底层逻辑

本期 = **rules compliance 扫尾**，不是 redesign。每条改动都能在 [`doc-final/rules/frontend-admin.md`](../../rules/frontend-admin.md) 或 [`doc-final/rules/audit-logging.md`](../../rules/audit-logging.md) 找到对应规则编号。如果某条改动只是"我觉得更好"，就归入 §6 后续考虑。

CLAUDE.md 规则 #3：「有稳定业务键 → **禁止**以 `id` 作主查询合同」+ 记忆 `feedback_no_expose_id`：「实体间关联必须用业务键(customerNo 等)，不展示 UUID」。

## 3. CasesDetail 终态

### 3.1 Hero（`bg-adm-card`，首段）

```
████  {caseNo}                  ← 19px mono amber，无 label
─────────────────────────────────
STATUS       [badge]            ← 加 label
SEVERITY     [badge]            ← 加 label
BOOK         CLIENT | FIRM
ASSET        {assetCode}
Δ            {deltaAmount}      ← 关键数字进 Hero
```

**删除项**：
- Hero 块后接的灰色说明文 `"Investigation-only · Disposition workflow in Phase C"`（违反 Hero 只放 label:value）；运营熟悉后是噪音
- 任何 Hero 内 `<Cap>` 标签（如有）

### 3.2 Body（按 `divide-y divide-adm-border` 切片）

| 段 | 信息梯度类别 | 内容 | 改动 |
|---|---|---|---|
| ① Account Identity | Core Context | walletNo / COA / Owner / Asset | `walletRef` 短 UUID → `walletNo` |
| ② Balance Comparison | Core Context | Internal vs External 余额对比 + Δ | 保留 |
| ③ Problem Flows | Process | 四桶下钻（ORPHAN_INTERNAL / ORPHAN_EXTERNAL / AMOUNT_MISMATCH / PASS） | 保留 |
| ④ Related Views | Outcome | 跳 Account Statement / 跳 Linked Run | Linked Run 用 `linkedRunNo` 跳转和显示 |
| ~~⑤ Technical Detail~~ | — | ~~Case ID UUID / First Seen Run UUID / Last Updated Run UUID~~ | **整段删** —— caseNo 已在 Hero，runId 已改 No 在 ④ 段链接里 |

### 3.3 Sidebar（`w-[272px] min-w-[272px]`，三块固定）

```
[ACTIONS]                        ← 只读页，不渲染

[IDENTITY SUMMARY]               ← 严格对齐登记表 5 项
  Case No         {caseNo}
  Status          [badge]
  Book            CLIENT | FIRM
  Asset           {assetCode}
  Δ               {deltaAmount}

[LIFECYCLE]                      ← 严格对齐登记表 3 项
  SLA Deadline    {slaDeadline}
  Created         {createdAt}
  Updated         {updatedAt}
```

**删除项**：
- WALLET 块（违反三块固定顺序）
- `Severity` / `Business Date` 字段（不在登记表）
- `Ref` 字段（暴露 walletRef 短 UUID，硬违规）
- `Resolved` 字段（不在登记表）

## 4. RunsDetail 终态

### 4.1 Hero（已合规，仅说明）

```
████  {runNo}                   ← 19px mono amber
─────────────────────────────────
STATUS            [badge]
BUSINESS DATE     {businessDate}
INVARIANT         [badge]
DEMO              [link, conditional]
```

### 4.2 Body（保留 2026-06-27 redesign 的结构，仅修 ID）

| 段 | 改动 |
|---|---|
| ① Overview KPI 卡 | 保留 |
| ② Account Status 大表 | 列字段 `row.walletRef.slice(0, 8)` → `row.walletNo`；列序 / 列集 / 筛选 / 排序均保留 |
| ~~③ Technical Detail~~ | **整段删** —— runNo 已在 Hero 和 Sidebar，UUID 重复展示 |

### 4.3 Sidebar（三块固定）

```
[ACTIONS]                        ← 只读页，不渲染

[IDENTITY SUMMARY]               ← 严格对齐登记表 4 项
  Run No          {runNo}
  Status          [badge]
  Layer           CLIENT | FIRM   ← 新增（当前缺）
  Trigger         CRON | MANUAL

[LIFECYCLE]                      ← 已合规，无改动
  Started         {startedAt}
  Completed       {completedAt}
  Created         {createdAt}
```

### 4.4 跨页 URL 参数升级

- `navigate('/admin/reconciliation/cases?runId=${run.id}')` → `navigate('/admin/reconciliation/cases?runNo=${run.runNo}')`
- cases list API 删除 `?runId` 参数（一刀切，admin 内部后台对 URL 兼容性容忍度低）

## 5. CasesList + RunsList

### 5.1 CasesList

| 改动点 | 当前 | 改后 |
|---|---|---|
| 行 53 `shortId` 工具函数 | `const shortId = (id, n = 8) => id?.slice(0, n)` | **整个删除** |
| 行 233-234 short 变量 | `firstRunShort` / `lastRunShort` | **删除** |
| 行 307 First Run 列 | `{firstRunShort}…` | `{kase.firstSeenRunNo}` |
| 行 320 Last Run 列 | `{lastRunShort}…` | `{kase.lastUpdatedRunNo}` |
| list filter | 支持 `?runId` | 支持 `?runNo`（替代 runId） |

### 5.2 RunsList

零改动（已合规：adm-* token + adminFetch + 业务键优先 + Pagination）。

## 6. 后续考虑（Deferred / 丙 / 后续 iteration）

以下条目本期 **不做**，待业务方反馈或独立立项后再处理：

- **RunsDetail Body 信息梯度切片**——2026-06-27 redesign 已经把 Body 设计为「Overview KPI 卡 + Account Status 表」。按 [admin 规范的 Hero → Core Context → Process → Outcome → Technical 梯度](../../rules/frontend-admin.md)，Overview 同时承担 Core Context 与 Outcome 的角色，Account Status 同时承担 Process 与 Outcome 表。若业务方反馈"看不出这个 Run 跑出什么结论"，可独立立项讨论：是否将 invariant verdict 抽出独立 Outcome 段、Account Status 改名 Process Breakdown 等。**本期不动，避免和 2026-06-27 设计意图打架**。
- **List 页排序/筛选增强**——本期两个 List 都没有动筛选/排序，规范没要求。如运营需要更多筛选维度（按 book / 按异常类型 / 按 Δ 区间），单独立 design。
- **recon 之外其它模块 traceId 同类违规**——本期仅扫 recon 模块。如其它模块有同类违规（前缀 + 业务字段嵌入），需单独立 design 评估改动面，避免本期 PR 颗粒度失控。

## 7. 后端 Read Model 改造

```diff
GET /admin/reconciliation/cases (list)
+ firstSeenRunNo: string | null      // join reconciliation_runs WHERE id = firstSeenRunId
+ lastUpdatedRunNo: string | null    // join reconciliation_runs WHERE id = lastUpdatedRunId
+ 支持 ?runNo=xxx 查询参数;旧 runId 参数删除

GET /admin/reconciliation/cases/:caseNo (detail)
+ walletNo: string | null            // join wallets WHERE walletRef = walletRef
+ linkedRunNo: string | null         // resolve lastUpdatedRunId ?? openedByRunId → runNo
+ slaDeadline: timestamp             // 确认 read model 已暴露,缺则补
+ book: string                       // 确认 read model 已暴露

GET /admin/reconciliation/runs/:runNo (detail)
+ accountStatusRow[].walletNo: string  // join wallets WHERE walletRef = walletRef
```

## 8. traceId 修复（recon 模块）

### 8.1 规范基线

> `audit-logging.md` Format: raw UUID v4, no prefix, no business-field embedding — generate via `randomUUID()` from `node:crypto`.
> `audit-logging.md` Inherit: sub-actions always read the parent entity's traceId and pass it through — they never mint a new one.

### 8.2 设计决策：Case = 独立 primary entity，自治 traceId

Case 持有 `firstSeenRunId` 和 `lastUpdatedRunId`，跨多个 Run 持续追踪；自身有 OPEN → RESOLVED 生命周期。Case 不是任何单一 Run 的子动作，因此 **Case 自治 mint 自己的 UUID traceId**，不继承自 Run。

### 8.3 修复点

| # | 文件 : 行 | 当前 | 改后 |
|---|---|---|---|
| 1 | `reconciliation-run.service.ts:25` | `` `V8:${layer}:${date}` `` | `randomUUID()` |
| 2 | `reconciliation-case.service.ts:48` | `` `V8:${layer}:${date}` `` | `randomUUID()` |
| 3 | `wallet-recon-run.service.ts:268` | `` `WALLET_V1:${date}:${seq}` `` | `randomUUID()` |
| 4 | `wallet-recon-run.service.ts:584` (Case create) | `` `WALLET_V1:${date}:${reason}` `` | `randomUUID()` |
| 5 | `wallet-recon-run.service.ts:547` (Case update) | 覆盖 traceId | **从 update payload 删除 traceId 字段**——never-regenerate |

各文件 import `import { randomUUID } from 'node:crypto'`。

### 8.4 数据兼容性

- DB 历史行带前缀字符串，**老行保留不动**，新行写 UUID
- 无任何代码 `startsWith('V8:')` / `split` / 解析前缀（已 grep 全仓库验证），改造安全
- audit-logging 规则要求"sequence queries use WHERE traceId = X"——老/新行各自匹配自己的 traceId，互不污染，无需迁移

## 9. 验收方式

按用户既定铁律——纯 tsc + curl 200 **不算数**，必须 admin 预览渲染 + 截图比对。

| # | 步骤 | 评判 |
|---|---|---|
| 1 | `bash scripts/stack.sh up main`，`start-stack.sh` 常驻 main 栈服务 | 3000/3001 在跑 |
| 2 | admin@fiatx.com / 123456 登 `/auth/login` 取 token，注入预览的 localStorage | 进得去 dashboard |
| 3 | preview_start admin，分别跳到 RunsList / RunsDetail / CasesList / CasesDetail | 渲染无报错 |
| 4 | preview_screenshot 4 个页面 + Hero/Sidebar 局部 6 张 | 视觉原子 vs §3-§5 design 表逐项对齐 |
| 5 | curl 三个 read model endpoint 看 payload 是否含 `walletNo` / `firstSeenRunNo` / `lastUpdatedRunNo` / `linkedRunNo` / `book` / `slaDeadline` | 字段就位 |
| 6 | 新跑一个 recon Run，DB 查 `reconciliation_runs.traceId` 和该 Run 关联的 `reconciliation_cases.traceId`：正则 `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` | 格式 PASS |
| 7 | 同一 Case 跑两轮 recon，看 traceId 第二轮没变 | inherit/never-regenerate PASS |

## 10. 不变量

- 任何 admin 页面 UI 不出现 raw UUID / 内部 `id`（React `key` 除外）
- 任何 admin 页面 Hero 不出现 label-less 裸值
- 任何 admin 页面 Sidebar 严格三块（ACTIONS / IDENTITY / LIFECYCLE）
- 任何 admin 页面 Sidebar Identity Summary 严格匹配 `Per-entity Sidebar Fields` 登记表的字段集
- recon 模块所有 traceId 字段为 raw UUID v4 格式（randomUUID() from node:crypto），无前缀，无业务字段嵌入
- Case 一旦 mint traceId，整个生命周期不再覆盖

## 11. 引用

- [`doc-final/rules/frontend-admin.md`](../../rules/frontend-admin.md)
- [`doc-final/rules/audit-logging.md`](../../rules/audit-logging.md)
- [`2026-06-27-recon-ui-driver-cockpit-redesign.md`](2026-06-27-recon-ui-driver-cockpit-redesign.md) —— 上一轮 Run/Case 信息架构 redesign，本设计在其基础上做合规扫尾
- [`2026-06-26-phase-b-reconciliation-design.md`](2026-06-26-phase-b-reconciliation-design.md) —— Phase B 对账数据层基线
