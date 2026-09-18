# Outstanding 列表/详情页 — Admin 规范改造 Design

> 状态：设计收口（pre-implementation）
> 适用：`SwapOutstandingList.tsx` + `SwapOutstandingDetail.tsx`（Outstanding 实体，后端 `/admin/reconciliation/outstandings`）
> 目标：把两页从旧浅色样式重写为 admin 暗色规范（对齐 `SettlementListPage`/`SettlementDetailPage`/`InternalFundListPage`），并给详情页加 Settlement linkage 区。

---

## 1. 范围

- **改**：`admin-web/src/pages/SwapOutstandingList.tsx`、`SwapOutstandingDetail.tsx`。
- **小幅后端**：`outstandings.service.ts` `findOneForAdmin` 的 `include` 补 settlement 关联（无 schema 变更）。
- **不动**：路由（`/dashboard/reconciliation/outstandings` + `/:id`）、导航（"Swap Outstandings"）、后端列表端点、`OutstandingSettlement*` 旧页面。

admin 规范模板：`admin-web/src/pages/funds-layer/SettlementListPage.tsx`（列表）、`SettlementDetailPage.tsx`（详情）。复用 `PageTitleBar`、`AdminBadge`、`Pagination`、`adminFetch`/`getApiErrorMessage`/`AdminSessionError`、`adminButtonClass`/`adminIconButtonClass`、`formatAssetAmount`/`formatRate8`。

---

## 2. List 页（`SwapOutstandingList.tsx` 重写）

对齐 `SettlementListPage` 结构：

- **`PageTitleBar`**：title `Swap Outstandings`，meta `${total} outstanding(s)`，右侧 refresh `adminIconButtonClass`。删除旧 `text-2xl text-gray-900` 标题块 + `<p>` 副标题。
- **暗色 filter bar**（`bg-adm-panel`、`fi` input class，对齐模板）：保留全部筛选 —— status / direction / outstandingNo / ownerNo / sourceNo(Swap) / assetId / startDate / endDate；Search（`adminButtonClass('listPrimary')`）+ Reset（`listSecondary`，无筛选时禁用）。
  - **修 bug**：status 下拉从 `OPEN/LOCKED/CLOSED` 改为 **`OPEN/LOCKED/SETTLED`**（实际状态用 SETTLED，CLOSED 不存在）。
- **暗色 `font-mono` 表格**，列：Outstanding No / Direction / Status / Owner No / Source No(Swap) / Asset·Amount / Created。
  - Status、Direction 用 **`AdminBadge`**（替换 `bg-green-100`/`bg-red-100`/`bg-blue-100` 圆角 pill 与 `renderDirection`）。
  - Outstanding No 用 amber `font-mono` key 样式（对齐模板）；金额 `formatAssetAmount(amount, asset?.decimals)`。
  - 整行可点 → `navigate('/dashboard/reconciliation/outstandings/' + item.id)`（删除单独 Action 列的 View 按钮，行点击即可；与模板一致）。
- **分页**：新增 `Pagination`（后端已返回 `total` 且支持 `skip/take`，旧页面未用）。`PAGE_SIZE=20`，`params.set('skip', (page-1)*PAGE_SIZE)`、`take`。固定带 `sourceType=SWAP`。
- **竞态防抖**：`requestSeqRef`（对齐模板，避免快速筛选/翻页的乱序响应）。
- 错误：`getApiErrorMessage` + `AdminSessionError` 忽略（对齐模板）。

---

## 3. Detail 页（`SwapOutstandingDetail.tsx` 重写）

对齐 `SettlementDetailPage` 暗色版（**弃用** compliance 的 `DetailCard`/`DetailPageHeader` 浅色组件，改用模板的暗色 section + 本地 `Field`）：

