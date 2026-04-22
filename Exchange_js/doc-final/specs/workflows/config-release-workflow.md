# Business Config Release Workflow

Wave: 4 | Source verified: `src/modules/governance/business-config/business-config.service.ts`, `src/modules/governance/business-config/business-config.types.ts`, `src/modules/governance/business-config/business-config.controller.ts`, `src/modules/governance/change-tickets/constants/change-ticket.constants.ts`, `src/modules/identity/governed-execution/governed-execution.listener.ts`
Last Updated: 2026-04-21

## Purpose

Manages the lifecycle of system-wide business configuration snapshots across 6 subject types, enforcing a staged-validate-approve-publish pipeline with mandatory Change Ticket governance before any configuration becomes live.

## Actors

| Actor | Role |
|---|---|
| System (automated) | Calls `stageRelease` and `validateRelease` (triggered by seed scripts / admin CLI) |
| ChangeTicketsService | Auto-creates a `BUSINESS_CONFIG_CHANGE` CT after successful validation |
| GovernedExecutionListener | Listens for CT consumed events; calls `publishReleaseFromGovernance` |
| ApprovalsService | Routes CT through approval flow (PENDING_APPROVAL → READY) |
| Admin UI | Read-only: lists releases, views diff, views revisions |

## Subject Types

| subjectType | businessKey field | Projected to |
|---|---|---|
| `COA` | `code` (account code) | `coa` table |
| `ACCT_EVENT` | `eventCode` | `acctEvent` table |
| `JOURNAL_TEMPLATE` | `header.templateCode` | `journalHeaderTemplate` + `journalLineTemplate` tables |
| `CLEARING_TEMPLATE` | `code` | `clearingTemplate` + `clearingLineTemplate` tables |
| `PRICING_POLICY` | `policyCode` | `pricingPolicy` table |
| `ASSET_CONFIG` | `assetNo` | `asset` table |

## Release Status Enum

Defined in `business-config.types.ts`:
- `DRAFT` — staged but not yet validated (or validation failed)
- `VALIDATED` — passed all subject-type-specific checks; CT auto-created
- `ACTIVE` — published and projected to live tables; supersedes prior ACTIVE
- `SUPERSEDED` — displaced by a newer ACTIVE release of the same subjectType

Revision statuses: `STAGED` (created during stage), `PUBLISHED` (after publishRelease succeeds).

## State Machine / Pipeline

| Stage | Status | Trigger | Next |
|---|---|---|---|
| 1. Stage | `DRAFT` | `stageRelease(subjectType)` called | `DRAFT` → `VALIDATED` (validate) |
| 2. Validate | `VALIDATED` or back to `DRAFT` | `validateRelease(releaseNo)` called | If ok → auto-creates CT; if fail → stays `DRAFT` |
| 3. CT Approval | (CT side) | CT moves PENDING_APPROVAL → READY via ApprovalCase | CT becomes READY |
| 4. Publish | `ACTIVE` | GovernedExecutionListener: CT consumed → `publishReleaseFromGovernance` | Prior ACTIVE → `SUPERSEDED` |

## Flow

1. **Stage** — `stageRelease(subjectType)`:
   - Normalizes `subjectType` string to one of the 6 canonical values.
   - Loads manifest entries from static manifests (COA, ACCT_EVENT, JOURNAL_TEMPLATE, CLEARING_TEMPLATE, ASSET_CONFIG) or dynamic build for PRICING_POLICY (queries active assets).
   - Computes SHA-256 content hash per item using stable-sorted JSON serialization.
   - Inside a DB transaction: creates `BusinessConfigRelease` with status=`DRAFT`; for each manifest entry, creates a new `BusinessConfigRevision` only if content hash changed (otherwise reuses latest revision); creates `BusinessConfigReleaseItem` linking release to revision.
   - Writes audit log: `BUSINESS_CONFIG_RELEASE_STAGED`, triggerType=`CONFIG_CHANGE`.
   - Returns the new release (with items).

