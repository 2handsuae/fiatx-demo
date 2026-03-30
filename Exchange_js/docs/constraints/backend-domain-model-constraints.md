Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`
Source of Truth Level: constraints

# Backend Domain Model Constraints

## 1) Purpose
- This document defines the canonical backend subject taxonomy.
- It fixes which durable objects are first-class product subjects and which are subordinate or supporting persistence shapes.

## 2) Subject Classes
- Backend durable objects MUST be classified as one of:
1. `Business/Governance Root Subject`
2. `Config Root Subject`
3. `Subordinate Subject`
4. `Bridge Subject`
5. `Event Subject`
6. `Snapshot/Projection Subject`
7. `Read Model`

## 3) First-Class Subject Set
- V1 first-class business/governance subjects are limited to:
1. `User`
2. `CustomerMain`
3. `CddResponse`
4. `EddResponse`
5. `PeriodicReviewCycle`
6. `KytCase`
7. `TravelRuleCase`
8. `ComplianceAlert`
9. `ComplianceIncident`
10. `ComplianceIncidentExternalFiling`
11. `ApprovalCase`
12. `ChangeTicket`
13. `DeleteRequest`
14. `SlaTimer`
15. `AuditEvidencePackage`
16. `ComplianceCaseEvidencePackage`
17. `Asset`
18. `Wallet`
19. `Payin`
20. `InboundTransferSignal`
21. `DepositTransaction`
22. `SwapQuote`
23. `SwapTransaction`
24. `WithdrawPricingQuote`
25. `WithdrawTransaction`
26. `Payout`
27. `ReconciliationBreak`
28. `InternalTransaction`
29. `InternalFund`
30. `Outstanding`
31. `OutstandingSettlement`
32. `Journal`
33. `Clearing`
- V1 first-class config subjects are limited to:
1. `Role`
2. `Permission`
3. `LiquidityProvider`
4. `PricingPolicy`
5. `Coa`
6. `AcctEvent`
7. `JournalHeaderTemplate`
8. `ClearingTemplate`
9. `BusinessConfigRevision`
10. `BusinessConfigRelease`

## 4) Class-Specific Rules
- First-class subjects MUST define:
1. canonical identity contract
2. lifecycle owner
3. operator-facing read model
4. audit and repair boundary
- Subordinate subjects MUST exist under a parent subject or config bundle.
- Bridge subjects MUST express binding only; they MUST NOT become hidden workflow roots.
- Event subjects MUST record durable evidence or timeline facts; they MUST NOT silently become business truth owners.
- Snapshot/projection subjects MUST be rebuildable from their source of truth unless a document explicitly states otherwise.

## 5) Typical Supporting Objects
- Supporting objects include examples such as:
1. `ApprovalStep`
2. `ChangeTicketGateRun`
3. `SlaNotification`
4. `AdminUserInvitation`
5. `ComplianceIncidentReport`
6. `BusinessConfigReleaseItem`
7. `JournalLine`
8. `ClearingLine`
9. `WalletBalanceSnapshot`
10. `WalletBalanceEntry`
11. `RolePermission`
12. `UserRole`
- These objects MAY have their own specs when needed, but they MUST NOT be promoted to first-class product subjects without an explicit update to this constraint.

## 6) Invariants
- A new durable table MUST declare its subject class before it is considered delivery-complete.
- A first-class subject MUST NOT depend on a subordinate object for its primary identity.
- A supporting table MUST NOT become the only place where operator truth is documented.

## 7) Forbidden Patterns
- MUST NOT treat every durable table as equal in product semantics.
- MUST NOT create a new first-class subject without operator-key, lifecycle, audit, and repair policy.
- MUST NOT hide product-critical behavior inside bridge, event, or snapshot tables.

## 8) Change Protocol
- Any change to the first-class subject set MUST include:
1. subject name
2. class change reason
3. operator/read-model impact
4. lifecycle and audit impact
