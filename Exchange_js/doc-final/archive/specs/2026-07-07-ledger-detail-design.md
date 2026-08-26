# 账本细化设计 — 三菜单 / 权限包 / 流水列表页

Date: 2026-07-07
Status: 设计定稿（待用户复核 → 用户先改代码 → 再据此写飞书 PRD）
Scope: 账本（accounting / TigerBeetle ledger）域的 admin 呈现层——三张表对应三个菜单、每菜单的权限包、以及新增「流水列表」页面方案。**这是给开发看的设计**，落地后飞书 PRD ①《账本与记账》据此补细化章节。

> 本 spec 只覆盖账本域的**呈现层（菜单/接口/权限/页面）+ 一处写操作审计**。记账机制本身（8码COA、两阶段、实时1:1）见 `doc-final/reference/truth/accounting-coa.md`，不重复。

---

## 1. 三表 → 三菜单（严格一一对应）

账本域菜单收敛为**正好三个**，各对应一张表：

| 菜单 | 表 | 后端接口 | 现状 |
|---|---|---|---|
| 账户 | `TbAccountRegistry` | `GET /admin/tb/accounts`(+ :id 详情) | ✅ 已有 |
| 凭证 | `TbTransferEvidence` | `GET /admin/tb/transfers`(+ :id 详情) | ✅ 已有 |
| 流水列表 | `AccountFlow` | `GET /admin/tb/account-flows`（新） | ❌ **需建** |

**决策**：移除现有「对账单 Account Statement」菜单（它是 AccountFlow 的按钱包聚合视图）；其能力由「流水列表 + 单账户筛选 + 当时余额列」吸收（见 §3）。若对账域仍需聚合视图，迁到对账（V8）。

### 1.1 表①账户注册表 `TbAccountRegistry`（菜单「账户」）

一句话：每个 TB 账户（8 码口袋实例）的登记表——把账户 ID 映射到「哪个口袋 / 哪个币种 / 属于谁」。
关键列（列表）：`tbAccountId`、`code`(口袋类型)、`assetCode`(币种)、`ownerType`(SYSTEM/CUSTOMER/LP)、`ownerNo`(归属编号)、`status`、`description`、`createdAt`。
详情页额外：实时余额（借方已过账 / 贷方已过账 / 在途，直读 TB）。
菜单：列表（按 币种/归属类型/code/关键词 过滤）+ 详情。**含唯一写操作：手动建账**（`POST /admin/tb/accounts`）。

### 1.2 表②转账凭证 `TbTransferEvidence`（菜单「凭证」）

一句话：每笔 TB 转账落一行的人类可读凭证。
关键列：`tbTransferId`、`sourceType`(充值/提现/兑换)、`sourceNo`、`eventCode`、`debitCode`(借方口袋)、`creditCode`(贷方口袋)、`amount`、`assetCode`、`actorType`/`actorId`、`effectiveDate`、`transferType`(POSTED/PENDING/…)、`createdAt`；对账三字段：`debitWalletRef`/`creditWalletRef`/`externalRef`/`isExternalCrossing`。
菜单：列表（按 业务类型/币种/事件码/转账类型/COA/关键词 过滤）+ 详情。

### 1.3 表③流水投影 `AccountFlow`（菜单「流水列表」，新建）

一句话：凭证的逐行投影——每笔转账拆借贷两行，每行 = 某账户/钱包上的一笔进(IN)或出(OUT)。为按钱包/账户查流水、按生效日过滤而设。
现有字段：`id`、`tbTransferId`、`tbAccountId`、`walletRef`、`direction`(IN/OUT)、`amount`、`isExternalCrossing`、`externalRef`、`eventCode`、`sourceType`、`sourceNo`、`transferType`、`assetCode`、`effectiveDate`、`createdAt`。已有索引 `@@index([tbAccountId, createdAt])`。
**新增字段**：`balanceAfter`（见 §3.3）。

---

## 2. 「流水列表」页面方案

复用现有 `TransferEvidenceList.tsx` 的骨架（头部 → 筛选条 → sticky 表格 → 分页；`font-mono` + `adm-*` 配色 + `AdminBadge` + `Pagination` + 行点击跳详情）。基本是复制该页换数据源+列，零新组件。

### 2.1 布局（四区）

```
① 头部:   账本 › 流水列表                                    [↻ 刷新]
② 筛选条: [🔎 流水ID/账户/钱包/单号/外部ref] [账户▾][钱包][方向▾][币种▾]
          [生效日 从__到__] [业务▾] [类型▾]                 [重置][查询]
③ 表格:   账户 | 钱包 | 方向 | 金额 | 当时余额 | 币种 | 业务 | 业务单号 | 事件 | 类型 | 生效日 | 创建时间
④ 分页:   ‹ 1 2 3 … ›  共 N 条
```
（顶部汇总条：**不做**。）

