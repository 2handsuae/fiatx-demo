# 对账 Run 详情页 — 健康区重构（资产 tab + COA 编号公式行）

> 状态：设计 / 已批准（待写实现计划）
> 日期：2026-06-22
> 范围：重构 `ReconciliationRunsDetailPage` 的「Reconciliation Health」段（仅 `layer=REDESIGN` 分支）。**纯前端**，不动后端 / schema / 数据 / legacy I1–I5 分支。

---

## 0. 一句话

把现有「scope×currency 矩阵 + 点击下钻面板」换成「**资产 tab → 每资产直接列 5 条公式**」；公式不再用乱序的 F1–F5 编号，改用**真实 COA 科目编号等式**当身份；每行右侧只看净额 Δ（0=Pass，非0=Break）。

---

## 1. 现状与三点改动

**现状**（`ReconciliationRunsDetailPage.tsx` redesign 分支）：
- 顶部 run 级总览条（Break/Balanced + 4 指标）。
- `Scorecard · scope × currency` 矩阵：行=scope（Ledger-wide F1·F3 / Client F2·F4 / Firm F5），列=currency（AED/USDT）。
- 点击某格 → 下钻面板，表格列 `Chk · Formula · Internal · ↔ · External · Result`。

**改动**（用户批准）：
1. **资产做成 tab**（面向未来多币种）：AED | USDT tab 切换，选中谁只看谁，不再并列展示。
2. **每资产直接列 5 条公式** + scope 徽章标在旁；顺序从 `Ledger→Client→Firm` 改成 **Client → Firm → Ledger-wide**。
3. **砍掉 Internal/External 分栏**：公式内容全放左侧，右侧只放净额数字；Δ=0 → Pass，Δ≠0 → Break。
4. **去掉 F1–F5 编号**（重排后 F2,F4,F5,F1,F3 乱序、扎眼），改用 **COA 科目编号等式**当公式身份；保留人话短名 + scope 徽章当锚点。

---

## 2. 公式 → scope / COA 编号映射

来源：`engine/formula-checker.service.ts`（常量 `CLIENT_BLOCK_CODES` / `BRIDGE_BLOCK_CODES` / `FIRM_BLOCK_CODES` / `CLIENT_POOL_CODES` / `FIRM_POOL_CODE`）。前端建一张 **静态映射**镜像它（注释指回该文件，保持同步）。

| 引擎码 | scope | 短名 | 左侧（内部 = COA 编号） | 右侧（外部/子账量，保持描述词） |
|---|---|---|---|---|
| 式2 | Client | Client tie-out | `A.CLIENT_BANK + A.CLIENT_CUSTODY + L.CLIENT_PAYABLE + L.DEPOSIT_SUSPENSE` | `open outstanding − unsettled w/d fee` |
| 式4 | Client | Client off-book | `A.CLIENT_BANK + A.CLIENT_CUSTODY` | `external ± in-transit` |
| 式5 | Firm | Firm off-book | `A.FIRM_TREASURY` | `external ± in-transit` |
| 式1 | Ledger-wide | Trial balance | `Σ all accounts (client + bridge + firm)` | —（恒等 → 0） |
| 式3 | Ledger-wide | Bridge tie-out | `L.TRADE_CLEARING` | `unswept swap` |

**显示顺序**（tab 内自上而下）：Client(式2, 式4) → Firm(式5) → Ledger-wide(式1, 式3)。

**右侧为何保持描述词**：`external ± in-transit`、`open outstanding − unsettled w/d fee`、`unswept swap` 都是"算出来的量"（外部对账单 + 在途 / 子账聚合 / 未清桥 swap），没有单一 COA 科目对应，套编号会错。等式形态固定为「**内部科目码 ↔ 外部/子账量**」。

**式1 特例**：13 个码全列太吵，显示成 `Σ all accounts (client + bridge + firm)`；三个块的码已在 Client/Firm/Bridge 各行拆开。

---

## 3. 页面结构（健康区）

```
┌ Reconciliation Health ─────────────────────────────────┐
│ [Break]  2 currencies · 3 scopes · 10 formula checks     │ ← run 级总览条（保留，切 tab 不变）
│ [Formulas 7/3] [Open cases 3] [Worst Δ …] [Ledger ✓ ok] │   4 指标块（run 级）
├──────────────────────────────────────────────────────── │
│  ( AED ● )  ( USDT ● )                                    │ ← 资产 tab（破了带红点）
├──────────────────────────────────────────────────────── │
│  [Client] Client tie-out                                  │
│   A.CLIENT_BANK + … + L.DEPOSIT_SUSPENSE 0.00             │
│      ↔ open outstanding − unsettled w/d fee 0.00   ✓ Pass │
│  [Client] Client off-book                                 │
│   A.CLIENT_BANK + A.CLIENT_CUSTODY 29,730.84             │
│      ↔ external ± in-transit 22,230.76    Δ 7,500.08 Break│
│                                       → REC-…-AED-C-001   │
│  [Firm] Firm off-book   A.FIRM_TREASURY … ↔ …      ✓ Pass │
│  [Ledger-wide] Trial balance  Σ all accounts → 0  ✓ Pass  │
│  [Ledger-wide] Bridge tie-out  L.TRADE_CLEARING … ✓ Pass  │
└──────────────────────────────────────────────────────── ┘
```

