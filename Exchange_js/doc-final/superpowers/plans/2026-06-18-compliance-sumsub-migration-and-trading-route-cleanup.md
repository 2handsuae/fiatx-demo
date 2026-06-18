# Compliance (Sumsub migration) + Trading dead-code + Legacy route-tree Cleanup — Plan

> **For agentic workers:** execute phase-by-phase; each phase ends with a build/jest/grep GATE that must pass before the next. Steps use `- [ ]`.

**Goal:** Delete the OLD manual compliance layer (now fully replaced by Sumsub webhooks), remove trading V2/demo dead code, and tear down the legacy `/dashboard`+`/exchange` admin route tree — without breaking the live Sumsub-fed canonical pipeline.

**Verified boundary (audits 2026-06-18, spot-checked):**
- KEEP (Sumsub canonical): `sumsub-ingestion`, `CustomerMain` 3-axis status + `customer-status.util`, `ApprovalCase`/approvals, `client-risk-assessment` (monthly AML cron), `material-refresh` (daily doc cron), `tier-upgrade-case`, deposit/withdraw KYT+TR **column** gate (Sumsub writes the columns).
- DELETE (old manual): onboarding CDD/EDD methods + models, `risk-engine` decision-records + engine, `transaction-compliance` (+ `transaction-risk-bridge`), `periodic-review` (retired per product decision — recurring review now = Sumsub ongoing-monitoring + CRA + material-refresh).
- Decisive facts: `sumsub-ingestion` has ZERO refs to risk-engine/decision-records/cdd/edd; every `riskEngineService` caller is in `transaction-risk-bridge` / `periodic-review` / `onboarding` legacy CDD-EDD methods; tx-compliance callbacks have no external poster (non-Sumsub signature).

**Tech stack:** NestJS + Prisma(SQLite) backend; React/Vite admin-web(3501) + client-web(3502); jest; branch ports.

---

## Phase A — Trading pure dead code (isolated, lowest risk)

