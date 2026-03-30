Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`, `docs/constraints/wallet-account-model-constraints.md`, `docs/constraints/business-base-config-release-constraints.md`, `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/constraints/pricing-and-quote-constraints.md`
Source of Truth Level: acceptance

# Wave 4 Ledger + Asset Structure Acceptance Checklist

## Purpose

This checklist records the current Wave 4 acceptance target and the closeout evidence already gathered for delivered slices.

It verifies that Wave 4 has reached a usable platform-foundation baseline for:

- asset and wallet/account structure
- business base config release history
- event-driven clearing and journal behavior
- quote snapshot and fee skeleton behavior

## Positioning

- This remains the Wave 4 acceptance and closeout record.
- `Phase 0-2` core runtime is now implemented for wallet/account model and business base config governance.
- `Phase 2` closeout evidence is already recorded below.
- `Phase 3` current runtime slice is implemented for `Withdraw` only.
- `Phase 4-5` implemented-scope closeout evidence is already recorded below.
- Post-closeout remediation evidence is also recorded below for the latest governance-audit and type-conformance fixes.
- As of `2026-03-30`, Wave 4 should be read as:
  - implemented-scope closeout complete
  - pricing admin pages are explicitly read-only
  - internal fake-write pricing policy methods are retired
  - only historical migration / cleanup traces remain

## Environment Baseline

Manual validation should run against the standard local baseline:

1. `npm run stack:down:main`
2. `npm run db:migrate:local`
3. `npm run db:base:sync`
4. `npm run dev:reset`
5. `npm run dev:start`

## Fixed Scope

- in scope:
  - `COA / AcctEvent / ClearingTemplate / JournalTemplate / PricingPolicy` release-governed baseline
  - `Wallet` as the unified carrier for crypto and bank-like account semantics
  - `withdraw quote -> transaction -> event -> clearing/journal`
  - wallet balance projection from journal lines
- out of scope:
  - full `deposit` lifecycle acceptance
  - full `swap` lifecycle acceptance
  - `InternalTx` unified event execution acceptance
  - operator self-service config authoring

## Chain 1: `COA Release` History Replay

1. Prepare one released `COA` baseline and one later superseding `COA` release.
2. Open the `Current` view for `COA`.
3. Verify:
   - one active `COA` subject release is visible
   - each `accountCode` resolves to one active revision
4. Open `As-Of-Release` for the earlier `COA` release.
5. Verify:
   - the whole subject snapshot matches the earlier release
   - unchanged items reuse prior revisions
   - changed items point to newer revisions only in the later release
6. Open one changed `COA` item revision history.
7. Verify:
   - revision detail is available
   - item-level history and subject-level release history tell a coherent story

## Chain 2: `WITHDRAW quote -> approved event -> clearing + journal`

1. Request a withdrawal pricing quote.
2. Create a withdrawal transaction with `quoteId`.
3. Advance the withdrawal flow to `APPROVED -> PAYOUT_PENDING`.
3. Verify:
   - one approved-event clearing is created
   - one approved-event journal set is created
   - journal lines are balanced
4. Verify:
   - clearing and journal consume the same frozen withdraw context
   - withdraw fee/net values come from the already-persisted withdrawal row, not from clearing backfill
5. Open wallet balance history for the affected wallet.
6. Verify:
   - wallet balance entries are derived from journal lines
   - snapshot totals change consistently with the journal output
   - no duplicate durable records appear on idempotent re-trigger

## Chain 3: `WITHDRAW terminal status events`

1. Starting from an already created withdrawal, drive these terminal paths:
   - `SUCCESS`
   - `FAILED`
   - `RETURNED`
   - `CANCELLED`
   - `REJECTED`
2. Verify:
   - each transition is still `AcctEvent`-driven
   - `SUCCESS` remains posting-only
   - `FAILED / RETURNED` keep reversal / bulk reversal semantics
   - `CANCELLED / REJECTED` keep auto-reversal semantics
   - repeated event execution stays replay-safe

## Failure Path 1: Missing Template

1. Trigger an event whose referenced template is missing.
2. Verify:
   - event execution fails explicitly
   - no clearing, journal, or wallet balance projection is partially created

## Failure Path 2: Unbalanced Journal

1. Trigger a journal render that resolves to unbalanced debit/credit lines.
2. Verify:
   - posting is blocked
   - no wallet balance projection is written
   - error is visible with enough event/source context for diagnosis

## Failure Path 3: Repeated Event / Repeated Publish

1. Re-trigger an already-processed source event.
2. Verify:
   - idempotency prevents duplicate clearing/journal/balance records
3. Attempt to re-apply an already-active subject release.
4. Verify:
   - release activation remains replay-safe
   - history stays readable without duplicating active state

## Pass Criteria

- `COA` history can be inspected at both release and revision levels.
- withdraw approved event can produce both clearing and journal outputs without duplicate replay.
- withdraw pricing path clearly separates quote creation from event-driven accounting behavior.
- withdraw terminal status events remain event-governed and replay-safe.
- template failure, journal imbalance, and replay conditions block cleanly without dirty balances.
- Wave 4 validation can be explained through durable docs rather than chat-only assumptions.

## Phase 5 Closeout Evidence

`Phase 5` closeout is based on implemented scope, not the full original Wave 4 blueprint.

Recommended command sequence:

1. `npm run stack:down:main`
2. `npm run db:migrate:local`
3. `npm run db:base:sync`
4. `npm run dev:reset`
5. `npm run dev:start`
6. `npm test -- --runInBand src/modules/trading/pricing-center/pricing-center.service.spec.ts src/modules/trading/pricing-center/pricing-center.quote-lifecycle.spec.ts src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`
7. `npx tsc --pretty false --noEmit`
8. `cd admin-web && npm run build`
9. `npm run wave4:pricing:quote:smoke`

Minimum pass criteria for this closeout:

- local `main` DB migrates to latest schema without checksum drift or manual DB patching
- `swap` quote create / cancel / admin read works through both unified quote center and legacy admin alias paths
- `withdraw` quote create / cancel / consume works with real TTL instead of far-expiry
- admin unified `Quote Center` can read both `SWAP` and `WITHDRAWAL`
- local evidence is recorded with quote IDs, quote numbers, withdraw number, and command chain

## Closeout Verification Snapshot

Verified on `2026-03-30` against the standard local `main` stack:

1. `npm run runtime:diagnose`
2. `npm run dev:start`
3. `npm test -- --runInBand src/modules/trading/pricing-center/pricing-center.service.spec.ts src/modules/trading/pricing-center/pricing-center.quote-lifecycle.spec.ts src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`
4. `npm test -- --runInBand src/modules/governance/business-config/business-config.service.spec.ts src/modules/asset-treasury/wallets/wallets.service.spec.ts src/modules/asset-treasury/treasury/treasury.service.spec.ts src/orchestrators/withdraw-workflow.orchestrator.spec.ts`
5. `npx tsc --pretty false --noEmit`
6. `cd admin-web && npm run build`
7. `npm run wave4:cleanup:inventory`
8. `npm run wave4:pricing:quote:smoke`

Recorded closeout confirmation on `2026-03-30`:

- `runtime:diagnose` reported:
  - `dbFile = /tmp/exchange_js_main/dev.db`
  - `migration.driftDetected = false`
- pricing admin pages are now read-only viewers:
  - no misleading edit/save shell remains
- `PricingCenterService.updateSwapPolicy / updateWithdrawalPolicy` are no longer present in runtime code
- `wave4:cleanup:inventory` reported:
  - `walletsMissingSnapshot = 0`
  - `legacySysWalletNos = 0`
  - `swapQuoteFallbackCandidates = 0`
  - `withdrawFarExpiryCandidates = 0`
- `wave4:pricing:quote:smoke` completed successfully with:
  - customer `CUST-MIN-0003`
  - swap quote create/cancel path working through unified admin read and legacy admin alias
  - withdraw quote cancel/use path producing a new withdraw number

Recorded local closeout evidence on `2026-03-23`:

- scope: `implemented-scope`
- migration chain:
  - `npm run stack:down:main`
  - `npm run db:migrate:local`
  - `npm run db:base:sync`
  - `npm run dev:reset`
  - `npm run dev:start`
- smoke command: `npm run wave4:pricing:quote:smoke`
- accounts:
  - admin: `admin@fiatx.com`
  - customer: `minimal_active@example.com`
- smoke evidence:
  - customer: `CUST-MIN-0003` / `976263ea-a742-4374-9426-17724932654d`
  - outbound BTC wallet: `8a9a1d11-1da4-444d-9417-bb005e439007` / `WA-GEN-2603232761`
  - balance fixture:
    - `toppedUp = true`
    - `journalNo = SMK-JRN-20260323123548-0DNZ`
    - `currentBalance(before top-up) = 0`
    - `targetBalance = 1`
  - swap quote:
    - created: `QUO2603233582` / `8c436988-1980-44b3-ba95-abf8b7f84738`
    - cancelled through customer quote API and re-read through unified + legacy admin endpoints
  - withdraw quote:
    - cancelled quote: `WQO2603231270` / `572259e4-6f84-4dc4-85e5-96daf7174bdf`
    - consumed quote: `WQO2603235660` / `8e6eacab-f4f9-4327-af2b-e034193adf5c`
    - created withdrawal: `WD2603230362`
- note:
  - this closeout does not claim full `swap` lifecycle, full `deposit` lifecycle, or `InternalTx` acceptance
  - clean reset after `dev:start` still showed intermittent full-stack backend instability; the final successful smoke was completed against the same `main` DB using backend-only runtime on `API_PORT=3000`

## Post-Closeout Remediation Evidence

Recommended verification for the latest Wave 4 `P1` remediation:

1. `npm test -- --runInBand src/modules/governance/business-config/business-config.service.spec.ts src/modules/asset-treasury/wallets/wallets.service.spec.ts src/modules/asset-treasury/treasury/treasury.service.spec.ts src/orchestrators/withdraw-workflow.orchestrator.spec.ts`
2. `npx tsc --pretty false --noEmit`
3. `rg -n "as any|GovernanceDb|tx: any|Record<string, any>" src/modules/governance/business-config/business-config.service.ts src/modules/asset-treasury/treasury/treasury.service.ts src/modules/asset-treasury/wallets/wallets.service.ts src/orchestrators/withdraw-workflow.orchestrator.ts`

Minimum pass criteria for this remediation closeout:

- `business config release` `stage / validate / publish` actions write canonical audit evidence
- validation failure and publish gate blocking also leave durable audit evidence
- the 4 targeted Wave 4 runtime files no longer depend on `as any`
- behavior regression does not appear in governance, wallet, treasury, or withdraw workflow tests

Recorded remediation evidence on `2026-03-23`:

- test command:
  - `npm test -- --runInBand src/modules/governance/business-config/business-config.service.spec.ts src/modules/asset-treasury/wallets/wallets.service.spec.ts src/modules/asset-treasury/treasury/treasury.service.spec.ts src/orchestrators/withdraw-workflow.orchestrator.spec.ts`
- compile command:
  - `npx tsc --pretty false --noEmit`
- source scan:
  - `rg` returned no runtime `as any`, `GovernanceDb`, or `tx: any` matches in the 4 targeted files
- functional conclusion:
  - `business config release` lifecycle actions now have canonical audit evidence
  - `BusinessConfigService`, `TreasuryService`, `WalletsService`, and `WithdrawWorkflowOrchestrator` no longer rely on runtime `as any`

## Practical Conclusion

- `Wave 4` acceptance is no longer `draft`.
- `Wave 4` now has an active implemented-scope closeout baseline.
- Future Wave 4 work should be treated as residual historical cleanup, not active closeout.

## Phase 3 Runtime Evidence

Recommended automated verification for the delivered `Withdraw` slice:

1. `npm test -- --runInBand src/orchestrators/accounting-event-execution.service.spec.ts src/orchestrators/withdraw-workflow.orchestrator.spec.ts src/modules/accounting/journals/journals.service.spec.ts src/modules/clearing-settle/clearing/clearings.service.spec.ts`
2. `npm test -- --runInBand src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts src/modules/trading/pricing-center/pricing-center.service.spec.ts`
3. `npx tsc --pretty false --noEmit`

Minimum pass criteria for this closeout:

- unified event execution can drive `Withdraw approved -> clearing + journal`
- withdraw pricing quote remains the required upstream input
- withdraw success and terminal failure/reversal paths remain event-driven
- no clearing side effect backfills `feeAmount` / `netAmount` onto the withdraw row during approved execution

## Phase 4 Runtime Evidence

Recommended automated verification for the delivered `Pricing / Quote` slice:

1. `npm test -- --runInBand src/modules/trading/pricing-center/pricing-center.service.spec.ts src/modules/trading/pricing-center/pricing-center.quote-lifecycle.spec.ts src/modules/trading/swap-transactions/swap-orchestrator.spec.ts`
2. `npx tsc --pretty false --noEmit`
3. `cd admin-web && npm run build`

Minimum pass criteria for this closeout:

- `PricingCenterService` owns both `swap` and `withdraw` quote lifecycle
- swap quote runtime no longer depends on `SwapQuotesService` or `feeBreakdown -> totals/policyRef` fallback
- new `withdraw` quotes use real TTL without legacy far-expiry compatibility in runtime
- admin `/dashboard/pricing/quotes` can read both `SWAP` and `WITHDRAWAL`
- `SwapQuote` snapshot fields include durable `totalsJson` and `policyRef`

## Phase 2 Closeout Evidence

`Phase 2` closeout MUST record one successful local smoke for the `COA` subject.

Recommended command sequence:

1. `npm run db:base:sync`
2. `npm run dev:reset`
3. `npm run config:release:stage -- --subject COA`
4. `npm run config:release:validate -- --release <COA-REL-xxx>`
5. `npm run config:release:publish -- --release <COA-REL-xxx> --change-ticket <CT_NO>`

Minimum pass criteria for this closeout:

- one `COA` release is successfully staged, validated, and published
- `Current` release query returns the newly active `COA` release
- `Release Diff` is readable for the published release
- `Revision Detail` is readable for at least one `COA` item revision
- read-only config interfaces remain available after fake-write route deletion

Recorded local closeout evidence on `2026-03-23`:

- change ticket: `CT2603237927`
- approval case: `APR2603236666`
- published release: `COA-REL-001`
- publish result:
  - `COA-REL-001` moved to `ACTIVE`
  - `changeTicketId` and `approvalCaseId` were bound on publish
  - `Release Diff` and `Revision Detail` were readable through `/admin/business-config/**`
  - legacy compatibility route `/acct-events/sync-defaults` still existed during Phase 2 closeout, but has been physically deleted in Wave 4 cleanup round 2
