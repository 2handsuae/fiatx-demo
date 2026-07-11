# 账务域三列表细化设计 — 列增补 / 账户身份拉通 / 实时余额

Date: 2026-07-10
Status: 设计定稿（待用户复核 → 用户先改代码 → 再据此补飞书 PRD）
Branch: `feat/ledger-detail`
Scope: 账本（accounting / TigerBeetle ledger）域 admin **三张列表**（账户 / 凭证 / 流水）的呈现层列增补 + 两处后端读取增强（registry join、批量实时余额）。承接 `2026-07-07-ledger-detail-design.md`（三菜单 / 权限包 / 流水页骨架已落地）。

> 本 spec 只动**读取呈现层**（列、筛选、只读 join、只读余额查询）。**不改记账写入路径、不加表、不改权限包。** 记账机制本身见 `doc-final/reference/truth/accounting-coa.md`。

---

## 0. 决策快照（已与业主对齐）

| 议题 | 决策 |
|---|---|
| Accounts 列表 ID 列 | **加**，展示**完整** `tbAccountId`（hover + 复制，点击进详情） |
| Flows ReferenceNo 列 | = `externalRef`（链上哈希 / 银行流水号；空显「—」） |
| Flows Account name 列 | = `账户类型标签 · 币种`（如 `CLIENT_PAYABLE · USDT`），三页同口径 |
| Flows Balance After | **恒显示**（去掉「仅单账户」门；余额是每行快照恒有意义） |
| Wallet 展示 | Flows **移除** Wallet 列 + Wallet Ref 筛选框 |
| 优化乙/丙/丁 | **要**（凭证 ReferenceNo + 流水 customerNo 筛选 + 账户实时余额）｜ **甲撤销**——前提「裸数字」不成立，凭证 Debit/Credit 已显 `A.CLIENT_ASSET`，业主 2026-07-10 选保持不变 |
| Pending 排除 / 落账才进流水 | **本期不做** → 记 BACKLOG（见 §6） |

---

## 1. Ledger Accounts 列表（菜单「账户」）

现状列：`Account(标签·币种) ｜ Code ｜ Ledger ｜ Owner ｜ Customer No ｜ Customer Name ｜ Asset ｜ Status ｜ Created`。

**改动两项：**

| # | 动作 | 细节 |
|---|---|---|
| A1 | **加 `ID` 列** | 完整 `tbAccountId`；`font-mono`，hover 全量 title + 复制按钮（复用凭证页 `Copy` 图标写法），点击进账户详情。插在 `Account` 列之后。 |
| A2（丁） | **加 `Balance` 列** | 该账户**实时 posted 余额**（分→元，class-aware 符号），右对齐 `tabular-nums`。**批量**查：整页账户 `tbAccountId` 一次 `lookupAccounts(ids[])`，禁止逐行打 TB。 |

> ⚠️ ID 列暴露说明：`tbAccountId` 是账本账户的**业务键**（operator 对账认它），非隐藏 DB UUID，且流水页已在展示它——业主明确要求完整展示，视为对「Admin 不暴露原始 ID」通则的**显式豁免**，仅此一处。

**余额口径（class-aware，与 `balanceAfter` 一致）：** 资产类账户（`isAssetCode(code)` 真）借方为正，`balance = debits_posted − credits_posted`；负债 / 权益类账户贷方为正，`balance = credits_posted − debits_posted`。复用 `accounting.service` / `tb-evidence.service` 已有的 `isAssetCode` + posted 余额算法，避免资产账户显负数。

---

## 2. Account Flows 列表（菜单「流水列表」）

现状列：`Account(短ID) ｜ Wallet ｜ Direction ｜ Amount ｜ Balance After ｜ Asset ｜ Source ｜ Source No ｜ Event ｜ Type ｜ Effective ｜ Created`。

**改动：**

