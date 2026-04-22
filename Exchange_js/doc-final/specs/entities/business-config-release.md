# BusinessConfigRelease + BusinessConfigRevision
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/governance/business-config/business-config.service.ts, business-config.controller.ts, business-config.types.ts, dto/business-config.dto.ts
Last Updated: 2026-04-21

## Overview

Two cooperating models govern versioned configuration snapshots:

- **BusinessConfigRevision** — an immutable, content-hashed snapshot of one config item (identified by `subjectType + businessKey`)
- **BusinessConfigRelease** — an ordered collection of revisions for one `subjectType`, progressing through a governance lifecycle before being projected ("published") into live config tables
- **BusinessConfigReleaseItem** — join table linking a release to its revisions

---

## Prisma Model: BusinessConfigRevision
Table: `business_config_revisions`
Business Key: `subjectType + businessKey + revisionNo` (unique composite)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| subjectType | String | No | Config domain; see SubjectType enum |
| businessKey | String | No | Stable item identifier within the subject (e.g. COA code, templateCode, assetNo) |
| revisionNo | Int | No | Monotonically incremented per `subjectType+businessKey`; starts at 1 |
| payloadJson | String | No | JSON-serialized config payload (structure varies by subjectType) |
| contentHash | String | No | SHA-256 of stable-sorted payload JSON; used for dedup — no new revision if hash is unchanged |
| changeSummary | String | Yes | Auto-generated description of staging context |
| status | String | No | Default `STAGED`; see RevisionStatus enum |
| sourceCommitSha | String | Yes | Git commit SHA if available at stage time |
| createdAt | DateTime | No | Auto |
| updatedAt | DateTime | No | Auto |

### Relations
| Relation | Target |
|---|---|
| releaseItems | BusinessConfigReleaseItem[] |

---

