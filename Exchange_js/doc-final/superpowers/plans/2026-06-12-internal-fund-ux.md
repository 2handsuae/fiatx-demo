# InternalFund UX 对齐 Payout + Payout gas — 实施计划

Spec：`doc-final/superpowers/specs/2026-06-12-internal-fund-ux-design.md`

## Task B1 — Payout gas 端到端（TDD）

- [ ] Prisma `Payout` 加 `gasUsed String?`、`effectiveGasPrice String?`，
      `npx prisma migrate dev --name payout_gas_fields`
- [ ] 红测：updateStatus CRYPTO CONFIRM 持久化传入 gas；无传入时生成 mock gas
      （payouts.service.spec.ts）
- [ ] DTO 加可选字段；updateStatus 写入 + CRYPTO CONFIRM mock 兜底（镜像 fiat referenceNo 先例）
- [ ] PayoutDetail Chain Details 加 Gas Used / Effective Gas Price InfoField
- [ ] 绿测 + 全模块 spec 通过

## Task B2 — funds 列表后端筛选 + 瘦身 + detail select（TDD）

- [ ] 红测：findAllForAdmin `type` → `where.asset = { type }`（funds-flow.service 或 controller spec）
- [ ] FundsQueryDto 加 `type`；findAllForAdmin 实现；list include 删 fromWallet/toWallet
- [ ] findOneByNoForAdmin internalTransaction select 补 `type: true`
- [ ] 绿测

## Task B3 — funds crypto REORG（TDD）

- [ ] 红测：CONFIRMING + REORG → BROADCASTED（crypto）；fiat REORG 仍非法
- [ ] `InternalFundAction.REORG` + `CRYPTO_TRANSITIONS[CONFIRMING][REORG] = BROADCASTED`
- [ ] 绿测

## Task F1 — fundActionMap.ts 重写

- [ ] per-rail 终态集；删两轨 CLEAR 按钮；crypto 加 REORG；导出 `isFundSimTerminal`
- [ ] 注释同步权威来源说明

## Task F2 — InternalFundDetailPage 重排

- [ ] Hero 补 Amount / Type / Asset(code·network)
- [ ] 新增 Transfer Route DetailCard（walletNo 链接、role、ownerNo、address/iban 快照+回退、Fee/Net）
- [ ] Chain Execution(crypto only) / Bank Transfer(fiat only) rail 拆分；txHash explorerTxUrl 链接
- [ ] Linked Transfer DetailCard（internalTxNo 链接 · Type · Path Label · Status badge）
- [ ] Status History 套 DetailCard；Sidebar Lifecycle 加 Sent At / Confirmed At
- [ ] Sim 面板换 IIFE：enabled 按钮 or 文案（CONFIRMED 自动清算文案 / 终态文案）

## Task F3 — InternalFundListPage 改造

- [ ] 筛选：Status 下拉(10) · Type 下拉 · 日期范围 · 保留 Fund No / Tx Hash 输入
- [ ] 列：Fund No · Status · Type · Asset · Amount · Tx Hash(截断) · Transfer · Created

## Task F4 — 终验 + 重启

- [ ] 全量 `npx jest` 0 failed（贴输出）
- [ ] `npm run build` + `cd admin-web && npx tsc --noEmit`
- [ ] `npm run dev:stop && npm run dev:start`（branch 端口 3500-3503），curl 两页面 200
- [ ] 勾选本计划 + 提交