### 2.2 列

| 列 | 字段 | 显示 | 备注 |
|---|---|---|---|
| 账户 | tbAccountId | 短ID，点击→账户详情 | 串起菜单① |
| 钱包 | walletRef | 短串，空显「—」 | |
| 方向 | direction | 徽章 IN 绿 / OUT 红 | |
| 金额 | amount | 右对齐 tabular-nums，分→元按币种小数 | |
| **当时余额** | **balanceAfter** | 右对齐，分→元；**仅单账户筛选时显示值，否则「—」** | 见 §3.3 |
| 币种 | assetCode | 文本 | |
| 业务 | sourceType | 徽章 | |
| 业务单号 | sourceNo | 截断 + hover | |
| 事件 | eventCode | 文本 | |
| 类型 | transferType | 徽章 | |
| 生效日 | effectiveDate | YYYY-MM-DD | |
| 创建时间 | createdAt | 日期时间 | |

可选列「跨外部」（isExternalCrossing 命中显小徽记），对账排查用；本期可不加。

### 2.3 筛选

搜索(流水ID/账户/钱包/单号/外部ref) · 账户(tbAccountId) · 钱包(walletRef) · 方向(IN/OUT) · 币种 · **生效日范围** · 业务类型 · 转账类型 · 重置。

### 2.4 交互与三态

- **行点击 → 跳「凭证详情」**（`/admin/ledger/transfer-evidence/:tbTransferId`，复用已有详情页）→ 流水本身**不建详情页**。
- 「账户」详情页加一个「查看流水」入口，预填该账户过滤跳本页 → 三菜单闭环。
- 加载中 / 空 / 错误(带重试) 三态，与凭证列表一致（colSpan 占位）。

---

## 3. 「当时余额」运行余额设计（核心新增）

### 3.1 现状缺口

`account_flows` **无任何余额列**；投影器 `persist()`（`clearing-settle/reconciliation/projector/account-flow-projector.service.ts`）只写方向+金额。故「当时余额」是纯新增能力。

### 3.2 方案：存快照（决策=甲）

新增列 `balanceAfter`，在投影记账那一刻落该账户 TB 当时余额。**不采用查询时累加**（分页/排序/两阶段易算歪、可能偏离 TB 真相）。

### 3.3 细节

- **Schema**：`AccountFlow` 加 `balanceAfter Decimal?`（分，可空——历史行未回填时为 null）。
- **写入**：投影器 `persist()` 写每一行时，读该行所属账户（`tbAccountId`）的 **posted 余额**（复用 `accounting.service → lookupBalance()`），写入该行 `balanceAfter`。一笔转账投影两行（借方账户行、贷方账户行），**各存各账户的余额**。
- **口径**：`balanceAfter` = 该账户在这笔过账后的 **posted 余额**（分）。ordering 以 TB 过账序（≈`createdAt` 序）为准。
- **展示约束（硬）**：运行余额只有筛定**单账户**时才有意义。列表未按单一 `tbAccountId` 筛选时，该列一律显「—」并提示「选定账户后显示余额」。前端据「是否存在单账户筛选」决定是否渲染余额值。
- **展示格式**：分→元按 `asset.decimals`（bigint-safe 字符串插点，与对账页 `formatAmount` 一致）。
- **backfill**：历史 `account_flows` 行的 `balanceAfter` 需回填；本期可接受历史行为 null（前端显「—」），或提供一次性回填脚本（按账户+过账序重放累计）。→ 见 §6 待定。
- **pending/void 口径**：`transferType ∈ {PENDING, POST_PENDING, VOID_PENDING}` 行的 posted 余额未变，`balanceAfter` 存当时 posted 余额即可（不含在途锁定）。→ 见 §6 待定。

> 好处：Balance 列 + 单账户筛选，本页即一张「账户流水账」（逐行 金额 + 当时余额），吸收被移除的「对账单」聚合能力。

---

## 4. 权限包设计（方案 B：每菜单一读 + 一写）

替换现有的共享 `ACCOUNTING_CONFIG_READ / ACCOUNTING_CONFIG_WRITE`（三菜单共用、无法分表控制）为四个菜单对齐的权限：

| 权限常量（后端组） | 管哪些路由 | 动作 |
|---|---|---|
| `LEDGER_ACCOUNT_READ` | `GET /admin/tb/accounts`、`GET /admin/tb/accounts/:id` | 查看 |
| `LEDGER_EVIDENCE_READ` | `GET /admin/tb/transfers`、`GET /admin/tb/transfers/:id` | 查看 |
| `LEDGER_FLOW_READ` | `GET /admin/tb/account-flows`（新）、`GET /admin/tb/wallets`（补权限门） | 查看 |
| `LEDGER_ACCOUNT_WRITE` | `POST /admin/tb/accounts` | 写 |