| # | 动作 | 细节 |
|---|---|---|
| F1 | **移除 Wallet** | 删 `Wallet` 列 + 筛选条里的「Wallet Ref」输入框。`walletRef` 仍可被顶部搜索框（q）命中（后端 `q` OR 条件已含 walletRef，保留）。 |
| F2 | **加 `Account name` 列** | = `TB_CODE_LABELS[code] · assetCode`。`code` 来自后端对 `tbAccountRegistry` 的 join（§4）。插在 `Account(短ID)` 列之后。 |
| F3 | **加 `customerNo` 列** | = registry `ownerNo`（仅 `ownerType='CUSTOMER'`；SYSTEM/LP 显「—」）。有 `ownerUuid` 时可点击进客户页（对齐账户列表页写法）。 |
| F4 | **加 `ReferenceNo` 列** | = `externalRef`（空显「—」，`font-mono`，超长截断 + hover）。 |
| F5 | **Balance After 恒显示** | 删除 `singleAccount` 门控（第 197~198、414~416 行逻辑）：只要 `balanceAfter != null` 就按币种分→元展示；`null` 才显「—」。表头 title 由「选定账户后显示余额」改为「过账后当时余额」。 |
| F6（丙） | **加 customerNo 筛选** | 筛选条加一个 customerNo 输入框；后端新增 `customerNo` 参数（§4 说明按客户解析 tbAccountId 集合再过滤）。 |

**改后 Flows 列顺序：**
`Account(短ID链接) ｜ Account name ｜ customerNo ｜ Direction ｜ Amount ｜ Balance After ｜ Asset ｜ Source ｜ Source No ｜ ReferenceNo ｜ Event ｜ Type ｜ Effective ｜ Created`

> `Account` 列保持**短 ID 链接**（点击进账户详情）不变——它是标识符，新的 `Account name` 是人类可读名，二者并存不冲突。行整体点击仍跳凭证详情。

---

## 3. Transfer Evidence 列表（菜单「凭证」）

现状列：`ID ｜ Source ｜ Source No ｜ Event ｜ Debit ｜ Credit ｜ Amount ｜ Asset ｜ Type ｜ Created ｜ Effective`。

> **前提更正（2026-07-10 核实真实数据）**：`debitCode`/`creditCode` 存的是 **COA 串**（`A.CLIENT_ASSET` / `L.DEPOSIT_SUSPENSE` / `E.FIRM_OPS`），**不是**裸数字 `100/101`——本来就可读。故 甲 原描述（"裸数字→标签化"）前提不成立。

**改动两项：**

| # | 动作 | 细节 |
|---|---|---|
| ~~E1（甲）~~ **撤销** | — | 前提「裸数字」不成立：凭证 Debit/Credit 已显 `A.CLIENT_ASSET`（带 `A./L./E.` 会计类别前缀，本就可读，前缀对读双向记账有用）。业主 2026-07-10 选**保持不变**，甲不做。 |
| E2（乙） | **加 `ReferenceNo` 列** | = `externalRef`。插在 Credit / Amount 附近。凭证接口 `findMany` 无 `select`、已返回全字段（`externalRef` 已在 payload）→ **纯前端**：row interface 补 `externalRef` 字段 + 加列。 |

---

## 4. 后端改动（只读增强，共 3 处）

**B1 — Flows registry join（服务 F2/F3）：** `tb-evidence.service.findAllFlows` 取到 `items` 后，收集去重 `tbAccountId` 集合，一次 `tbAccountRegistry.findMany({ where: { tbAccountId: { in: ids } }, select: { tbAccountId, code, ownerType, ownerNo, ownerUuid, ownerName } })` 建 map，给每行挂 `code / ownerType / ownerNo / ownerUuid`。前端据 `code` 渲 Account name、据 `ownerNo` 渲 customerNo。label 映射留前端（单一来源）。

