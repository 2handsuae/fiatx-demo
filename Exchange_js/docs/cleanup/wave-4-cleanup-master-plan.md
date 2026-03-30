# Wave 4 Cleanup Master Plan

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On:
- `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`
- `docs/constraints/wallet-account-model-constraints.md`
- `docs/constraints/business-base-config-release-constraints.md`
- `docs/constraints/pricing-and-quote-constraints.md`
Source of Truth Level: cleanup

## Current Debt
- round 3 已完成 wallet shadow balance schema retirement。
- `2026-03-30` closeout branch 已完成最后一组 active debt 收口：
  - pricing config admin 页面不再保留 read-only edit shell
  - `PricingCenterService.updateSwapPolicy / updateWithdrawalPolicy` 已物理删除
  - `docs/acceptance/wave-4-ledger-asset-structure-acceptance-checklist.md` 已从 `draft` 升为 active closeout baseline
- 当前剩余内容只包括：
  - 历史 migration SQL 痕迹
  - 历史 cleanup 记录
  - 后续如需继续处理时的 residual-only memory 边界

## Current Review Judgment
- `Wave 4` 的 round 1-3 cleanup 结论仍成立。
- `Wave 4` 的 post-closeout remediation 也仍成立。
- 截至 `2026-03-30`，`Wave 4` 的 active cleanup closeout 已完成。
- 当前更准确的理解是：
  - implemented scope landed
  - cleanup round 1-3 landed
  - post-closeout remediation landed
  - closeout baseline active
  - future work is residual-only
- 本文件现在保留为 `Wave 4` cleanup 的 closure record；后续若仍处理 `Wave 4`，应只围绕 residual historical traces 开线程。

## Closed Post-Closeout Findings From Current Review
| Finding | Files | Classification | Current Judgment |
| --- | --- | --- | --- |
| pricing config admin pages previously retained `detailMode = 'edit'`, editable controls, and `Save` no-op shell | `admin-web/src/pages/PricingSwapConfigPage.tsx`, `admin-web/src/pages/PricingWithdrawalConfigPage.tsx` | frontend read-only edit shell residue | closed on `2026-03-30`; pages are now pure read-only viewers |
| `PricingCenterService` previously kept `updateSwapPolicy` and `updateWithdrawalPolicy`, while no active controller route called them | `src/modules/trading/pricing-center/pricing-center.service.ts`, `src/modules/trading/pricing-center/pricing-center.service.spec.ts` | service-level write residual | closed on `2026-03-30`; write residual physically retired |
| `wave4-cleanup-inventory.ts` used typed escape hatch `(prisma as any)` for `walletBalanceSnapshot` access | `scripts/wave4-cleanup-inventory.ts` | post-closeout type-conformance residue | closed on `2026-03-30`; typed access now used directly |
| Wave 4 acceptance previously remained draft and carried explicit non-closure language | `docs/acceptance/wave-4-ledger-asset-structure-acceptance-checklist.md` | documentation closeout gap | closed on `2026-03-30`; acceptance is now active and aligned to implemented-scope closeout |

## Target End State
- 余额运行时真相只认 `wallet_balance_snapshot / wallet_balance_entry`；缺 snapshot 只返回零值和诊断状态，不再 fallback 到 wallet 行余额。
- `Wallet.balance / lockedBalance` 已从当前 schema 与当前实现中退役。
- `PricingCenterService` 成为唯一 quote runtime owner；`SwapQuotesService` 和 swap-only admin reader 被物理删除。
- 配置治理旧写 route 与 `/acct-events/sync-defaults` 被物理删除，只保留 read-only 面。
- demo/operator shortcut 从 runtime surface 移除；fixture/smoke 统一走脚本层。
- `seed/reset` 接管 canonical baseline：reset 后基础 pool wallet 自然拥有零值 snapshot。

## Scope
- round 2 已完成：compatibility-only route、shim、fallback、demo shortcut 的物理删除。
- round 3 已完成：`Wallet.balance / lockedBalance` schema retirement。
- 同步 cleanup 文档、inventory、wallet 相关约束/实体文档。
- cleanup 之后的 governance audit 与 core runtime type hardening 已作为 post-cleanup remediation 单独收口，不视为 cleanup round 4。

## Out Of Scope
- 不重构 `deposit / swap / InternalTx` 全生命周期。
- 不把 cleanup 扩成新的业务波次开发。
- 不改历史 migration SQL。

