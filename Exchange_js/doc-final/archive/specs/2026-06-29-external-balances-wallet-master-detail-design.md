# External Balances 单页 master-detail 重设计（按 source 分区 by-wallet 视图）

> 设计文档 · 2026-06-29 · 分支 main
> 当前 External Balances 列表+详情双页结构存在两个本质问题：① detail 路由用 `statementId` 但所有数据该字段都是 null，**点击行无响应**且 endpoint 直查也 404 —— 详情流彻底死锁；② 表头叫 "Account" + 展示 `accountRef` UUID，违反「禁止暴露 ID」铁律，且与服务商真实组织粒度（per-wallet）不对齐。本设计取代两页为**单页 master-detail**（仿 `AccountStatementPage.tsx` 模式），master 按 **source / asset class 分区**（CRYPTO HexTrust / FIAT Zand），detail 由 Hero + Roll-Forward Check + Statement Lines 三段组成。

## 1. 底层逻辑

外部对账单是**服务商视角的数据**——HexTrust 给虚拟币、Zand 给法币，两家**对账单出账节奏不同**（HexTrust 实时、Zand T+1）。对账员日常第一眼要回答的不是「客户 vs 公司」，而是「我哪个服务商的数据齐了 / 哪个延迟了」。因此 master 一级分区按 **source/asset class**（CRYPTO/FIAT），book（CLIENT/FIRM）退化为行内 badge 作为辅助标签。

外部对账单天然按**物理钱包/账户**组织（HexTrust 的 vault、Zand 的 VIBAN）。我们内部账本（COA：`L.CLIENT_PAYABLE + L.DEPOSIT_SUSPENSE`）是**自家账本规划**——外部服务商不知道也不需要知道。所以页面应**纯外部视角**：钱包号、来源、当日 opening/closing、当日逐笔流水。内部账本关系由 detail pane 底部一个 "View in Internal Book →" 链跳 `AccountStatementPage` 做轻量交叉引用。

## 2. 范围（边界声明）

| 类别 | 在范围 | 不在范围 |
|---|---|---|
| 路由重组 | ✓ 单 page `/external-balances` 含 master-detail；删 `/external-balances/:statementId` 死路由 | 无兼容期 |
| 字段维度切换 | ✓ "Account" → "Wallet"；`accountRef` UUID → `walletNo` 业务键 | — |
| Master 分区维度 | ✓ 按 source/asset class 分 CRYPTO / FIAT 两区；book 降为 badge | book 不再是分区维度 |
| Detail 三段 | ✓ Hero（7 字段含 closing 大字） / Roll-forward Check / Statement Lines | 多日趋势 / 跨日对比 / 手动同步按钮：均后续考虑 |
| 后端字段补 | ✓ list 加 walletNo + walletRole；detail endpoint 改 walletNo lookup | — |
| 文件清理 | ✓ 删两个旧 page + 一个权限 | — |

## 3. 顶层布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  External Balances              [date picker] [Refresh]             │
├─────────────────────────────────────────────────────────────────────┤
│  2026-06-28 · 14 wallets · Crypto 8 · Fiat 6                        │
├──────────────────┬──────────────────────────────────────────────────┤
│  CRYPTO          │   ┌─ Hero ─────────────────────────────────────┐ │
│   (HexTrust)     │   │  WA2601011857  (amber 19px)                 │ │
│  ────────────    │   │  SOURCE  HEXTRUST                           │ │
│  ▸ WA2601011857  │   │  BOOK    [CLIENT]                           │ │
│      [CLIENT]    │   │  ROLE    C_VIBAN                            │ │
│      AED 1.158M  │   │  CCY     AED                                │ │
│  ▸ WA2601014725  │   │  OWNER   CU2601019430                       │ │
│      [CLIENT]    │   │  CLOSING 1.158047 (24px)                    │ │
│      AED 1.085M  │   └────────────────────────────────────────────┘ │
│  ...             │   ┌─ Roll-Forward Check ───────────────────────┐ │
│                  │   │  Opening + Σ(IN-OUT) = Closing?             │ │
│  FIAT            │   │  0 + 1158047 = 1158047  ✅ continuous       │ │
│   (Zand)         │   └────────────────────────────────────────────┘ │
│  ────────────    │   ┌─ Statement Lines (14) ─────────────────────┐ │
│  ▸ WA2601018410  │   │  Time | Dir | Amount | ExtRef | ChanRef |  │ │
│      [CLIENT]    │   │       |     |        |        |         |  │ │
│      AED 4.231M  │   │  ...                                        │ │
│  ▸ WA26010yyyy   │   └────────────────────────────────────────────┘ │
│      [FIRM]      │   View in Internal Book → (AccountStatement)    │
│      AED 850K    │                                                 │
└──────────────────┴──────────────────────────────────────────────────┘
   ↑ master ~360px           ↑ detail flex-1
```

## 4. URL 状态合约

```
/admin/reconciliation/external-balances?date=YYYY-MM-DD&wallet=WAxxxxxxxxxx
                                       └─ master 决定         └─ detail 决定
