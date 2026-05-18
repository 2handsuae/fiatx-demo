# Deposit Frontend V4 Alignment — Design Spec

## Goal

Update admin-web and client-web deposit pages to align with the V4 deposit state machine (9 statuses, 9 actions), comply with frontend design rules (`adm-*` / `fx-*` tokens, two-column layout, ActionSection), and place simulation controls at appropriate lifecycle points.

## Architecture Decision

**Approach B: Full Rule Compliance** — two-column layout for admin detail page, ActionSection for real operator actions, SimulationRail for dev simulation, V4 status enums everywhere, tipping-off-safe customer status mapping.

## Key Principle: Separation of Concerns

| Concern | Where | Who |
|---------|-------|-----|
| Compliance decisions (approve/reject/freeze) | Sumsub webhooks | Automated / compliance officer via Sumsub |
| Post-compliance legal decisions (release/confiscate frozen funds) | Admin DepositDetail ActionSection | Legal / senior ops |
| Operational actions (resume/expire pending reviews) | Admin DepositDetail ActionSection | Operations |
| Dev simulation of full lifecycle | Admin DepositDetail SimulationRail | Developer (sim mode only) |

---

## Section 1: V4 Status Enum — Single Source of Truth

### 9 Statuses

| Status | Terminal? | Description |
|--------|-----------|-------------|
| PAYIN_PENDING | No | Waiting for payin system confirmation |
| COMPLIANCE_PENDING | No | Under Sumsub compliance review |
| ACTION_PENDING | No | Flagged for additional review / info |
| FROZEN | No | Funds frozen pending legal decision |
| SUCCESS | Yes | Deposit completed, funds credited |
| REJECTED | Yes | Compliance rejection |
| FAILED | Yes | Technical / system failure |
| EXPIRED | Yes | Timed out |
| CONFISCATED | Yes | Funds seized by legal authority |

### 9 Actions

| Action | Trigger Source |
|--------|---------------|
| payin_confirmed | Payin system webhook |
| approve | Sumsub webhook / manual (FROZEN only) |
| reject | Sumsub webhook |
| freeze | Sumsub webhook |
| action_pending | Sumsub webhook |
| resume | Operator manual |
| confiscate | Legal / operator manual |
| expire | System cron / operator manual |
| fail | System error |

### State Transition Map

```
PAYIN_PENDING ──payin_confirmed──→ COMPLIANCE_PENDING
PAYIN_PENDING ──fail──────────────→ FAILED

COMPLIANCE_PENDING ──approve────────→ SUCCESS        (Sumsub)
COMPLIANCE_PENDING ──reject─────────→ REJECTED       (Sumsub)
COMPLIANCE_PENDING ──freeze─────────→ FROZEN         (Sumsub)
COMPLIANCE_PENDING ──action_pending─→ ACTION_PENDING (Sumsub)
COMPLIANCE_PENDING ──fail───────────→ FAILED

ACTION_PENDING ──approve──→ SUCCESS            (Sumsub / manual)
ACTION_PENDING ──reject───→ REJECTED           (Sumsub / manual)
ACTION_PENDING ──freeze───→ FROZEN             (Sumsub)
ACTION_PENDING ──resume───→ COMPLIANCE_PENDING (operator)
ACTION_PENDING ──expire───→ EXPIRED            (system / operator)

FROZEN ──approve────→ SUCCESS      (legal / operator)
FROZEN ──confiscate─→ CONFISCATED  (legal / operator)
```

---

## Section 2: Admin Deposit List Page

**File**: `admin-web/src/pages/DepositTransactionList.tsx`

### Changes

1. **Status badge color map** — replace stale UNDER_REVIEW, add all 9 V4 statuses:

| Status | Color Semantic | adm-* Token |
|--------|---------------|-------------|
| PAYIN_PENDING | blue | `adm-status-info` |
| COMPLIANCE_PENDING | purple | `adm-status-review` |
| ACTION_PENDING | amber | `adm-status-warning` |
| SUCCESS | green | `adm-status-success` |
| REJECTED | red | `adm-status-danger` |
| FAILED | orange | `adm-status-error` |
| EXPIRED | gray | `adm-status-neutral` |
| FROZEN | cyan | `adm-status-frozen` |
| CONFISCATED | dark red | `adm-status-critical` |

