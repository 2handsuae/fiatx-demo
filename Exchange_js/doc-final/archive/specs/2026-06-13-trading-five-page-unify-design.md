# Trading 域 5 页样式统一 + 资金单字段补缺 — 设计

日期：2026-06-13
状态：已确认（用户批准两个决策点：统一骨架保留器官 / 链卡+补真缺执行字段）

## 背景

trading 域 5 个交易类型页面（deposit / withdraw / swap / internalTransaction / settlement）
历史分批建、骨架未收口，形成两套视觉家族。基准是已统一的
payout / payin / internalfund / settlement 详情页规范。

## 范围

5 列表页 + 5 详情页（admin-web）+ 后端 detail 服务字段补缺。

不在范围：抹平正当领域差异（swap 只读/无 compliance；deposit/withdraw 的 Compliance；
withdraw 的 Approval Gate）；不动已达标的 Deposit/Withdraw/Settlement 列表与 Settlement 详情。

## 统一基准（reference 规范）

- 列表：`PageTitleBar`（title+meta+actions）→ 标准筛选栏
  `flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2`
  + `fi` input class → `Pagination` → `AdminBadge` 状态徽章 + 截断 txHash
- 详情：`DetailPageHeader`(back+refresh) → Hero（`bg-adm-card px-6 py-5` mono amber 标题 + chips）
  → `divide-y` 的 `DetailCard` 区块列 → 272px Sidebar（`SidebarGroup`/`SidebarKV`）；
  字段用 `InfoField`，链上 hash 用 `explorerTxUrl`，关系用 `LinkedRelationCard`

## 一、列表页

| 页面 | 动作 |
|---|---|
| Deposit List | 不动（已标准） |
| Withdraw List | 不动（已标准） |
| Settlement List | 不动（已标准） |
| Swap List | 筛选栏 `grid`+异类 input → 标准 `flex-wrap`+`fi`；`ownerId`→`ownerNo`；保留业务列（Sell/Buy/Rate/Spread/Status/Created） |
| InternalTx List | 重建外壳：自定义 h1 → `PageTitleBar`；`bg-white rounded-xl`/`border-admin-border` → 标准筛选栏+`fi`；补 `Pagination`；自定义 badge 色 → `AdminBadge`。列内容保留（Internal Tx / Type·Source / Asset·Amount / From·To / Status / Action） |

## 二、详情页

| 页面 | 动作 |
|---|---|
| Settlement Detail | 不动（已达标） |
| Deposit Detail | Compliance/Linked Payin/Technical 裸 div → 包进 DetailCard；加 Linked 资金单卡；Chain 区补 confirmations/blockNo/gas（从腿）。保留 Compliance 内容 |
| Withdraw Detail | 同上裸 div 收进 DetailCard；加 Linked 资金单卡；补 blockNo/nonce/gas（从腿）。保留 Approval Gate + L3 Archive 内容 |
| Swap Detail | 保留只读 + Conversion/Pricing；Technical 裸 div → DetailCard；加 Linked 资金单卡（多腿列出 from/to/fee/spread 的 InternalTx）；无链上 enrich |
| InternalTx Detail | 加 Hero（mono amber 标题 + Status/Approval/Type/Amount chips）；加 272px Sidebar（Identity/Lifecycle/Actions）；自定义 `InfoCard` → `InfoField`；自定义 badge → `AdminBadge`；funds-legs 段保留（可换 LinkedRelationCard 列） |

## 三、后端字段补缺（TDD）

链路单向：`InternalTransaction.sourceType + sourceId` 反指交易。新增只读共享服务：

```
FundsOrderLookupService.findBySource(sourceType: 'DEPOSIT'|'WITHDRAW'|'SWAP', sourceId: string)
  → { internalTxNo, status, legs: [{ txHash, confirmations, blockNo, nonce,
                                     gasUsed, effectiveGasPrice, sentAt, confirmedAt }] } | null
```

- 注入 deposit / withdraw / swap 三个 detail service，响应合并 `fundsOrder` 字段
- 只读，不写状态，不碰 onboarding/compliance 门（守 CLAUDE.md 5 条）
- swap 多腿 → legs 数组；deposit/withdraw → 主腿（取第一条或唯一腿）
- 找不到资金单返回 null（交易未结算时正常）
- 放置：funds-layer 或 asset-treasury 现有 InternalTransaction owner 模块；避免循环依赖，
  必要时建独立 lean 模块导出该服务，trading 子模块 import

字段语义：
- Deposit 自身有 txHash，缺 confirmations/blockNo/gas → 从腿补
- Withdraw 自身有 txHash/confirmations，缺 blockNo/nonce/gas → 从腿补
- Swap 无真实链上 tx → legs 主要给链接价值，链上字段可空

## 执行分波

- W1：后端 `FundsOrderLookupService` + 3 detail service 接入（TDD 红→绿）
- W2：InternalTx 列表 + 详情（欠债最大）
- W3：Swap 列表 + 详情
- W4：Deposit + Withdraw 详情（裸 div 收口 + 链卡 + 补字段）
- W5：终验（全量 jest 0 failed、build、admin tsc）+ 重启 branch stack + curl 页面 200

## 验收

- 全量 `npx jest` 0 failed（红→绿证据）
- `npm run build` + `cd admin-web && npx tsc --noEmit` 通过
- 重启 branch stack（3500-3503），curl 5 列表 + 5 详情页 200
- 手动动线：deposit/withdraw/swap 详情可见 Linked 资金单卡可点击跳 InternalTx；
  InternalTx 详情有 Hero+Sidebar；Swap/InternalTx 列表骨架与 deposit 一致