- **打包**：定义「账本查看包」= {三个 READ}，标准角色整包授予；同时保留单独授某一个读的能力（如只给合规看凭证）。
- **Action Bucket Catalog**（`rbac.catalog.ts`）：把原 `accounting` 域的两 bucket（view_tb / manage_tb）改为四项：`ledger.view_accounts` / `ledger.view_evidence` / `ledger.view_flows`（三读）+ `ledger.manage_accounts`（写）。
- **前端权限映射**（`admin-web/src/rbac/permissions.ts`）：`TB_ACCOUNTS_READ→LEDGER_ACCOUNT_READ`、`TB_TRANSFERS_READ/TB_TRANSFER_DETAIL_READ→LEDGER_EVIDENCE_READ`，新增 `TB_FLOWS_READ→LEDGER_FLOW_READ`。
- **建议角色绑定**（可调）：三读（账本查看包）→ OPS_OFFICER、SMO、TECH_OFFICER（+ SUPER_ADMIN 演示）；`LEDGER_ACCOUNT_WRITE` → TECH_OFFICER（+ SUPER_ADMIN）。
- **生效**：改后 `db:base:sync` + **重启后端**（SUPER_ADMIN 走内存 RBAC 定义，只 seed 不重启不生效）。

**开放点**：合规官 / MLRO 当前无账本读权限。凭证/流水是审计核心，是否给合规单开 `LEDGER_EVIDENCE_READ`？→ 见 §6 待定（默认不给，待业主定）。

---

## 5. 审计（仅一条）

账本三菜单只读、不记审计；**唯独手动建账**（`POST /admin/tb/accounts`）是改状态的 operator 写操作，按平台铁律留痕，补一条审计事件：

| 审计事件 | 触发时机 | 记录内容 |
|---|---|---|
| 账户创建（如 `TB_ACCOUNT_CREATED`） | 手动建 TB 账户成功 | 操作人、时间、口袋类型(code)+币种(assetCode)+归属(ownerType/ownerNo)、描述 |

（经 `AuditLogsService`，DI 注入，禁 `new`；具体动作命名开发定。）

---

## 6. 代码差距清单（实施前置——用户先改，再写飞书 PRD）

1. **建流水菜单**：`GET /admin/tb/account-flows`（按 账户/钱包/生效日范围/方向/币种/关键词 过滤，分页）+ 前端「流水列表」菜单页（复制 `TransferEvidenceList.tsx`）+ 菜单项接 `DashboardLayout.tsx` 的 Ledger 组。
2. **加运行余额**：`AccountFlow.balanceAfter Decimal?` 列 + 投影器 `persist()` 写入 posted 余额 + 前端 Balance 列（单账户约束 + 分→元）。
3. **拆权限**：废 `ACCOUNTING_CONFIG_READ/WRITE` → 建 §4 四个新权限；重绑各路由；action bucket + 前端 permissions 对齐；`db:base:sync` + 重启。
4. **砍对账单**：移除 `GET /admin/tb/account-statement` + `AccountStatementPage.tsx` + 其菜单项。
5. **补权限门**：`GET /admin/tb/wallets` 现在**无权限（裸奔）** → 挂 `LEDGER_FLOW_READ`。
6. **补审计**：`POST /admin/tb/accounts` 加一条审计写入（若现无）。

### 待定（不阻塞主设计）

- `balanceAfter` 历史行是否一次性回填（脚本重放）还是接受 null。
- pending/void 行的余额口径（默认存当时 posted 余额）。
- 合规/MLRO 是否给 `LEDGER_EVIDENCE_READ`。

---

## 锚点（devs 定位）

- 模型：`prisma/schema.prisma`（`TbAccountRegistry` / `TbTransferEvidence` / `AccountFlow`）
- 后端：`src/modules/accounting/tigerbeetle/tb-admin.controller.ts`、`tb-manual-account.service.ts`、`tb-account-registry.service.ts`、`accounting.service.ts → lookupBalance()`
- 投影器：`src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts → persist()`
- RBAC：`src/modules/identity/access-control/rbac.catalog.ts`；前端 `admin-web/src/rbac/permissions.ts`
- 菜单：`admin-web/src/components/DashboardLayout.tsx`（Ledger 组）
- 现有页：`LedgerAccountList/Detail.tsx`、`TransferEvidenceList/Detail.tsx`、`AccountStatementPage.tsx`（待移除）