- **Header**：标题 `Swap Outstanding`，副标题 outstandingNo，状态 `AdminBadge`，Back（→ 列表）+ Refresh。
- **区 1 — Overview**：Outstanding No / Status / Direction / Owner（`ownerType · ownerNo`）/ Source（`sourceType · sourceNo`）/ Asset / Amount / Created / Updated。
- **区 2 — Linked Swap**：Swap No / Quote No / Swap Status / Pair（from→to code）/ Amounts(`formatAssetAmount`) / Exchange Rate(`formatRate8`)；无 swap 时空态。
- **区 3 — Settlement linkage（新增）**：展示该 Outstanding 被如何消费（V7 结算闭环）：
  - Settlement Batch：`batchNo`（+ `settlementType` · `status`），可点 → `/funds-layer/settlements/:batchNo`
  - Settled By Transfer：`internalTxNo`（+ `pathLabel` · `status`），可点 → `/funds-layer/transfers/:internalTxNo`
  - Closed By Fund：`internalFundNo`（+ `status`），可点 → `/funds-layer/funds/:internalFundNo`
  - 三者皆空时显示空态 "Not yet settled."（OPEN outstanding 尚未消费）。
  - **仅展示业务 No，不展示任何 UUID**；跨实体跳转用业务键路由（符合 memory「禁止暴露原始 ID」规则）。

---

## 4. 后端改动（`outstandings.service.ts` `findOneForAdmin`，无 schema 变更）

Outstanding 模型已有关系 `settlementBatch` / `settledByTransfer`(关系名 `OutstandingSettledByTransfer`→InternalTransaction) / `closedByInternalFund`(→InternalFund)。给 `findOneForAdmin` 的 `include` 增补（只 select 业务 No + 关键字段，不返回 UUID 给前端展示）：

```ts
include: {
  asset: true,
  swapTransaction: { include: { fromAsset: true, toAsset: true, quote: true } },
  settlementBatch:      { select: { batchNo: true, settlementType: true, status: true } },
  settledByTransfer:    { select: { internalTxNo: true, pathLabel: true, status: true } },
  closedByInternalFund: { select: { internalFundNo: true, status: true } },
}
```

列表端点 `findAllForAdmin` **不改**（列表不需要 settlement 关联）。

---

## 5. 横切

- **不暴露 UUID**：页面展示一律业务键（outstandingNo / swapNo / ownerNo / batchNo / internalTxNo / internalFundNo）。详情路由仍按 `:id`（URL param，不在页面内渲染 raw id）—— 按你的决定保持最小改动。
- **路由 / 导航不动**；纯重写 2 个前端文件 + 1 处后端 include。
- 顺手清理：旧 `renderDirection`、浅色 `Field`、`DetailCard`/`DetailPageHeader` 依赖移除（仅限本两页用到的）。

---

## 6. Out of Scope

- `OutstandingSettlement*`（旧 Wave-8 结算视图）—— 不在本轮（属 Wave-8 遗留清理）。
- 导航分组迁移、详情按 `outstandingNo` 路由（需后端 `findOneByNo`）—— 推后。
- 列表端点字段/分页逻辑变更（后端列表已 OK）。

---

## 7. 交付清单

| 文件 | 改动 |
|---|---|
| `admin-web/src/pages/SwapOutstandingList.tsx` | 重写为 admin 暗色规范（PageTitleBar/AdminBadge/Pagination/requestSeq/暗色 filter bar/行点击）+ status 选项修正 SETTLED |
| `admin-web/src/pages/SwapOutstandingDetail.tsx` | 重写为暗色规范 3 区（Overview / Linked Swap / Settlement linkage，业务键跨链） |
| `src/modules/clearing-settle/outstandings/outstandings.service.ts` | `findOneForAdmin` include 增补 settlement 关联（select 业务 No）|

---

## 8. 不变量速查
- 纯样式 + 一处后端 include 增补；**无 schema、无路由/导航、无列表端点变更**。
- 列表分页、状态选项（SETTLED）修正一并落地。
- 全程业务键展示，零 UUID 暴露；Settlement linkage 跨链到 batch/transfer/fund 详情。
