Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-04
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`, `docs/cleanup/README.md`
Source of Truth Level: cleanup

# 2026-04 Wave 1 Foundation Reset Workspace

## Purpose
- This folder isolates the current `Wave 1 foundation reset` round from older wave cleanup history.
- Use it for this round's:
  - field reviews
  - simplification notes
  - cleanup staging notes
  - temporary decision records
- The goal is to keep new active cleanup work separate from archived wave closeout records under `docs/cleanup/`.

## What Belongs Here
- Documents created for the current bottom-up simplification round.
- Reviews that compare current schema, UI projection, and workflow shape.
- Cleanup notes that are still active discussion inputs and have not yet been promoted into:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`

## What Does Not Belong Here
- Long-term source-of-truth rules.
- Historical cleanup records from completed waves.
- Permanent workflow or entity semantics after they are accepted as durable truth.

## Filing Rule
- New documents for this round SHOULD be created in this folder first.
- If a conclusion becomes durable runtime truth, promote it to the appropriate permanent layer and leave this folder as working history only.
- Do not mix this round's active notes back into top-level `docs/cleanup/*.md` unless the file is explicitly a cross-wave summary or a closure record.

## Current Durable Alignment
- The governed five flows from this round are now reflected in durable workflow specs:
  - business pages create governance proposals
  - approval moves tickets / requests to `READY`
  - `consume` performs the formal write
  - `PlatformMembers` create-admin and role-change paths create change tickets instead of mutating runtime state directly
  - change-ticket, admin-member, and evidence-package deletion entry points create delete requests instead of deleting directly
- The invitation / activation follow-up for `Admin Member Provisioning` remains a child flow after `ChangeTicket.consume`; `consume` is the point that creates the `INACTIVE` user and the first invitation, resend stays in the child flow without requiring a new change ticket, the canonical display lives in `Platform Members -> Member Detail -> Invitation & Activation`, and no email delivery is part of this round.

## Current Documents
- `wave-1-subject-table-dictionary-and-minimal-model-review.md`
- `wave-1-core-table-field-necessity-review.md`
- `wave-1-no-first-missing-field-review.md`
- `wave-boundary-sla-governance-realignment.md`
- `change-delete-ticket-minimalization-design.md`
- `change-delete-ticket-minimalization-implementation-plan.md`
- `wave-1-governed-five-flows-design.md`
- `wave-1-governed-five-flows-implementation-plan.md`
- `wave-1-foundation-tightening-bcd-design.md`
- `wave-1-foundation-tightening-bcd-implementation-plan.md`
- `wave-1-foundation-tightening-bcd-acceptance-notes.md`
- `wave-1-audit-business-workflow-redesign-design.md`
- `wave-1-audit-business-workflow-redesign-implementation-plan.md`

## Naming Rule
- Keep filenames topic-first and stable.
- Prefer:
  - `wave-1-...`
  - `field-...`
  - `cleanup-...`
  - `review-...`