2. **Validate** — `validateRelease(releaseNo)`:
   - Loads release items, parses payloads from stored JSON.
   - Runs subject-type-specific validation:
     - **COA**: no duplicate codes; name+type required.
     - **ACCT_EVENT**: reversal event codes exist within release; clearingTemplateCode is active in DB.
     - **JOURNAL_TEMPLATE**: header.templateCode + eventCode required; eventCode must be active in DB; all accountCodes must be active COA; DR/CR counts must balance per `amountSource|assetSource` bucket; at least 1 line.
     - **CLEARING_TEMPLATE**: code + clearingType + sourceType required; at least 1 line; no duplicate lineNos; each line has lineType, partyType, amountSource, assetSource.
     - **PRICING_POLICY**: must include both `SWAP` and `WITHDRAWAL` policy codes; each config asserted via `PricingCenterService`.
     - **ASSET_CONFIG**: assetNo, code, type, depositMinAmount, withdrawMinAmount required; type in {FIAT, CRYPTO}; status in {ACTIVE, DISABLED}; decimals non-negative integer; FIAT must have null minConfirmations; CRYPTO must have positive integer minConfirmations.
   - Updates release status: `VALIDATED` (ok=true) or back to `DRAFT` (ok=false).
   - Writes audit log: `BUSINESS_CONFIG_RELEASE_VALIDATED` or `BUSINESS_CONFIG_RELEASE_VALIDATION_FAILED`.
   - **If validation passes and no CT linked yet**: auto-calls `ChangeTicketsService.createBusinessConfigReleaseTicket()` and stores the CT id on the release. The CT is type `BUSINESS_CONFIG_CHANGE`.
   - Returns `BusinessConfigValidationSummary` `{ok, issues[], warnings[], validatedAt}`.

3. **CT Governance Gate** — (handled externally, not in BusinessConfigService):
   - The auto-created CT routes through the approval flow (PENDING_APPROVAL → approved → READY).
   - When the CT is consumed (DONE), `GovernedExecutionListener` fires `publishReleaseFromGovernance(releaseNo, ticketNo)`.

4. **Publish** — `publishRelease(releaseNo, changeTicketRef)`:
   - Guard: release must be `VALIDATED`; otherwise logs `BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED` and returns.
   - Guard: Change Ticket must exist and have status `READY`; if not, logs blocked audit and throws.
   - Guard: no active `RegulatoryGateItem` of type `LICENSE_SCOPE_CHANGE` with non-EFFECTIVE `effectivenessStatus` for this release; if found, logs blocked and throws.
   - Inside a DB transaction:
     - Projects items to live tables (upsert logic per subject type; items not in the release snapshot are deactivated/disabled in their respective live table).
     - Sets all prior `ACTIVE` releases of the same subjectType to `SUPERSEDED`.
     - Updates release to `ACTIVE`, stamps `publishedAt`, `publishedBy=SYSTEM`, `effectiveFrom`, links CT id and approvalCaseId.
     - Sets all included revisions to status `PUBLISHED`.
     - Writes audit log: `BUSINESS_CONFIG_RELEASE_PUBLISHED`.

## Key Rules

- Only one ACTIVE release per subjectType at a time; publishing supersedes the prior active.
- `stageRelease` is idempotent per content hash: no new revision is created if payload unchanged.
- `validateRelease` can be called multiple times; it is not idempotent on status (failed validation resets to DRAFT).
- CT is auto-created by the system at validation time if not already linked; operators cannot bypass CT requirement.
- Publish via `publishReleaseFromGovernance` skips the CT READY check (CT is already DONE by the time the event fires); direct `publishRelease` enforces READY status.
- A pending regulatory gate blocks publish even if CT is READY.
- Release numbering format: `{SUBJECT_TYPE}-REL-{NNN}` (e.g., `COA-REL-001`), globally monotonic within each subjectType.
- PRICING_POLICY manifest is dynamically built from active assets at stage time, not a static file.
- Journal template validation enforces double-entry balance at validate time (DR count == CR count per `amountSource|assetSource` bucket); runtime journals enforce balance by asset amount.

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/business-config/releases` | JWT + AdminPermissionGuard | List releases (filterable by subjectType, status; paginated) |
| `GET` | `/admin/business-config/releases/:releaseNo` | JWT + AdminPermissionGuard | Get release detail with items and regulatory gate summary |
| `GET` | `/admin/business-config/releases/:releaseNo/diff` | JWT + AdminPermissionGuard | Diff current release against `basedOnReleaseNo` (ADDED/CHANGED/REMOVED/UNCHANGED per businessKey) |
| `GET` | `/admin/business-config/revisions` | JWT + AdminPermissionGuard | List revisions for a specific subjectType+businessKey (history) |
| `GET` | `/admin/business-config/revisions/:id` | JWT + AdminPermissionGuard | Get single revision by id (full payload) |

Note: `stageRelease`, `validateRelease`, and `publishRelease` are **not** exposed as HTTP endpoints in the controller — they are called internally by scripts or the GovernedExecutionListener event handler.