2. **Filter dropdown** — update to 9 V4 statuses, remove UNDER_REVIEW

3. **Shared utility** — update `transactionRootDisplay.ts` `formatStatusLabel()` with all 9 statuses

---

## Section 3: Admin Deposit Detail Page (Core Redesign)

**File**: `admin-web/src/pages/DepositTransactionDetail.tsx`

### Layout: Two-Column Structure

```
┌──────────────────────────────────────────┬────────────────┐
│ DetailPageHeader (back nav + depositNo)   │                │
├──────────────────────────────────────────┤   272px Sidebar │
│ [SimulationRail — sim mode only]          │                │
│                                          │ ┌────────────┐ │
│ Hero Zone                                │ │ ActionSect │ │
│  Status badge (large) + amount + asset   │ │ (workflow)  │ │
│  + crypto/fiat type                      │ └────────────┘ │
│                                          │ ┌────────────┐ │
│ Core Context                             │ │ Identity   │ │
│  ownerNo + compliance/onboarding status  │ │ Summary    │ │
│  Source wallet → target wallet           │ └────────────┘ │
│                                          │ ┌────────────┐ │
│ Process / Timeline                       │ │ Lifecycle  │ │
│  StatusTimeline (reuse existing)         │ │ Dates      │ │
│                                          │ └────────────┘ │
│ Technical Detail                         │                │
│  txHash, addresses, payinNo, traceId     │                │
└──────────────────────────────────────────┴────────────────┘
```

### Information Gradient (Main Body)

1. **Hero Zone**: depositNo, large status badge, amount + asset code, crypto/fiat type label
2. **Core Context**: ownerNo (via customer relation, **never UUID**), ownerType, complianceStatus, onboardingStatus, source/target wallet numbers (walletNo, not UUID)
3. **Process/Timeline**: Existing StatusTimeline component — renders `statusHistory` JSON. Update status labels/colors to V4.
4. **Technical Detail**: txHash, fromAddress, toAddress, fromIban, toIban, payinNo (clickable → PayinDetail), traceId, referenceNo

### Sidebar Components

**Order per admin rules: ACTIONS → IDENTITY SUMMARY → LIFECYCLE**

#### ActionSection (Real Operator Actions)

Only for states where manual operator decisions are needed:

| Current Status | Available Actions | Button Variant |
|---------------|-------------------|----------------|
| ACTION_PENDING | expire | workflowSecondary |
| FROZEN | approve (release), confiscate | workflowPrimary, workflowNegative |
| PAYIN_PENDING | — (no operator actions) | — |
| COMPLIANCE_PENDING | — (Sumsub-driven) | — |
| Terminal states | — | — |

- ACTION_PENDING is not for operator approve/reject — after customer uploads materials via Sumsub SDK, Sumsub re-evaluates and sends webhook with decision. Resume is also unnecessary (COMPLIANCE_PENDING is Sumsub-driven; returning to it creates a dead-end loop). Only expire (customer timeout) is a valid manual action.
- `confiscate` opens reason modal (same pattern as SwapTransactionDetail reject)
- Calls `PATCH /deposit-transactions/:id/status` with `{ action, reason? }`
- **Backend constraint**: Sumsub webhooks must NOT auto-transition FROZEN deposits. Frozen fund release/confiscation is a legal decision — only manual admin action is permitted. If Sumsub sends a webhook for a FROZEN deposit, log it but do not execute the transition.

#### Identity Summary

- ownerNo (clickable → customer detail)
- ownerType
- complianceStatus badge
- onboardingStatus badge

#### Lifecycle

- Created at
- Completed at (if terminal/frozen)
- Current status duration

### DetailPageHeader

- **No title/subtitle** (per admin rules for entity pages)
- Back navigation only
- depositNo displayed in hero zone, not header

### Route

- Keep `/exchange/deposit-transactions/:id` (ID routing is internal navigation, acceptable)

### Cross-References

- payinNo → clickable link to PayinDetail page
- toWalletNo, fromWalletNo → display as business keys

---

## Section 4: Client Deposit Page

**File**: `client-web/src/pages/Deposit.tsx`

### Tipping-Off Safe Status Mapping

**Anti-tipping-off principle**: Customer must NOT be informed that their transaction is under compliance review, frozen, or subject to a SAR. Internal statuses are mapped to a simplified 6-state customer view:

