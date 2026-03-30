# Wave 4 Field Retirement Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On:
- `docs/cleanup/wave-4-cleanup-master-plan.md`
- `docs/constraints/wallet-account-model-constraints.md`
- `docs/constraints/pricing-and-quote-constraints.md`
Source of Truth Level: cleanup

## Purpose
- This file records the post-round-3 retirement order for `Wave 4` residual schema fields and historical compatibility concerns.
- It is an inventory, not a migration execution plan.

## Retirement Candidates
| Candidate | Current Readers / Paths | Historical Dependency | Required Before Physical Removal |
| --- | --- | --- | --- |
| `Wallet.balance` | retired from current schema/runtime in cleanup round 3 | Historical migrations still mention the field for old schema history | no runtime action remains; only historical migration traces stay |
| `Wallet.lockedBalance` | retired from current schema/runtime in cleanup round 3 | Same as `Wallet.balance` | no runtime action remains; only historical migration traces stay |
| legacy `SYS_*` walletNo fallback | removed from runtime in cleanup round 2 | Existing migrations still mention old patterns for historical rename traceability | keep inventory check at `0`, then ignore until schema/SQL cleanup round |
| swap quote `feeBreakdown`-derived snapshot fallback | removed from runtime in cleanup round 2 | Old resettable quote rows may become unreadable if manually preserved | reset business data or rebuild fixtures; do not restore fallback |
| withdraw far-expiry compatibility | removed from runtime in cleanup round 2 when inventory reached `0` | Historical far-expiry rows are no longer a supported runtime case | rely on resettable-data assumption; no compatibility reintroduction |
| demo payin / deposit / swap preview shortcuts | removed from runtime/UI in cleanup round 2 | Smoke may still need similar fixture setup | keep fixture logic in `scripts/**`, not in product routes |
| `/acct-events/sync-defaults` and `ACCT_CONFIG_SYNC_ON_BOOT` | removed from runtime in cleanup round 2 | Old operator memory may still mention them | update runbooks/operator docs; do not restore compatibility-only shell |
| `PricingCenterService.updateSwapPolicy / updateWithdrawalPolicy` | retired from `src/modules/trading/pricing-center/pricing-center.service.ts` on `2026-03-30`; validation coverage moved to assert-based spec paths | historical fake-write semantics survived as service-level residual after route retirement | closed; keep only as retirement history |
| pricing config page edit/save shell | retired from `admin-web/src/pages/PricingSwapConfigPage.tsx`, `admin-web/src/pages/PricingWithdrawalConfigPage.tsx` on `2026-03-30` | read-only convergence left UI edit skeleton behind | closed; pages are now read-only viewers |

## Current Cleanup Evidence Sources
- Runtime / type / build checks:
  - `npm test -- --runInBand src/modules/asset-treasury/treasury/treasury.service.spec.ts src/modules/asset-treasury/wallets/wallets.service.spec.ts src/modules/trading/pricing-center/pricing-center.quote-lifecycle.spec.ts`
  - `npx tsc --pretty false --noEmit`
  - `cd admin-web && npm run build`
- Inventory:
  - `npm run wave4:cleanup:inventory`

## Removal Order
1. round 2 physical deletion: fake-write route, demo shortcut, quote/runtime shim
2. round 3 schema retirement: `Wallet.balance`, `Wallet.lockedBalance`
3. later historical SQL/doc cleanup for migration-era references only

## Notes
- `PricingCenterService` is now the only quote runtime owner.
- `wallets.service` and `treasury.service` now treat snapshot/ledger as canonical truth.
- wallet shadow balances are no longer part of the current Prisma schema.
- cleanup round 3 之后，Wave 4 还补齐了 governance release audit logging 和 core runtime type hardening；这些属于 post-cleanup remediation，不新增 retirement candidate。
- `Wave 4` 的 active closeout debt 已在 `2026-03-30` 收口；当前文档仅保留 retirement history 和 residual-memory 边界。
