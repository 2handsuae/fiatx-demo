# Trading 5 页样式统一 + 资金单 enrich — 实施计划

Spec：`doc-final/superpowers/specs/2026-06-13-trading-five-page-unify-design.md`

## W1 — 后端 FundsOrderLookupService + 3 service 接入（TDD）

- [x] 红测：`FundsOrderLookupService.findBySource('DEPOSIT', id)` →
      查 InternalTransaction(sourceType+sourceId) include funds，返回
      `{ internalTxNo, status, legs[txHash/confirmations/blockNo/nonce/gasUsed/effectiveGasPrice/sentAt/confirmedAt] }`；
      找不到返回 null
- [x] 实现服务 + 模块导出（避免循环依赖，必要时独立 lean 模块）
- [x] deposit/withdraw/swap detail service 注入 + 响应合并 `fundsOrder`（红测各 1 条）
- [x] 绿测 + 相关 spec 全过

## W2 — InternalTransaction 列表 + 详情（欠债最大）

- [x] List：自定义 h1 → PageTitleBar；`bg-white rounded-xl`/`border-admin-border` → 标准筛选栏+`fi`；补 Pagination；自定义 badge → AdminBadge
- [x] Detail：加 Hero（mono amber 标题 + Status/Approval/Type/Amount chips）；加 272px Sidebar（Identity/Lifecycle/Actions）；`InfoCard` → `InfoField`；自定义 badge → AdminBadge；funds-legs 段保留/换 LinkedRelationCard

## W3 — Swap 列表 + 详情

- [x] List：`grid` 筛选 → 标准 `flex-wrap`+`fi`；`ownerId`→`ownerNo`；保留业务列
- [x] Detail：Technical 裸 div → DetailCard；加 Linked 资金单卡（多腿）；保留 Conversion/Pricing/只读

## W4 — Deposit + Withdraw 详情

- [x] Deposit：Compliance/Linked Payin/Technical 裸 div → DetailCard 容器；加 Linked 资金单卡；Chain 区补 confirmations/blockNo/gas（fundsOrder）
- [x] Withdraw：同上裸 div 收口；加 Linked 资金单卡；补 blockNo/nonce/gas；保留 Approval Gate/L3

## W5 — 终验 + 重启

- [x] 全量 `npx jest` 0 failed（贴输出）
- [x] `npm run build` + `cd admin-web && npx tsc --noEmit`
- [x] `npm run dev:stop && npm run dev:start`（branch 3500-3503），curl 5 列表 + 5 详情 200
- [x] 勾选计划 + 分层提交
