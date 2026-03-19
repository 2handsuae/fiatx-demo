# Onboarding Compliance Center Wave 3 Acceptance Checklist

## Purpose

This checklist is the formal manual acceptance script for the onboarding workflow paths that depend on Compliance Center.

It verifies:

- `Risk Decision -> Alert Orchestration`
- `Alert / Case -> Disposition`
- `Disposition -> Workflow Transition`
- `Case Report / Freeze / Report` side effects that must **not** incorrectly advance onboarding workflow

## Fixed Scope

- `workflow = ONBOARDING`
- review stages:
  - `REVIEW_CDD`
  - `REVIEW_EDD`
- workflow-level final state:
  - `FINAL_APPROVAL`
- out of scope:
  - approval integration
  - external `STR / SAR`
  - transaction/generic compliance runtime

## Route Naming Note

- response-named routes are canonical for onboarding / periodic review provider-response containers
- case-named response routes have been retired from runtime
- operator-facing navigation should use `CDD Responses / EDD Responses`

## Chain 1: `LOW_RISK CDD`

1. Start onboarding for a fresh customer and complete mock CDD with `LOW_RISK`.
2. Open `Risk Management -> Risk Policy Executions`.
3. Find the latest decision record.
4. Verify:
   - `workflow = ONBOARDING`
   - `stage = REVIEW_CDD`
   - orchestration exists
   - `alertUpserted = false`
   - no onboarding review alert is created
5. Open customer onboarding snapshot.
6. Verify:
   - `onboardingStatus = APPROVED`
   - `operatingStatus = ACTIVE`
   - no active compliance alert/case is shown

## Chain 2: `REVIEW_CDD -> REQUIRE_EDD`

1. Complete mock CDD with a review profile such as `MEDIUM_RISK`.
2. Open `Compliance Center -> Alerts`.
3. Verify a `REVIEW_CDD` onboarding alert exists with:
   - `workflow = ONBOARDING`
   - `stage = REVIEW_CDD`
   - `rule = ONB_CDD_REVIEW_REQUIRED`
4. Assign the alert to the current admin.
5. Execute onboarding decision `REQUIRE_EDD`.
6. Verify:
   - the alert writes final disposition `REQUIRE_EDD`
   - the customer moves to `PENDING_EDD_INPUT`
   - an `eddResponse` is created or reused
   - decision record detail shows `workflowTransition.transitionCode = CDD_REQUIRE_EDD_TO_PENDING_EDD`

## Chain 3: `REVIEW_EDD -> APPROVE_STAGE`

1. Complete the created EDD session with a review profile that should be approvable.
2. Open `Compliance Center -> Alerts`.
3. Verify a `REVIEW_EDD` alert exists with:
   - `workflow = ONBOARDING`
   - `stage = REVIEW_EDD`
   - `rule = ONB_EDD_REVIEW_REQUIRED`
4. Assign the alert or escalate to a case and decide `APPROVE`.
5. Verify:
   - the producer writes disposition `APPROVE_STAGE`
   - the customer moves to `FINAL_APPROVAL`
   - decision record detail shows `workflowTransition.transitionCode = EDD_APPROVE_TO_FINAL_APPROVAL`
   - `FINAL_APPROVAL` does not appear as an alert/case stage

## Chain 4: `REVIEW_EDD -> REJECT_STAGE`

1. Complete EDD with a rejectable profile or use the same `REVIEW_EDD` chain on a fresh customer.
2. Assign the alert or case and decide `REJECT`.
3. Verify:
   - the producer writes disposition `REJECT_STAGE`
   - the customer moves to `REJECTED`
   - decision record detail shows `workflowTransition.transitionCode = EDD_REJECT_TO_REJECTED`

## Chain 5: Compliance Actions Must Not Advance Workflow

1. Escalate a `REVIEW_CDD` or `REVIEW_EDD` alert to case.
2. Verify:
   - alert disposition becomes `ESCALATE_TO_CASE`
   - onboarding workflow does not advance because of the escalation itself
3. In case detail, finalize a case report and execute:
   - `FREEZE`
   - `REPORT`
4. Verify:
   - case disposition changes as expected (`RESTRICT`, `REPORT`)
   - customer onboarding canonical status does not change because of these actions
   - if a decision record is linked, `workflowTransition.transitionCode = NO_TRANSITION`

## Decision Record Verification

For every accepted chain above, open `Risk Policy Executions` detail and verify both sections exist:

- `Orchestration`
- `Workflow Transition`

The two sections must tell a coherent story:

- orchestration explains whether an alert was created
- workflow transition explains whether customer workflow moved

## Pass Criteria

- low-risk CDD does not create onboarding review alerts
- CDD review decisions move workflow exactly once and to the expected next status
- EDD review decisions move workflow exactly once and to the expected next status
- compliance actions such as escalate/freeze/report do not accidentally mutate onboarding workflow
- admin can replay both orchestration and workflow transition from decision record detail
- manual verification MUST use canonical customer status as the truth source; `getNextStep` is action guidance only and no longer carries `publicStatus`