| Internal Status | Customer Sees | Color (fx-*) | Rationale |
|----------------|---------------|--------------|-----------|
| PAYIN_PENDING | Processing | blue | Normal — waiting for payment |
| COMPLIANCE_PENDING | Processing | blue | **Masked** — cannot reveal compliance review |
| ACTION_PENDING | Processing | blue | **Masked** — cannot reveal flagged status |
| FROZEN | Processing | blue | **Masked** — cannot reveal funds frozen |
| SUCCESS | Completed | green | Normal |
| REJECTED | Declined | red | Generic reason only, never reveal AML/sanctions |
| FAILED | Failed | orange | Technical failure |
| EXPIRED | Expired | gray | Timeout |
| CONFISCATED | Contact Support | red | **Masked** — legal notification via offline channels |

**Customer sees only 6 distinct states**: Processing, Completed, Declined, Failed, Expired, Contact Support.

### Changes

1. Update status badge map (remove UNDER_REVIEW, HELD; add V4 mapping above)
2. Use customer-meaningful language per `doc-final/rules/frontend-client.md`
3. Simulation: keep existing "Simulate Deposit" flow unchanged (create inbound signal + scan)

---

## Section 5: SimulationRail for Deposit Detail

**Component**: Reuse existing `admin-web/src/components/SimulationRail.tsx`

### When Visible

Only when `simulationModeEnabled` is true (localStorage `admin_simulation_mode`).

### Rail Design

Dynamic rail items based on current status. Shows the deposit's position in the lifecycle and available transitions as clickable steps.

**Rail items are built per-status** (not a static list), because the deposit state machine has branches:

- Each rail item: `{ label, status: 'completed' | 'current' | 'available' | 'readonly', tone?, onClick? }`
- `available` items are clickable — trigger the corresponding status transition via `PATCH /deposit-transactions/:id/status`
- Past states shown as `completed`, current as `current`

### Example: When status is COMPLIANCE_PENDING

```
[PAYIN_PENDING ✓] → [COMPLIANCE_PENDING •] → [approve] [reject] [freeze] [action_pending] [fail]
  completed           current                  available  available available  available      available
```

### Differences from ActionSection

| | ActionSection | SimulationRail |
|--|--------------|----------------|
| Visibility | Always (when actions exist) | Simulation mode only |
| Actions | Real operator decisions only | All valid transitions |
| Purpose | Production workflow | Dev testing |
| Location | Sidebar | Top of main body |

---

## Section 6: Simulation Controls — Full Lifecycle Map

| Step | Location | How to Trigger | Status Effect |
|------|----------|---------------|---------------|
| 1. Create payin | Client-web "Simulate Deposit" button | Creates inbound transfer signal + scan | Creates payin + deposit (PAYIN_PENDING) |
| 2. Advance payin | Admin PayinDetail SimulationRail | Click CONFIRMED/CLEARED steps | PAYIN_PENDING → COMPLIANCE_PENDING |
| 3. Sumsub decision | Admin Sumsub simulation menu (`/sumsub/simulate/*`) | Select scenario (approve/reject/flag) | COMPLIANCE_PENDING → SUCCESS/REJECTED/FROZEN/ACTION_PENDING |
| 4. Deposit transitions (dev) | Admin DepositDetail SimulationRail | Click available transition | Any valid transition |
| 5. Frozen fund disposition | Admin DepositDetail ActionSection | Click approve/confiscate | FROZEN → SUCCESS/CONFISCATED |
| 6. TB accounting | Automatic | DepositWorkflowService event handlers | No manual step |

---

## Section 7: Files Changed

| File | Action | Scope |
|------|--------|-------|
| `admin-web/src/pages/DepositTransactionList.tsx` | Modify | V4 status badges, filter dropdown, adm-* tokens |
| `admin-web/src/pages/DepositTransactionDetail.tsx` | Rewrite | Two-column layout, ActionSection, SimulationRail, V4 data |
| `admin-web/src/utils/transactionRootDisplay.ts` | Modify | Add V4 status labels |
| `client-web/src/pages/Deposit.tsx` | Modify | Tipping-off-safe status mapping, remove stale statuses |

No new files created — all changes are modifications to existing files, reusing existing components (SimulationRail, ActionSection pattern from SwapTransactionDetail).