**Files:**
- Delete: `src/modules/asset-treasury/demo/` (dir + `wave8-treasury-demo.util.ts` + `.spec.ts`), `scripts/wave8-treasury-demo-seed.ts`; remove `wave8:treasury:demo:seed` from `package.json`.
- Modify: `src/orchestrators/withdraw-workflow.orchestrator.ts` — remove dead `transactionComplianceService` injection (:90) + its `workflows.module.ts` import IF no other consumer; `onPayoutConfirmed` (:126); `collectJournalIds` (:913); `createAccountingContext` (:923); dead `isCustomer` locals (:183/:352/:805).
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` — remove dead `triggerComplianceGateBlockedAlert` (:164) + the no-op `assertComplianceGate` (:174) and its call site (:792).

**GATE A:** `npx tsc -p tsconfig.build.json --noEmit` EXIT 0 + `npx jest src/modules/trading/withdraw-transactions src/orchestrators` green.

---

## Phase B — Compliance frontend + routes + RBAC (no backend dep)

**Delete admin pages** (`admin-web/src/pages/`): `CddResponsesPage`, `EddResponsesPage`, `RiskPolicyExecutionsPage`, `TransactionComplianceCasesPage`, `TransactionComplianceCaseDetailPage`, `TransactionKytCasesPage`(+Detail), `TransactionTravelRuleCasesPage`(+Detail).
**Modify** `admin-web/src/App.tsx`: remove their lazy imports + routes (compliance/cdd-responses, edd-responses, risk/policy-executions, tx-kyt/tx-travel/tx-evidence + detail).
**Modify** `client-web/src/pages/Verification.tsx`: remove legacy CDD/EDD functions (loadResponses, bootstrapCdd, reinitiateCdd, reinitiateEdd, startEdd, createSession, mockCompleteEdd, handleMockComplete) + their UI branches; KEEP sumsub funcs (startOnboardingVerification, mockSubmitVerification, loadOnboarding, loadNextStep).
**Modify** `admin-web/src/rbac/permissions.ts`: remove `CDD_RESPONSES_READ`, `EDD_RESPONSES_READ`, `RISK_DECISION_RECORDS_READ`, `TX_COMPLIANCE_*` codes.
**Modify** `src/modules/identity/access-control/rbac.catalog.ts`: remove decision-records routes + cdd/edd + tx-compliance routes; **KEEP groups** `RISK_DECISION_RECORD_READ/WRITE` (still guard sumsub-events + risk-assessments) — only remove the dead route entries + spec assertions.

**GATE B:** admin-web `npx tsc -b` EXIT 0 + client-web `npx tsc -b` EXIT 0 + `npx jest rbac.catalog` green.

---

## Phase C — Cut the 2 live read-tethers (blockers for prisma drop)

- `src/modules/identity/onboarding/onboarding-final-approval.service.ts:294-302/378-386` — remove the `client.eddResponse.findFirst` snapshot read (set `currentEddResponseId` to null / drop the field write).
- `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:424` — remove the `getTransactionCaseAggregate` display read in `findOne` + the `preKytCase`/`kytCase`/`travelRuleCase` response fields (:461-467) + the `normalizeKyt/TravelRuleLifecycleStatus` helper usage.

**GATE C:** backend tsc EXIT 0.

---

## Phase D — Compliance backend (services/controllers/modules)

- `src/modules/risk-engine/transaction-compliance/` — delete entire dir; remove `TransactionComplianceModule` from app.module + `workflows.module.ts` + `withdraw-transactions.module.ts`.
- `src/modules/identity/periodic-review/` — delete entire dir; remove from `onboarding.module.ts`.
- `src/modules/risk-engine/` — delete `risk-decision-records.service.ts`, `risk-decision-records-admin.controller.ts`, `dto/risk-decision-record.dto.ts`, then `risk-engine.service.ts`; remove `RiskEngineModule` from app.module after confirming zero remaining `RiskEngineService` injections.
- `src/modules/identity/onboarding/onboarding.service.ts` + `onboarding-workflow-transition.service.ts` — remove legacy CDD/EDD methods (findLatest*, completeManualCdd/EddDecision, createEddResponseIfNeeded, handleCdd/EddDecision, all session methods, list/detail methods).
- `onboarding-customer.controller.ts` (remove `[Legacy]` CDD/EDD endpoints, keep me/next-step/verification/*) + `onboarding-admin.controller.ts` (remove cdd-responses/edd-responses/decision-records endpoints).

**GATE D:** backend tsc EXIT 0 + `npx jest src/modules/identity/onboarding src/modules/identity/periodic-review` (removed suites gone) + full `npx jest` green.

---

## Phase E — Constants + audit

- `src/modules/audit-logging/constants/audit-actions.constant.ts` — remove `AuditModules.RISK_DECISION_RECORDS`, `AuditEntityTypes.RISK_DECISION_RECORD/KYT_CASE/TRAVEL_RULE_CASE`, CDD/EDD/session/workflow AuditActions, `RISK_DECISION_MANUAL_SIMULATED`, `KYT_CASE_*`/`TRAVEL_RULE_UPDATED`. KEEP `APPROVAL_CASE`, `FINAL_APPROVAL_*`, deposit/withdraw tx KYT/TR flow actions.
- `src/modules/risk-engine/constants/onboarding-compliance-workflow.constant.ts` — prune CDD/EDD/alert/case exports; KEEP `ONBOARDING_WORKFLOW`/`PERIODIC_REVIEW_WORKFLOW`(if still referenced)/`buildComplianceWorkflowTraceContext`. Delete `compliance-disposition.constant.ts` + `risk-recommended-actions.constant.ts` if only risk-engine used them.

**GATE E:** backend tsc EXIT 0 + full jest green.

---

## Phase F — Prisma models + migration (LAST for compliance)

Drop (relation order): `CddResponseReport`, `EddResponseReport` → `EddResponse` → `CddResponse` → `WorkflowDecisionRecord` → `ComplianceSession` → `PeriodicReviewCycle` → `KytCase`/`KytCaseReport`, `TravelRuleCase`/`TravelRuleCaseReport`. Remove `CustomerMain` back-relations (cddResponses, eddResponses, workflowDecisionRecords, complianceSessions, cddResponseReports, eddResponseReports) + null `latestDecisionRecordId`. Generate migration via `prisma migrate diff --from-migrations ... --to-schema-datamodel --script`; `prisma validate`; `prisma generate`.

**GATE F:** `prisma validate` valid + backend tsc EXIT 0 + no-drift confirmed.

---

## Phase G — Legacy route tree (`/dashboard` + `/exchange`) + internal-transaction-workflow

- Repoint ~5 live deep-links `/exchange/internal-transactions/:id` → `/admin/funds/transfers/:internalTxNo`: `SwapTransactionDetail.tsx:287`, `DepositTransactionDetail.tsx:316`, `WithdrawTransactionDetail.tsx:345`, `CustodianWalletDetail.tsx:231`, `TransferEvidenceDetail.tsx:88`.
- Delete admin pages `InternalTransactionList.tsx` + `InternalTransactionDetail.tsx`; remove `/exchange` route block + the dead `/dashboard/*` alias routes from `App.tsx`.
- Backend: delete `src/modules/asset-treasury/internal-transaction-workflow/`; remove `InternalTransactionWorkflowModule` from app.module (verify it doesn't orphan internal-transactions/internal-funds — they have other live callers).

**GATE G:** admin-web tsc EXIT 0 + backend tsc EXIT 0 + jest green.

---

## Phase H — Final verification

Full backend `tsc` + `jest`, admin-web + client-web `tsc -b`, zero-residual grep for removed symbols (cdd/edd/WorkflowDecisionRecord/KytCase/TravelRuleCase/transaction-compliance/risk-decision/internal-transaction-workflow/wave8-treasury-demo) in `src admin-web/src client-web/src scripts` (excl. migrations/docs). Render `/admin` to confirm menu unchanged.

**Memory:** update `wave_ownership_approvals_vs_compliance` (risk-engine no longer "live keep" — deleted as old layer under Sumsub) + `admin-legacy-pages-to-clean` (compliance cluster done).