```

- `?date` 缺省 → 默认最近一个 cutoffDate（从 list 接口 max(cutoffDate) 取）
- `?wallet` 缺省 → detail pane 显 placeholder `"Select a wallet from the left to view its statement"`
- 切日期 → wallet 自动清空（数据集变了）
- 切 wallet → 仅 fetch detail，不重 master

## 5. Master Pane（左 ~360px）

### 5.1 顶部 Notice Strip

```
2026-06-28 · 14 wallets · Crypto 8 · Fiat 6
```

字段：cutoffDate / 总 wallet 数 / 各 source 子数。

### 5.2 分区

- **CRYPTO (HexTrust)** —— source 等于 `HEXTRUST` 的所有行。
- **FIAT (Zand)** —— source 等于 `ZAND` 的所有行。
- 未匹配到的 source（如未来加 CHAIN / FIREBLOCKS）→ 第三组 "OTHER ({source})"。

### 5.3 Source → Label 映射（硬编码常量）

```typescript
const SOURCE_LABELS: Record<string, { groupLabel: string; subLabel: string }> = {
  HEXTRUST: { groupLabel: 'CRYPTO', subLabel: 'HexTrust' },
  ZAND:     { groupLabel: 'FIAT',   subLabel: 'Zand' },
  CHAIN:    { groupLabel: 'CRYPTO', subLabel: 'Chain (raw)' },
};
```

未来加 source 时扩这一处。YAGNI——不引入 asset.type 查表 join。

### 5.4 区内排序

按 `book → walletNo` 升序（CLIENT 先 FIRM 后）。区内允许 book 混排，靠行内 badge 区分。

### 5.5 Wallet 行展示

```
▸ WA2601011857
    [CLIENT]  AED 1.158047       <- badge + ccy + closing (formatAmount)
```

- 选中态：amber 左 border + `bg-adm-card`
- hover：`bg-adm-hover`
- 点击：URL `?wallet=WAxxx` 同步，触发 detail fetch

## 6. Detail Pane（右 flex-1）

### 6.1 顶部 Notice Strip（仅选中 wallet 时）

```
14 lines · ingested 2026-06-28 11:48 · status [INGESTED]
```

### 6.2 Hero（`bg-adm-card`，第一段）

```
████  WA2601011857            ← 19px mono amber, no label
─────────────────────────────────
SOURCE      HEXTRUST
BOOK        [CLIENT]
ROLE        C_VIBAN
CCY         AED
OWNER       CU2601019430
─────────────────────────────────
CLOSING     1.158047           ← 24px mono, 强突出
```

字段：

| 字段 | backend 来源 |
|---|---|
| walletNo | 新增 join wallets 表 |
| source | 现有 |
| book | 现有（badge tone：CLIENT 蓝 / FIRM 绿；其他值灰） |
| walletRole | 新增 join wallets.walletRole |
| currency | 现有 |
| ownerNo | 现有 |
| closingBalance | 现有，走 `formatAmount()` 一致化（admin 规范） |

### 6.3 Roll-Forward Check（第二段）

校验：`Math.abs(opening + Σ(IN - OUT) - closing) < epsilon (0.000001)`

| 状态 | 视觉 | 文案 |
|---|---|---|
| `continuous` | 绿 ✅ | `drift = 0` |
| `self-inconsistent` | 红 ❌ | `drift = {amount} · contact {SOURCE}` |
| `lines.length === 0` | 灰 ⚠️ | `Empty statement — opening/closing only` |

### 6.4 Statement Lines（第三段，核心信息密度）

| 列 | 字段 | 宽度 | 备注 |
|---|---|---|---|
| Time | `datetime` | 132px | HH:mm:ss |
| Dir | `direction` | 60px | IN=绿 chip / OUT=红 chip |
| Amount | `amount` | 144px | mono right-align, formatAmount |
| External Ref | `externalRef` | flex | null → `—`（入金法币天然空） |
| Channel Ref | `channelRef` | 96px | 仅 Zand 有；其他显 `—`（保留运营 trace 价值） |
| Description | `description` | flex | Incoming / Outgoing / Return / Intra... |
| Balance After | `balanceAfter` | 144px | null → `—`（虚拟币无） |
| (expand) | — | 32px | 点击 row 切换 `expanded` set，展开下方一行 raw JSON |

默认按 `datetime` 升序（时间线视角）。

### 6.5 Footer Cross-Ref

```
View in Internal Book → /admin/ledger/account-statement?wallet={walletNo}&crossingOnly=true
```

让对账员从外部视角一脚跳进内部账本视角做对比。

## 7. 后端 endpoint 改造

```diff
GET /admin/reconciliation/external-balances?date=YYYY-MM-DD  (list mode)
+ 每行新增字段:
+   walletNo: string | null         // join wallets WHERE id = walletRef
+   walletRole: string | null       // 同上
+ 现有字段保留: id, source, accountRef, currency, book, cutoffDate,
+              openingBalance, closingBalance, status, lineCount, etc.

- DELETE: GET /admin/reconciliation/external-balances/:statementId

