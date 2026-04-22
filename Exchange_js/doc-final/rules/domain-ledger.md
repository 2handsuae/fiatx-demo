# Domain: Ledger & Config Rules
Last Updated: 2026-04-21 | Scope: Wave 1–4 | Source: docs/constraints/posting-*, business-base-config-release-*, wallet-account-model-*, runtime-config-*

---

## Config Release Pipeline

**In-scope subjects (Wave 4):** `COA`, `AcctEvent`, `JournalTemplate`, `ClearingTemplate`, `PricingPolicy`
`Asset` is explicitly out of scope for the first release-governed subject model.

**Authoring model:** Config-as-code only. Admin UI is read-only. Operator self-service editing is forbidden.

**Release pipeline (must follow order):**
1. `stageRelease` — snapshot subject items into a named subject release
2. `validateRelease` — static + semantic dry-run validation
3. `publishRelease` — requires governance approval (Change Ticket + Approval) to be satisfied first

**Release naming convention:** `COA-REL-002`, `ACCTEVENT-REL-004`, `JOURNALTPL-REL-003` (subject-qualified, not platform-wide)

**Key rules:**
- Released revisions MUST NOT be edited in place.
- Each item owns independent revision history; items under the same subject MAY have different active revision numbers.
- `stageRelease`, `validateRelease`, `publishRelease` MUST write audit log evidence using: `module=governance/business-config`, `entityType=CONFIG`, `entityNo=releaseNo`, `triggerType=CONFIG_CHANGE`.
- Saving config content MUST NOT auto-activate it.
- `JournalHeaderTemplate + JournalLineTemplate` version as one bundle; `ClearingTemplate + ClearingLineTemplate` version as one bundle. Line-level independent revision streams are forbidden.

**Validation minimum requirements:** stable business key uniqueness, revision continuity per item, snapshot completeness, referenced template/event existence.

**Historical read views:** `Current`, `As-Of-Release`, `Revision Detail`, `Release Diff`.

---

## Posting & Journal Rules

**Canonical Wave 4 orchestration flow:**
```
Business transaction → AcctEvent → ClearingTemplate (same event context)
                                 → JournalTemplate  (same event context)
                                 → WalletBalanceProjection (from journal lines only)
```

**AcctEvent is the sole business-time trigger** — determines whether posting/clearing is required, which reversal event is linked, which template bundle is bound.

**Critical constraints:**
- `Clearing` and `Journal` MUST consume the same source context when triggered by the same event.
- `Clearing` MUST NOT be the source of truth for journal creation (and vice versa).
- Template evaluation failure MUST block durable output creation — MUST NOT degrade to silent success.
- Journal creation MUST enforce strong debit/credit balance validation.
- Source-level idempotency is mandatory for event-driven posting.
- Wallet-tracked asset lines MUST include wallet identity when the source path is wallet-bound.

**Withdraw-specific source compatibility:**
- Journal uses `sourceType=WITHDRAW`; clearing uses `sourceType=WITHDRAWAL`
- Clearing MUST NOT mutate the withdraw row to backfill fee/net amounts
- Terminal compensation closes existing `WITHDRAWAL` clearings by status update — MUST NOT mint a second clearing object

**Withdraw terminal no-orphan state requires:**
- No unreversed original journal on `sourceType=WITHDRAW, sourceId=<withdrawId>`
- No linked `WITHDRAWAL` clearing remains non-`CANCELLED`
- No wallet balance projection delta introduced twice by replay

---

## Balance Projection Rules

- Wallet balance MUST be derived from journal lines only — never from clearing lines.
- Durable balance structures: `WalletBalanceSnapshot` and `WalletBalanceEntry` (the only balance truth in Wave 4).
- `Wallet.balance / lockedBalance` have been retired — MUST NOT be used.
- Negative resulting wallet bucket balances MUST be blocked as explicit failure.
- Partial balance projection without matching journal durability is forbidden.
- Multi-entity writes for event-driven posting MUST remain transaction-bound.
- Repeated reversal replay MUST NOT create a second `WalletBalanceEntry` set for already-reversed lines.
- `reverseAllBySource` MUST skip journals that already have reversal journals — only create missing reversals.

---

## Wallet & Account Model Rules

**Unified carrier rule:** `Wallet` is the single durable carrier for both `CRYPTO_ADDRESS` and `FIAT_BANK`. No separate top-level `BankAccount` aggregate.

**Wallet identity fields (all required):** `walletNo` (globally unique), `ownerType` (`PLATFORM | CUSTOMER | LIQUIDITY_PROVIDER`), `ownerId`, `type`, `direction`, `walletRole`, `assetId`

**Supported types:** `FIAT_BANK`, `CRYPTO_ADDRESS`
**Supported directions:** `INBOUND`, `OUTBOUND`, `BIDIRECTIONAL`
**Supported roles:** `GENERAL`, `DEPOSIT`, `MASTER`, `PAYOUT`, `LIQ`, `CUST_BANK`, `LIQ_BANK`

**Asset binding:** Each wallet binds to exactly one `assetId`. Asset master data is outside the first config release model.

**Deterministic system wallet routing (role-based helpers):**
- `buildCryptoSystemWalletNo('MASTER'|'PAYOUT'|'LIQ', code, network)`
- `buildFiatPoolWalletNo('CUST_BANK'|'LIQ_BANK', code)`
- Ad-hoc random system wallet numbering is forbidden.

**Demo baseline pools:**
- Customer pool: pre-provisioned `MASTER`, `PAYOUT`, `CUST_BANK` per active asset scope
- Platform liquidity: pre-provisioned `LIQ`, `LIQ_BANK` per active asset scope
- `DEPOSIT` is on-demand (customer-generated inbound) — MUST NOT be pre-provisioned

**FIAT_BANK fields on Wallet:** `bankName`, `bankAccount`, `bankCode`, `accountName`, `beneficiaryName`, `iban` — MUST NOT be split into a separate persistence root.

---

## Runtime Config Rules

**Config file ownership:**
- Backend: `Exchange_js/.env`
- Admin frontend: `Exchange_js/admin-web/.env`
- Client frontend: `Exchange_js/client-web/.env`
- MUST NOT hardcode env values when an env key already exists.

**DB path convention:** SQLite MUST use ASCII-safe absolute paths. Pattern: `/tmp/exchange_js_<stack>/dev.db`. Stack resolution order: explicit `DATABASE_URL` env override → stack default path → local `.env`.

**Migration rules:** Apply via `scripts/apply-local-migrations.sh` (versioned SQL chain). Applied migration directories are immutable — tooling MUST fail fast on checksum drift.

**Standard commands (all in `Exchange_js/`):**
- `npm run dev:start` — full stack up, applies pending migrations, auto-heals IAM seed if missing
- `npm run dev:stop` — stop by managed PID + clean orphan processes
- `npm run dev:reset` — business data reset only (no DB truncate, applies pending migrations first)
- `npm run dev:rebuild` — full local DB rebuild from versioned migration runner
- `npm run runtime:diagnose` — reports DB path, migration drift, `driftDetected` flag

**Fixed port contract for `main` stack:** API `3000`, Admin `3001`, Client `3002`.

**Safety:** MUST NOT commit `node_modules/`, `dist/`, `*.db`, `*.log`, `.DS_Store`, or secrets.
