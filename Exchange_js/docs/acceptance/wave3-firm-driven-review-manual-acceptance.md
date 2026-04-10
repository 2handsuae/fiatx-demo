# Wave 3 Firm-Driven Customer Review — Manual Acceptance

This document walks a reviewer through the 6 demo acceptance scenarios using
the admin simulation controller. Requires `SUMSUB_MOCK_MODE=true` in `.env`.

## Prerequisites

1. Database migrated (Phase 1 complete)
2. Backend running with `SUMSUB_MOCK_MODE=true npm run start`
3. `npm run wave3:seed` executed (Phase 6 task)
4. At least one APPROVED customer in the database
5. Admin credentials for calling simulation endpoints

## Scenario 1: LOW→LOW Quarterly Reaffirm (Auto-Sign)

**Setup:**
- Customer with `riskTier = 'LOW'`, `onboardingStatus = 'APPROVED'`
- No pending ClientRiskAssessment

**Steps:**
1. As admin, trigger manual assessment:
   ```
   POST /admin/compliance/customers/{customerId}/risk-assessment/trigger
   { "reason": "scenario 1 test" }
   ```
2. Simulate GREEN AML result:
   ```
   POST /admin/sumsub/simulate/aml-check-result
   { "customerId": "...", "reviewAnswer": "GREEN", "rejectLabels": [] }
   ```

**Expected:**
- `client_risk_assessments` has a new row with `status = 'SIGNED'`, `signedBy = 'SYSTEM'`, `signoffMethod = 'AUTO_R2'`
- Customer unchanged

## Scenario 2: SANCTIONS Hit → FROZEN

**Setup:** APPROVED customer as above.

**Steps:**
1. Trigger assessment (same as Scenario 1 step 1)
2. Simulate RED SANCTIONS:
   ```
   POST /admin/sumsub/simulate/aml-check-result
   { "customerId": "...", "reviewAnswer": "RED", "rejectLabels": ["SANCTIONS_UN"] }
   ```

**Expected:**
- Customer `complianceHoldStatus = 'FROZEN'`, `complianceHoldReason = 'sanctions_hit_pending_investigation'`
- Assessment `status = 'ESCALATED_TO_SUMSUB'`, `resultingRiskTier = 'HIGH'`
- Customer's login → blocked from /deposit, /withdraw, /swap (AuthGuard redirects to /profile)
- Profile banner shows "Your account is frozen"

3. Simulate Sumsub case decision (false positive):
   ```
   POST /admin/sumsub/simulate/sumsub-case-decision
   { "assessmentId": "...", "decision": "APPROVE" }
   ```

**Expected:**
- Customer `complianceHoldStatus = 'CLEAR'`
- Banner disappears

## Scenario 3: PoA Expired → Customer Refreshes

**Setup:**
- Customer with `riskTier = 'LOW'` and a `PROOF_OF_ADDRESS` holding where `expiresAt < now + 25 days`
- (Directly edit the DB to set expiresAt to trigger the NOTIFIED stage)

**Steps:**
1. Trigger Layer 3 daily cron manually or wait for 02:00 UTC
2. Observe: `MaterialRefreshCycle` created with `stage = 'NUDGE_ONLY'`
3. Customer logs in, visits `/profile` → sees banner
4. Clicks "Refresh Proof of Address" → navigates to `/verification?cycleId=...`
5. Page shows QR code and mock actionId
6. Admin simulates applicant action:
   ```
   POST /admin/sumsub/simulate/applicant-action-result
   { "cycleId": "...", "reviewAnswer": "GREEN" }
   ```

**Expected:**
- Cycle `status = 'CLEARED'`
- Holding `verifiedAt` updated, `status = 'FRESH'`, `expiresAt` recomputed
- Banner disappears

## Scenario 4: Tier Upgrade LOW→MEDIUM → SoF Initial Collection

**Setup:**
- Customer with `riskTier = 'LOW'`, no `SOURCE_OF_FUNDS` holding
- Directly trigger a MEDIUM assessment signoff (or use Task 4.1 admin trigger with a simulated GREEN result then modify the assessment to resultingRiskTier='MEDIUM' and signoff via Wave 1 ApprovalCase)

**Steps (simplified):**
1. Trigger assessment, simulate GREEN
2. Admin updates the pending assessment to `resultingRiskTier = 'MEDIUM'`, `signoffMethod = 'MANUAL_COMPLIANCE_OFFICER'`, creates a RISK_RATING_MEDIUM_APPROVAL case
3. Compliance officer approves the case in admin UI
4. Observe `postSignoffCascade` triggers `recomputeHoldingsForCustomer(id, 'MEDIUM')`

**Expected:**
- Customer `riskTier = 'MEDIUM'`
- New `CustomerMaterialHolding` row for `SOURCE_OF_FUNDS` with `status = 'MISSING'`
- New `MaterialRefreshCycle` with `triggerType = 'INITIAL_COLLECTION'`, pointing at the new holding
- Profile banner for SoF appears

## Scenario 5: PEP Detected → Dual Sign

**Setup:** APPROVED customer.

**Steps:**
1. Trigger assessment (manual admin trigger)
2. Simulate PEP:
   ```
   POST /admin/sumsub/simulate/aml-check-result
   { "customerId": "...", "reviewAnswer": "RED", "rejectLabels": ["PEP_CLASS_1_DOMESTIC"] }
   ```

**Expected:**
- Customer `restrictionStatus = 'RESTRICTED'`, `pepStatus = 'CONFIRMED'`
- New `PEP_RELATIONSHIP_APPROVAL` case with 2 pending steps
- Profile banner "Compliance review in progress"

3. MLRO approves step 1 via admin UI
4. SENIOR_MANAGEMENT_OFFICER approves step 2

**Expected:**
- Case `status = 'APPROVED'`
- Assessment `status = 'SIGNED'`
- Customer `riskTier = 'HIGH'`, `restrictionStatus = 'CLEAR'`, Sumsub level moved to `wave3-level-2`
- Banner disappears

## Scenario 6: Grace Period Expired → Customer Offboard

**Setup:**
- Customer with an active refresh cycle
- Directly edit DB: `graceExpiresAt = now - 1 day`

**Steps:**
1. Trigger Layer 3 daily cron
2. Observe cycle terminated

**Expected:**
- Cycle `status = 'REJECTED'`, `rejectedAt` set
- Customer `onboardingStatus = 'WITHDRAWN'`, `operatingStatus = 'INACTIVE'`
- AuthGuard redirects customer to simplified pending page on next login

## Verification

After all 6 scenarios:
- Inspect `audit_log_events` for trace continuity
- Verify DB state matches expected for each scenario
- Check there are no stuck `PENDING_SUMSUB_RESULT` assessments