## Stages
### Stage 1: Fake Write Physical Deletion
- 物理删除 `COA / AcctEvent / JournalTemplate / ClearingTemplate / PricingPolicy` 的 fake-write route。
- 物理删除 `/acct-events/sync-defaults`。
- 删除 `ACCT_CONFIG_SYNC_ON_BOOT` 语义，只保留 startup validation。

### Stage 2: Balance Canonical Truth Hard Cut
- wallet / treasury runtime 不再兜底读取 `Wallet.balance / lockedBalance`。
- base seed 为 canonical pool wallets 建立零值 snapshot baseline。
- `dev:reset` 清空 snapshot/entry 并把 preserved pool wallet 的 shadow balance 归零，再交给 base seed 重建 baseline。

### Stage 3: Quote / Pricing Compatibility Shell Deletion
- 删除 `SwapQuotesService` shim，把调用点直接接到 `PricingCenterService`。
- 删除 swap-only admin reader 方法。
- 删除 old swap snapshot fallback；runtime 只认 `totalsJson / policyRef`。
- 在 inventory 持续为 `0` 的前提下，删除 withdraw far-expiry compatibility。

### Stage 4: Demo / Shortcut Removal
- 删除 `payins.simulate`、`depositTransactions.createRandom`、`swap preview` 的 runtime route 和 UI 按钮。
- 补偿入口只保留业务必要路径；demo fixture 能力迁移到 `scripts/**`。

### Stage 5: Retirement Inventory
- 记录 round 2 之后还留在 schema 中、但已不再被 runtime 读取的字段。
- 为 cleanup round 3 准备字段物理删除与 migration 顺序。

### Stage 6: Wallet Shadow Balance Schema Retirement
- 为 `Wallet.balance / lockedBalance` 发 cleanup migration。
- 同步收口 `seed.base.ts`、`reset-business-data.ts`、`wave4-cleanup-inventory.ts` 和 wallet/treasury 测试夹具。
- 更新 wallet 约束/实体文档，明确 snapshot/entry 是唯一余额真相。

## Post-Cleanup Audit / Type Conformance Closeout
- cleanup round 3 之后，又补齐了 `business config release` 的 canonical audit logging。
- `BusinessConfigService / TreasuryService / WalletsService / WithdrawWorkflowOrchestrator` 的高风险运行时 `as any` 已清理。
- 这部分属于 Wave 4 closeout remediation，而不是新的 cleanup round。

## Cleanup-Focused Commands
- `npm run wave4:cleanup:inventory`
- `npm test -- --runInBand src/modules/accounting/acct-events/acct-events.controller.spec.ts src/modules/accounting/acct-events/acct-config.service.spec.ts src/modules/asset-treasury/treasury/treasury.service.spec.ts src/modules/asset-treasury/wallets/wallets.service.spec.ts src/modules/trading/pricing-center/pricing-center.quote-lifecycle.spec.ts src/modules/trading/swap-transactions/swap-orchestrator.spec.ts src/modules/identity/access-control/rbac.catalog.spec.ts`
- `npx tsc --pretty false --noEmit`
- `cd admin-web && npm run build`
- `cd client-web && npm run build`

## Exit Criteria
- config fake-write route、`/acct-events/sync-defaults`、demo shortcut route 已不再注册。
- runtime 不再读取 wallet shadow balance 或 old swap snapshot fallback。
- reset 后 canonical pool wallet 自动拥有零值 snapshot baseline。
- `Wallet.balance / lockedBalance` 已不再出现在当前 schema、seed/reset、inventory、runtime、测试夹具中。
- cleanup inventory 可稳定输出 round-3 之后的字段退役状态。
- pricing config pages no longer preserve misleading edit/save shells once they are declared read-only.
- service-level pricing policy write residual is either physically retired or explicitly justified as a still-supported internal capability.
- Wave 4 acceptance status and wording match the actual closeout claim.
- `2026-03-30` current branch judgment:
  - the above exit criteria are satisfied
  - `Wave 4` should no longer remain in the active cleanup-closeout tier

## Rollback / Compatibility Note
- 本轮基于“交易数据可初始化”前提执行物理删除，不再为单条历史 quote 或旧 walletNo 保留长期 runtime fallback。
- 如 reset/smoke 证明仍有缺口，应优先修 seed/reset/fixture，而不是重新加回 compatibility shell。