## Prisma Model: BusinessConfigRelease
Table: `business_config_releases`
Business Key: `releaseNo` (unique, format: `{SUBJECT_TYPE}-REL-{NNN}`, e.g. `COA-REL-001`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| subjectType | String | No | Config domain; one release covers exactly one subjectType |
| releaseNo | String | No | Unique, human-readable business key |
| status | String | No | Default `DRAFT`; see ReleaseStatus enum |
| basedOnReleaseNo | String | Yes | The previously ACTIVE release this is diffed against |
| changeTicketId | String | Yes | FK to ChangeTicket; auto-created after validation passes |
| approvalCaseId | String | Yes | FK to ApprovalCase (populated from CT after approval) |
| traceId | String | Yes | UUID v4, set at staging time for audit correlation |
| effectiveFrom | DateTime | Yes | Set to `publishedAt` when release becomes ACTIVE |
| publishedAt | DateTime | Yes | Wall-clock publish timestamp |
| publishedBy | String | Yes | `SYSTEM` for governance-driven publish |
| validationSummaryJson | String | No | Default `{}`; JSON with `ok`, `issues[]`, `warnings[]`, `validatedAt` |
| createdAt | DateTime | No | Auto |
| updatedAt | DateTime | No | Auto |

### Relations
| Relation | Target |
|---|---|
| items | BusinessConfigReleaseItem[] (ordered by sortOrder) |
| regulatoryGateItems | RegulatoryGateItem[] |

---

## Prisma Model: BusinessConfigReleaseItem
Table: `business_config_release_items`
Business Key: `releaseId + businessKey` (unique composite)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| releaseId | String | No | FK → BusinessConfigRelease (CASCADE delete) |
| revisionId | String | No | FK → BusinessConfigRevision |
| subjectType | String | No | Denormalized from release |
| businessKey | String | No | Denormalized item key |
| sortOrder | Int | No | Default 0; used for deterministic ordering |
| createdAt | DateTime | No | Auto |

---

## Enum Values

### BusinessConfigSubjectType
| Value | Config Domain | businessKey Format |
|---|---|---|
| `COA` | Chart of Accounts | COA account code |
| `ACCT_EVENT` | Accounting event definitions | eventCode |
| `JOURNAL_TEMPLATE` | Double-entry journal templates | templateCode |
| `CLEARING_TEMPLATE` | Clearing line templates | clearing code |
| `PRICING_POLICY` | Swap/withdrawal pricing policies | policyCode |
| `ASSET_CONFIG` | Asset registry (type, network, limits, confirmations) | assetNo |

### BusinessConfigRevisionStatus
| Value | Meaning |
|---|---|
| `STAGED` | Created but not yet in an ACTIVE release |
| `PUBLISHED` | Included in a published (ACTIVE) release |

### BusinessConfigReleaseStatus
| Value | Meaning |
|---|---|
| `DRAFT` | Staged; validation not yet passed |
| `VALIDATED` | All items passed domain validation; CT auto-created |
| `ACTIVE` | Published and projected into live tables; one ACTIVE per subjectType |
| `SUPERSEDED` | Previously ACTIVE, replaced by a newer release |

---

## Payload Structure (by subjectType)

| subjectType | Key payload fields |
|---|---|
| `COA` | `code`, `type`, `name`, `status`, `requiredTags[]` |
| `ACCT_EVENT` | `eventCode`, `entityType`, `ownerScope`, `assetType`, `triggerType`, `postingMode`, `clearingMode`, `clearingTemplateCode`, `isActive` |
| `JOURNAL_TEMPLATE` | `header.{templateCode, eventCode}`, `lines[].{lineNo, accountCode, drCr, amountSource, assetSource, conditionExpr}` |
| `CLEARING_TEMPLATE` | `code`, `clearingType`, `sourceType`, `isEnabled`, `lineTemplates[].{lineNo, lineType, partyType, assetSource, amountSource}` |
| `PRICING_POLICY` | `policyCode`, `policyName`, `business`, `channelOnline`, `channelStoreSoon`, `config` (typed by policyCode) |
| `ASSET_CONFIG` | `assetNo`, `code`, `type`, `network`, `decimals`, `status`, `depositEnabled`, `withdrawEnabled`, `depositMinAmount`, `withdrawMinAmount`, `minConfirmations` |

---

## Key Business Rules
- Only one ACTIVE release is permitted per `subjectType`; publishing a new release automatically supersedes the previous ACTIVE
- Revisions are content-addressed: if `contentHash` of a manifest entry matches the latest existing revision, no new revision row is created
- Validation auto-gates DRAFT → VALIDATED; if validation fails the release stays DRAFT; issues are surfaced in `validationSummaryJson`
- A CT (`BUSINESS_CONFIG_CHANGE` type) is auto-created after successful validation and linked to the release via `changeTicketId`
- Publishing requires the linked CT to be in `READY` status (approved) and any `LICENSE_SCOPE_CHANGE` RegulatoryGateItem for the release to be `EFFECTIVE`
- Governance-driven publish path (`publishReleaseFromGovernance`) is triggered by the `GovernedExecutionListener` after the CT is consumed
- Publishing runs all domain projections in a single DB transaction — COA/AcctEvent/JournalTemplate/ClearingTemplate/PricingPolicy/Asset rows are upserted or soft-disabled
- JOURNAL_TEMPLATE validation enforces DR=CR balance per `amountSource+assetSource` bucket
- ASSET_CONFIG validation requires `minConfirmations = null` for FIAT and `>= 1` for CRYPTO
- All state transitions emit audit logs with `workflowType = BUSINESS_CONFIG_CHANGE`

---

## Service Methods
- `stageRelease(subjectInput)` — snapshots current manifest into a new DRAFT release; auto-increments releaseNo; idempotent on content hash
- `validateRelease(releaseNo)` — runs domain-specific validation; on success transitions to VALIDATED and auto-creates CT
- `publishRelease(releaseNo, changeTicketRef)` — validates CT is READY; runs projection transaction; transitions release to ACTIVE
- `publishReleaseFromGovernance(releaseNo, ticketNo)` — governance listener entry point; skips CT status check (CT already DONE by the time this fires)
- `listReleases(query)` — paginated list; filters: subjectType, status
- `getReleaseByNo(releaseNo)` — full release detail with items and regulatoryGateSummary
- `getReleaseDiff(releaseNo)` — computes ADDED/CHANGED/REMOVED/UNCHANGED per businessKey vs basedOnReleaseNo
- `listRevisions(query)` — list revision history for a single `subjectType+businessKey`
- `getRevisionById(id)` — fetch single revision with parsed payload

---

## API Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /admin/business-config/releases | Admin + CT-read permission | List releases (query: subjectType, status, skip, take) |
| GET | /admin/business-config/releases/:releaseNo | Admin + CT-read permission | Get release detail with items and regulatory gate |
| GET | /admin/business-config/releases/:releaseNo/diff | Admin + CT-read permission | Get diff vs base release |
| GET | /admin/business-config/revisions | Admin + CT-read permission | List revision history for a config item |
| GET | /admin/business-config/revisions/:id | Admin + CT-read permission | Get single revision detail |

> Stage, validate, and publish are triggered programmatically (via admin scripts / internal orchestration), not directly exposed as REST endpoints.