### 3.1 run 级总览条（保留）
不变：整体 Break/Balanced 徽章 + `N currencies · 3 scopes · N checks` + 4 指标块（Formulas pass/fail、Open cases、Worst Δ、Ledger integrity）。这些是 **run 级**，切 tab 不变。

### 3.2 资产 tab
- 每个 currency 一个 tab；该资产任一公式 FAIL → tab 上显示红点。
- **默认选中**：第一个有 break 的资产；全绿则第一个资产。
- 选中某资产 → 下方只渲染该资产的 5 条公式（其它资产不展示）。

### 3.3 公式行
- **左侧**：scope 徽章（Client=amber / Firm=green / Ledger-wide=blue）+ 短名；下一行 COA 编号等式 `内部码 值 ↔ 外部/子账量 值`。值用后端 `lhsValue` / `rhsValue`（块合计），编号文字来自前端静态映射。
- **右侧**：净额 Δ。`status=PASS` → 绿 `✓` + Pass pill；`status=FAIL` → 红 `Δ <值>` + Break pill + **该行的 case 链接**。
- **换 scope 组**之间留间隙（视觉分组），无需独立组标题。

### 3.4 case 链接
- case 按 `(currency, book)` 唯一。Client 行的 break → 链 client case（`REC-…-{ccy}-C-…`）；Firm 行的 break → 链 firm case（`…-F-…`）。
- Ledger-wide（式1/式3）是完整性检查，**无 per-book case**，不显示链接。
- 链接挂在**破的那一行**（FAIL 行），点进既有 case 详情页。

---

## 4. 数据与范围

- **纯前端**：`getRun` 已返回 `invariantChecks`（每条带 `invariantCode` / `currency` / `lhsValue` / `rhsValue` / `delta` / `status`）+ `cases`（caseNo/assetCode/book/status）。重构只是**重新分组 + 重新打标签 + 重排**同一批数据，外加一张 `invariantCode → {scope, 短名, 左侧COA码, 右侧描述}` 静态映射。
- **不动**：后端、`prisma/schema`、数据迁移、引擎、legacy I1–I5 分支（`layer≠REDESIGN` 仍走旧表格）。
- **值的粒度**：右侧/等式里的数值是**块合计**（如客户池合计 29,730.84），来自 `lhsValue`/`rhsValue`。

---

## 5. 终态 / 验收

- AED/USDT tab 切换正常，选中谁只看谁；破了的 tab 带红点；默认落在第一个 break 资产。
- 每 tab 列 5 条公式，顺序 Client → Firm → Ledger-wide，每行带 scope 徽章 + COA 编号等式。
- 无任何 F1–F5 编号出现在 UI。
- 右侧 Δ：0 → 绿 Pass；非0 → 红 Break + case 链接（仅 Client/Firm 破行）。
- 矩阵、下钻面板、Internal/↔/External 列已移除。
- legacy（`layer≠REDESIGN`）run 详情页渲染不破。
- 渲染截图验收（admin 实跑 break run，眼验左右与本 spec 一致）。

---

## 6. 文件计划

**改动**：`admin-web/src/pages/ReconciliationRunsDetailPage.tsx`（删 `buildScorecard`/`MatrixCell`/矩阵+下钻；新增 tab 状态 + 静态 `FORMULA_COMPONENTS` 映射 + 公式行渲染）。
**复用不改**：`getRun` 端点 / 查询、case 详情页、StatusPill 等组件、run 级总览条逻辑。

---

## 7. 非目标 / 延后

- **per-COA-code 金额拆分**（`A.CLIENT_BANK 25,000 · A.CLIENT_CUSTODY 4,730.84`）：需后端补存 per-code 明细，**延后按需加**；本轮只显块合计 + 编号等式（去「绕一层」靠列出编号已达成）。
- 不引入 F1–F5 之外的新公式、不改引擎口径、不动 demo 对比页。

---

## 8. 决策记录

- run 级总览条：**保留全局**（run 是多资产，头条最直观）；公式明细进 per-asset tab。
- 公式身份：**去 F1–F5 编号**，用 COA 编号等式 + 人话短名 + scope 徽章。
- 右侧只放净额；左侧承载全部公式内容（编号等式 + 值）。
- 默认 tab = 第一个 break 资产。
- 值粒度 = 块合计（per-code 拆分延后）。
- 纯前端，legacy I1–I5 分支不动。