**B2 — Flows customerNo 筛选（服务 F6）：** `findAllFlows` 新增 `customerNo?` 入参。非空时先查 `tbAccountRegistry`（`ownerType='CUSTOMER'`, `ownerNo=customerNo`）得该客户的 `tbAccountId` 集合，再 `where.tbAccountId = { in: 集合 }`（与既有 `tbAccountId` 单值过滤互斥/叠加：若两者都传，取交集或以 tbAccountId 优先——**取 customerNo 集合与单值的交集**）。空集合 → 返回 0 条。控制器 `findAccountFlows` 透传该 query 参数。

**B3 — Accounts 实时余额（服务 A2/丁）：** `tb-account-registry.service.findAll` 取到页内 registry 行后，把它们的 `tbAccountId` 批量 `hexToBigint` → 一次 `tbService.lookupAccounts(ids)` → 按各账户 `code` 的 class 算 posted 余额 → 给每行挂 `balance`（分，字符串保 bigint 精度）。TB 查失败 / 账户不存在 → `balance=null`，前端显「—」，**不阻断列表**（列表主体仍是 registry 读，TB 只做增强）。

> 三处都是「先读 Prisma 主体，再挂只读增强」，不进事务、不改写入、不碰权限门。B3 的 TB 批量查是整页一次调用——严禁演化成逐行 `lookupBalance`。

---

## 5. 验收标准（□ 勾）

**账户列表**
- □ 新 `ID` 列显**完整** `tbAccountId`，可复制、点击进详情。
- □ 新 `Balance` 列显实时 posted 余额，资产账户不为负（class-aware 正确），分→元按币种小数。
- □ 整页余额一次 TB 批量查（日志/网络只见 1 次 lookupAccounts / 页）。

**流水列表**
- □ Wallet 列 + Wallet Ref 筛选框已移除。
- □ `Account name` 列显 `类型标签·币种`；`customerNo` 列客户账户显编号、系统账户显「—」。
- □ `ReferenceNo` 列显 `externalRef`（有值行显、空行「—」）。
- □ Balance After **每行都显数字**（不再因未筛单账户而全列「—」）。
- □ customerNo 筛选：输入某客户编号 → 只回该客户账户的流水；空集合返回 0 条不报错。

**凭证列表**
- □ 新 `ReferenceNo` 列显 `externalRef`。
- （甲已撤销：Debit/Credit 保持现状 `A.CLIENT_ASSET` 不动。）

**回归**
- □ 三列表行点击跳转、分页、三态（loading/空/错误）不回归。
- □ `tsc` 前后端 0 error；后端启动无新错。

---

## 6. 缓做（记 BACKLOG）

**Pending 排除 / 落账才进流水**（业主本期跳过）：目标口径——流水只体现**已落账（posted）**的转账，pending/锁定阶段不进流水；凭证表照旧记 pending。落地要点：投影器 `account-flow-projector.persist()` 在转账 post 那一刻才写流水行（pending 阶段跳过 persist），VOID_PENDING 永不生成；并一次性清理历史 pending 流水行（当前 4 条）。→ 于 `doc-final/BACKLOG.md` 登记一行。

---

## 锚点（devs 定位）

- 前端页：`admin-web/src/pages/LedgerAccountList.tsx`（A1/A2）、`AccountFlowList.tsx`（F1~F6）、`TransferEvidenceList.tsx`（E1/E2）
- label 常量：`admin-web/src/pages/ledger-account.constants.ts`（`TB_CODE_LABELS`）
- 后端服务：`src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（`findAllFlows` — B1/B2）、`tb-account-registry.service.ts`（`findAll` — B3）
- 控制器：`src/modules/accounting/tigerbeetle/tb-admin.controller.ts`（`findAccountFlows` 透传 customerNo）
- TB 余额：`tigerbeetle.service.ts`（`lookupAccounts(ids[])` 批量）、`accounting.service.ts`（`lookupBalance` / `isAssetCode` 口径）
- 模型：`prisma/schema.prisma`（`AccountFlow` / `TbAccountRegistry` / `TbTransferEvidence` — 本期**不改 schema**）
