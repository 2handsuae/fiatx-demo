# External Balances 历史视图 = 日期选择器（设计）

> 状态：设计已与用户对齐（2026-06-23 选「甲」），已实施。
> 范围：给 External Balances 加「时间」维度，使历史按天可查；并修详情页流水跨天串数据的 bug。

## 1. 问题

`external_balances` 按 `(source, accountRef, cutoffDate)` 唯一 —— 历史**本就按天存着**。但：
1. 列表页([ReconciliationExternalBalancesListPage](../../../admin-web/src/pages/ReconciliationExternalBalancesListPage.tsx))一次拉所有日期、只按 book 分组、**连日期列都没有** → 多天时同账户冒多行、分不清哪天。
2. 详情页 `getExternalBalance` 查流水按 `source+accountRef+currency`、**不带日期** → 多天数据串到一个单日 statement，roll-forward 自检算错（潜在 bug）。

## 2. 方案（甲：日期选择器）

为何选甲：它复用全站现成的「filter bar + 选择器」范式（PayinList 等 10 个页面已有 `type=date` 筛选）→ **零新样式、天然一致**；乙（账户走势）/丙（按日期折叠）需引入全站没有的新 UI。

### 2.1 列表页（纯前端）
- `PageTitleBar` 下加一条 filter bar（复用现有样式：`border-b border-adm-border bg-adm-panel`，select 用 `h-[30px] ... bg-adm-bg font-mono text-[11px]`）。
- 选择器 = 业务日下拉（选项 = 数据里实际存在的 `cutoffDate`，**新到旧**排，默认最新一天）。
- 日期选项从已拉到的数据**前端派生**（列表本就返回全部），**不加新接口 / 不动 RBAC**。
- 只渲染**选中日期**的账户（`visible = balances.filter(cutoffDate === selectedDate)`）→ 不再有跨天重复行。
- 标题副文案显示当前日期 + 账户数。

### 2.2 详情页（后端必修 bug）
- `getExternalBalance`：流水查询补 `datetime ∈ [cutoffDate 00:00, 23:59:59]`，限定该余额的业务日 → 不再跨天串、roll-forward 自检正确。

## 3. 刻意不做（YAGNI）
- 不做服务端分页 / 日期接口（数据量小，前端派生足够）。
- 不做乙/丙的新 UI。

## 4. 验证
- jest：query 服务加 `getExternalBalance` 按日期限定的断言（`reconciliation-query.service.spec`）。
- 前端 tsc 干净。
- 渲染：列表页出现日期下拉、只显当天、无跨天重复行、风格与其他列表页一致；截图留证。
