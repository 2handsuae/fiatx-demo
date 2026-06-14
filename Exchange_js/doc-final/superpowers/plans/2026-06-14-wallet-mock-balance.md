# 钱包 mockBalance 余额变更 — 实施计划

Spec：`doc-final/superpowers/specs/2026-06-14-wallet-mock-balance-design.md`

串行 TDD（都改后端余额，不并行）。

## T1 — WalletBalanceService.adjust（TDD）

- [ ] 红测：adjust(id, +Δ, tx) → wallet.update increment Δ；负数结果允许；walletId null → no-op
- [ ] 实现 service + 注册到 wallets module（导出）
- [ ] 绿测

## T2 — internalfund CLEAR 挂 adjust（TDD）

- [ ] 红测 funds-flow.service.spec：updateStatus→CLEAR、autoClearConfirmedFunds 两路径各
      adjust(fromWalletId,−amount)+adjust(toWalletId,+amount)
- [ ] funds-flow 注入 WalletBalanceService，两处挂载（同事务 tx）
- [ ] 绿测

## T3 — payout CLEARED 挂 adjust（TDD）

- [ ] 红测 payouts.service.spec：CLEARED → 解析来源钱包 → adjust(src,−amount)
- [ ] resolveSourceWallet 改造可取 walletId（或新增取 wallet 查找）；updateStatus CLEARED 挂载
- [ ] 绿测

## T4 — payin CLEARED 挂 adjust（TDD）

- [ ] 红测 payins.service.spec：CLEARED → adjust(toWalletId,+amount)
- [ ] payins 注入 WalletBalanceService，CLEARED 分支挂载（同事务）
- [ ] 绿测

## T5 — C_CMA 读时派生 ΣVIBAN（TDD）

- [ ] 红测 wallet-query.spec：role=C_CMA 读 balance = Σ 该资产 C_VIBAN mockBalance；
      C_VIBAN/其他读自身
- [ ] wallet-query findAll/findOne：C_CMA 分支现算汇总
- [ ] 绿测

## T6 — 终验 + 重启

- [ ] 全量 `npx jest` 0 failed（贴输出）
- [ ] `npm run build` + `cd admin-web && npx tsc --noEmit`
- [ ] `npm run dev:stop && npm run dev:start`（branch 3500-3503）
- [ ] 勾选计划 + 分层提交