+ NEW: GET /admin/reconciliation/external-balances/:walletNo?date=YYYY-MM-DD
+ Response shape:
+   {
+     walletNo, walletRef, source, book, currency, walletRole, ownerNo,
+     cutoffDate, openingBalance, closingBalance, asOfAt, ingestedAt, status, lineCount,
+     lines: [{ id, datetime, direction, amount, externalRef, channelRef,
+              balanceAfter, description, raw }, ...]
+   }
+ Lookup: WHERE walletRef = (SELECT id FROM wallets WHERE walletNo = :walletNo)
+         AND cutoffDate = :date
+ 404 message: "no external balance for {walletNo} on {date}"
```

## 8. 文件结构变更

```diff
- DELETE: admin-web/src/pages/ReconciliationExternalBalancesListPage.tsx    (248 行)
- DELETE: admin-web/src/pages/ReconciliationExternalBalancesDetailPage.tsx  (301 行)
+ NEW:    admin-web/src/pages/ReconciliationExternalBalancesPage.tsx        (单页 master-detail, ~500 行)

* MODIFY: admin-web/src/App.tsx
    - 删两个 lazy import + 两个 Route
    + 加一个 lazy import + 一个 Route (path="reconciliation/external-balances")

* MODIFY: admin-web/src/rbac/permissions.ts
    - 删 RECON_EXTERNAL_BALANCE_DETAIL_READ（单页后无需细分）
```

净改动：前端 -49 行，后端 +2 字段 / -1 route / +1 route。1 个 PR 闭环。

## 9. 不变量

- 任何展示位置不出现 raw UUID / 内部 `id`（React `key` 除外）
- URL 不出现 UUID（用 walletNo + date）
- Master 一级分区按 source/asset class（CRYPTO/FIAT），不按 book
- Detail Hero 第一行固定为业务键 amber，无 `<Cap>` 标签
- closing balance 一致走 `formatAmount()`（与 admin 各页 amount 渲染对齐）
- Roll-forward Check 的 epsilon 固定 `0.000001`，绝不允许靠"看起来很接近"放行
- 老 `/external-balances/:statementId` route 彻底删除，无兼容期

## 10. 验收方式

按 `feedback_verify_ui_by_rendering` 铁律——纯 tsc + curl 200 不算数。

| # | 验收项 | 工具 | 判据 |
|---|---|---|---|
| 1 | 单页 master-detail 加载 | preview_snapshot | master 14 wallets 分两区 + detail placeholder |
| 2 | CRYPTO/FIAT 分区视觉 | preview_screenshot | 两区标题 "Crypto (HexTrust)" / "Fiat (Zand)" 正确 |
| 3 | 点击 wallet → detail | preview_click + snapshot | URL `?wallet=WAxxx` 同步 + Hero+RF+Lines 三段渲染 |
| 4 | Hero 7 字段 + closing 大字 | preview_screenshot | walletNo amber + SOURCE/BOOK/ROLE/CCY/OWNER + CLOSING 24px |
| 5 | Roll-forward continuous | preview_screenshot | 绿 ✅ + drift=0 |
| 6 | URL 直达 deep-link | preview_eval (window.location) | 直接 load detail，无需经 master |
| 7 | 老 statementId route 彻底死 | curl 旧 URL | 404 |
| 8 | 后端 list 新字段 | curl + jq | 行内含 walletNo / walletRole |
| 9 | 后端 detail by walletNo | curl `.../external-balances/WA2601011857?date=2026-06-28` | 200 + lines[] |
| 10 | 无 UUID 暴露 | grep snapshot 文本 | 无形如 `xxxxxxxx-xxxx-xxxx` 短串 |

## 11. 后续考虑（Deferred）

本期不做，待业务方反馈或独立立项：

- **手动同步对账单**——按钮触发 backend 重新从 Zand/HexTrust pull 当日数据
- **多日 wallet 历史趋势**——detail pane 加 "View 7-day history" 链跳新页画 closing 时序图
- **服务商节奏告警**——检测今天某 source 数据缺失，Notice Strip 红 banner
- **跨日期对比**——双 date picker 看 wallet 跨日差异
- **未匹配 walletNo 的兜底显示**——若 walletRef 在 wallets 表找不到（数据漂移），UI 显示 `walletRef.slice(0, 8)` short UUID 作为兜底（XREF 模式复用）

## 12. 引用

- [`doc-final/rules/frontend-admin.md`](../../rules/frontend-admin.md) —— admin 前端规范，Hero / Sidebar / token / URL key 约定
- [`admin-web/src/pages/AccountStatementPage.tsx`](../../../admin-web/src/pages/AccountStatementPage.tsx) —— master-detail 模式参考（mode='wallets' 路径）
- [`2026-06-28-recon-run-case-admin-style-design.md`](2026-06-28-recon-run-case-admin-style-design.md) —— 同期 recon admin 页面贴齐规范，确立 ID→No 全清扫 + Hero label:value 模式
- [`2026-06-26-phase-b-reconciliation-design.md`](2026-06-26-phase-b-reconciliation-design.md) —— Phase B 按物理钱包对账数据层基线，本设计对应其外部数据展示层
