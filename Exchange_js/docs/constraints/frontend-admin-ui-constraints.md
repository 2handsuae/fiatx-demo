Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js/admin-web`
Supersedes: `docs/constraints/frontend-ui-constraints.md`
Depends On: `docs/constraints/frontend-platform-constraints.md`, `docs/constraints/governance-approval-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/governance-sla-timer-constraints.md`
Source of Truth Level: constraints

# Frontend Admin UI Constraints

## 1) Purpose
- This document defines the long-term admin UI language for `admin-web`.
- The admin app should feel orderly, efficient, and trustworthy.
- The target aesthetic is `light-first`, restrained, and structure-led.

## 2) Visual Principles
- Admin UI MUST feel like an operator console, not a marketing site.
- Default mood is:
1. calm
2. clear
3. dense but breathable
4. low-decoration
5. motion-light
- Visual hierarchy MUST come from spacing, grouping, typography, and alignment before color or effects.
- Decorative gradients, glow, and glass effects MUST remain minimal in admin surfaces.

## 3) Information Architecture
- Admin pages SHOULD organize information in this order when applicable:
1. header/title area
2. filter/search area
3. primary table or summary area
4. pagination area
5. detail cards
6. action surface
7. audit, raw JSON, or evidence side information
- Business truth MUST stay in the primary zone.
- Technical metadata and raw payloads MUST stay in secondary zones.

## 4) List Page Rules
- List pages MUST prioritize operator scanning speed.
- `No` or canonical operator key SHOULD appear in the first meaningful identification column.
- Filter bar, refresh control, results table, and pagination SHOULD follow one consistent structure.
- Loading rows, empty state rows, and error banners MUST be visually consistent across list pages.
- Primary row action placement MUST remain stable:
1. `View` or `Open` in the operation column
2. row identifier itself MAY also be clickable

## 5) Detail Page Rules
- Admin detail pages SHOULD converge on:
1. `Header`
2. `DetailCard`
3. `ActionSection`
4. timeline, event, audit, or `JsonBlock` secondary surfaces
- Primary detail cards MUST show business truth first:
1. operator key
2. lifecycle status
3. related subject keys
4. operator-relevant timestamps
5. linked workflow/action anchors
- Raw JSON, payload snapshots, or technical evidence MUST NOT appear above the primary detail summary.
- `id` MAY appear only in the technical section or low-priority detail fields.

## 6) Create and Edit Page Rules
- Forms MUST be grouped by business meaning rather than raw schema order.
- Required fields MUST be visibly marked.
- Validation errors MUST appear near the field and also in a visible summary zone when helpful.
- Footer actions MUST remain stable:
1. `Cancel` as secondary action
2. primary submit action on the right or strongest visual position
- High-risk context or irreversible consequences MUST be visible before submission.

## 7) High-Risk Action Rules
- These actions MUST live in explicit action surfaces, not hidden ad hoc controls:
1. `approve`
2. `reject`
3. `execute`
4. `close`
5. status changes
6. `export`
7. invitation resend
- Destructive or governance-impacting actions MUST require explicit confirmation.
- In-flight requests MUST disable duplicate submission.
- Action surfaces MUST explain the current guard, blocker, or required role when action is unavailable.

## 8) Shared Admin Component Rule
- Admin UI SHOULD converge on the existing shared skeleton direction:
1. `DetailPageHeader`
2. `DetailCard`
3. `InfoField`
4. `JsonBlock`
5. `ActionSection`
6. `Pagination`
- New pages MUST NOT introduce page-local duplicates of these primitives without a documented reason.
- Existing repeated in-page implementations are cleanup debt and SHOULD be retired in follow-up cleanup work.

## 9) Copy and Labeling
- Admin active UI is `English-first`.
- Chinese comments or temporary notes MAY remain as implementation annotations, but MUST NOT expand into default active UI copy.
- Field labels SHOULD prefer canonical business names:
1. `Approval No` over raw internal ids
2. `Target No` over raw database references
3. `Trace ID` only where it provides operator value

## 10) Current Runtime Debt That This Document Freezes
- Current runtime already shows the correct direction for shared admin detail skeletons, but repeated implementations remain across pages.
- Current runtime already has `adminFetch` as the correct request-helper direction.
- Follow-up cleanup SHOULD:
1. elevate `adminFetch` usage from common practice to full runtime convergence
2. retire repeated page-local detail primitives
3. keep `No-first` operator display consistent across every admin page

## 11) Forbidden Patterns
- MUST NOT turn admin pages into decorative showcase layouts.
- MUST NOT place raw ids before business identifiers on operator-facing pages.
- MUST NOT place raw payload blocks above primary business detail.
- MUST NOT let each page invent a different table, pagination, or action-zone grammar.
- MUST NOT re-expand Chinese active copy as the default admin UI language.

## 12) Change Protocol
- Any durable change to admin UI rules MUST include:
1. impacted page type
2. impacted operator workflow
3. component convergence or divergence note
4. cleanup note when it intentionally leaves old page-local patterns behind
