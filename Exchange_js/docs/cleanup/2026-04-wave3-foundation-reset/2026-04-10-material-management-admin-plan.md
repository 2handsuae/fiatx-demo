# Material Management Admin Pages + Policy Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin Material Management pages (list + detail with simulation) + update material policy from tier-based to level-based + add LIVENESS material + Customer Detail tier assignment buttons.

**Architecture:** Extend the existing admin-web with 2 new pages following existing patterns (lazy routes in App.tsx, `adminFetch` for API calls, `AdminBadge` for status chips). Backend adds a new admin controller for material management CRUD + simulation. Policy JSON and pure functions updated to use `requiredForLevels` instead of `requiredForTiers`.

**Tech Stack:** NestJS (backend), React 19 + Vite (admin-web), existing admin-web component library (`AdminBadge`, `DetailPageHeader`, `adminButtonClass`, `adminFetch`)

---

## File Map

### Existing files to modify

- `Exchange_js/config/material-refresh-policy.json` — change `requiredForTiers` → `requiredForLevels`, add LIVENESS, remove PASSPORT (alt of EID)
- `Exchange_js/src/modules/identity/material-refresh/policy/material-refresh-policy.ts` — update `MaterialConfig` interface: `requiredForTiers` → `requiredForLevels`
- `Exchange_js/src/modules/identity/material-refresh/policy/get-required-materials.ts` — rename function + use `requiredForLevels`
- `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.ts` — update `recomputeHoldingsForCustomer` to take levelName instead of tier
- `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts` — update `postSignoffCascade` call to pass levelName
- `Exchange_js/admin-web/src/App.tsx` — add 2 new lazy routes for Material Management
- `Exchange_js/admin-web/src/pages/CustomerDetail.tsx` — add material summary section + Quick Tier Assignment buttons

### New files to create

- `Exchange_js/src/modules/identity/material-refresh/admin-material-management.controller.ts` — admin API for holdings list, detail, simulate-stage
- `Exchange_js/admin-web/src/pages/MaterialManagementPage.tsx` — list page
- `Exchange_js/admin-web/src/pages/MaterialHoldingDetailPage.tsx` — detail page with simulation panel

---

## Task 1: Policy JSON update + LIVENESS + function renames

**Files:**
- Modify: `Exchange_js/config/material-refresh-policy.json`
- Modify: `Exchange_js/src/modules/identity/material-refresh/policy/material-refresh-policy.ts`
- Modify: `Exchange_js/src/modules/identity/material-refresh/policy/get-required-materials.ts`
- Modify: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.ts`
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`

- [ ] **Step 1: Update `material-refresh-policy.json`**

Replace entire content with:

```json
{
  "version": "1.1.0",
  "effectiveFrom": "2026-04-10",
  "stages": [
    { "daysFromExpiry": -30, "action": "CREATE_CYCLE_NUDGE_ONLY" },
    { "daysFromExpiry": -7, "action": "ESCALATE_URGENT" },
    { "daysFromExpiry": 0, "action": "ENFORCE_RESTRICTION" },
    { "daysFromExpiry": 30, "action": "TERMINATE_CYCLE_OFFBOARD" }
  ],
  "materials": {
    "EMIRATES_ID": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForLevels": ["wave3-level-1", "wave3-level-2"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true
    },
    "LIVENESS": {
      "managementMode": "SELF_MANAGED",
      "requiredForLevels": ["wave3-level-1", "wave3-level-2"],
      "sumsubActionLevelName": "wave3-action-liveness-refresh",
      "windowDays": { "LOW": 730, "MEDIUM": 365, "HIGH": 180 },
      "enforceRestriction": true
    },
    "PROOF_OF_ADDRESS": {
      "managementMode": "SELF_MANAGED",
      "requiredForLevels": ["wave3-level-1", "wave3-level-2"],
      "sumsubActionLevelName": "wave3-action-poa-refresh",
      "windowDays": { "LOW": 365, "MEDIUM": 270, "HIGH": 180 },
      "enforceRestriction": true
    },
    "SOURCE_OF_FUNDS": {
      "managementMode": "SELF_MANAGED",
      "requiredForLevels": ["wave3-level-2"],
      "sumsubActionLevelName": "wave3-action-sof-refresh",
      "windowDays": { "MEDIUM": 540, "HIGH": 365 },
      "enforceRestriction": true
    },
    "SOURCE_OF_WEALTH": {
      "managementMode": "SELF_MANAGED",
      "requiredForLevels": ["wave3-level-2"],
      "sumsubActionLevelName": "wave3-action-sow-refresh",
      "windowDays": { "HIGH": 730 },
      "enforceRestriction": true
    }
  }
}
```

Key changes:
- Version bumped to `1.1.0`
- All `requiredForTiers` → `requiredForLevels` with actual Sumsub level names
- PASSPORT removed (alt of EID — simplify, demo only needs EID)
- LIVENESS added as SELF_MANAGED with 730/365/180 day windows
- `initialCollectionWindowDays` removed for simplicity (use default 14 days hardcoded in service)

- [ ] **Step 2: Update `MaterialConfig` interface in `material-refresh-policy.ts`**

Change `requiredForTiers: string[]` → `requiredForLevels: string[]` in the interface.

- [ ] **Step 3: Rename `getRequiredMaterialsForTier` → `getRequiredMaterialsForLevel`**

In `get-required-materials.ts`:
- Rename function to `getRequiredMaterialsForLevel`
- Change parameter name from `tier` to `levelName`
- Change filter from `config.requiredForTiers.includes(tier)` to `config.requiredForLevels.includes(levelName)`

- [ ] **Step 4: Update `material-refresh.service.ts` `recomputeHoldingsForCustomer`**

Change method signature:
```typescript
// BEFORE:
async recomputeHoldingsForCustomer(customerId: string, newRiskTier: string)
// AFTER:
async recomputeHoldingsForCustomer(customerId: string, levelName: string)
```

Update the internal call:
```typescript
// BEFORE:
const required = getRequiredMaterialsForTier(newRiskTier, policy);
// AFTER:
const required = getRequiredMaterialsForLevel(levelName, policy);
```

Also update the import:
```typescript
// BEFORE:
import { getRequiredMaterialsForTier } from './policy/get-required-materials';
// AFTER:
import { getRequiredMaterialsForLevel } from './policy/get-required-materials';
```

- [ ] **Step 5: Update `client-risk-assessment.service.ts` `postSignoffCascade`**

Find the call to `recomputeHoldingsForCustomer` in `postSignoffCascade` (around line 396):
```typescript
// BEFORE:
await this.materialRefreshService.recomputeHoldingsForCustomer(
  customer.id,
  assessment.resultingRiskTier!,
);
// AFTER:
await this.materialRefreshService.recomputeHoldingsForCustomer(
  customer.id,
  customer.sumsubCurrentLevelName || 'wave3-level-1',
);
```

Also update the property type declaration (around line 18):
```typescript
// BEFORE:
materialRefreshService?: { recomputeHoldingsForCustomer: (id: string, tier: string) => Promise<any> };
// AFTER:
materialRefreshService?: { recomputeHoldingsForCustomer: (id: string, levelName: string) => Promise<any> };
```

- [ ] **Step 6: Update existing tests**

Run `npm test -- src/modules/identity/material-refresh --runInBand` to see if `get-required-materials` tests need updating. The test imports `getRequiredMaterialsForTier` which was renamed. Fix by updating the import and function call in the test file if it exists.

- [ ] **Step 7: Build + test**

```bash
npm run build 2>&1 | tail -10
npm test -- src/modules/identity --runInBand 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add config/material-refresh-policy.json \
        src/modules/identity/material-refresh/ \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts
git commit -m "refactor(material-refresh): change requiredForTiers→requiredForLevels + add LIVENESS material"
```

---

## Task 2: Backend admin Material Management API

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/admin-material-management.controller.ts`
- Modify: `Exchange_js/src/modules/identity/material-refresh/material-refresh.module.ts` (register controller)

- [ ] **Step 1: Create the admin controller**

Create `admin-material-management.controller.ts`:

```typescript
import {
  Controller, Get, Post, Param, Body, Query, Req,
  UseGuards, ForbiddenException, NotFoundException, Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRefreshService } from './material-refresh.service';

@ApiTags('Admin - Material Management')
@Controller('admin/material-management')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AdminMaterialManagementController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Get('holdings')
  @ApiOperation({ summary: 'List all material holdings across customers' })
  async listHoldings(
    @Req() req: any,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('materialType') materialType?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.ensureAdmin(req);

    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    if (materialType) where.materialType = materialType;

    const [items, total] = await Promise.all([
      this.prisma.customerMaterialHolding.findMany({
        where,
        include: {
          customer: {
            select: {
              customerNo: true,
              email: true,
              riskTier: true,
              sumsubCurrentLevelName: true,
            },
          },
          activeRefreshCycle: {
            select: {
              id: true,
              cycleNo: true,
              status: true,
              stage: true,
              graceExpiresAt: true,
            },
          },
        },
        orderBy: [{ expiresAt: 'asc' }],
        skip: parseInt(skip || '0', 10),
        take: Math.min(parseInt(take || '50', 10), 200),
      }),
      this.prisma.customerMaterialHolding.count({ where }),
    ]);

    return {
      items: items.map((h: any) => ({
        ...h,
        daysFromExpiry: h.expiresAt
          ? Math.floor((h.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          : null,
      })),
      total,
    };
  }

  @Get('holdings/:id')
  @ApiOperation({ summary: 'Get material holding detail with refresh cycle history' })
  async getHoldingDetail(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);

    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            riskTier: true,
            restrictionStatus: true,
            sumsubCurrentLevelName: true,
          },
        },
        activeRefreshCycle: true,
        refreshCycles: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!holding) throw new NotFoundException('Holding not found');

    return {
      ...holding,
      daysFromExpiry: holding.expiresAt
        ? Math.floor((holding.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null,
    };
  }

  @Post('holdings/:id/simulate-stage')
  @ApiOperation({
    summary: 'Simulate stage transition by adjusting expiresAt/graceExpiresAt and running the stage handler',
  })
  async simulateStage(
    @Req() req: any,
    @Param('id') holdingId: string,
    @Body() body: {
      targetStage: 'T_MINUS_30' | 'T_MINUS_7' | 'T_0' | 'T_PLUS_30' | 'GREEN' | 'RED';
    },
  ) {
    this.ensureAdmin(req);

    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding) throw new NotFoundException('Holding not found');

    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;

    switch (body.targetStage) {
      case 'T_MINUS_30': {
        // Set expiresAt to now + 25 days (enters NOTIFIED zone)
        await this.prisma.customerMaterialHolding.update({
          where: { id: holdingId },
          data: { expiresAt: new Date(now.getTime() + 25 * DAY_MS), status: 'FRESH' },
        });
        await this.materialRefreshService.enterNotifiedStage(holdingId);
        return { ok: true, stage: 'NUDGE_ONLY', message: 'Holding moved to T-30 zone, cycle created' };
      }

      case 'T_MINUS_7': {
        // Set expiresAt to now + 5 days (enters URGENT zone)
        await this.prisma.customerMaterialHolding.update({
          where: { id: holdingId },
          data: { expiresAt: new Date(now.getTime() + 5 * DAY_MS) },
        });
        await this.materialRefreshService.escalateToUrgent(holdingId);
        return { ok: true, stage: 'URGENT', message: 'Holding moved to T-7 zone' };
      }

      case 'T_0': {
        // Set expiresAt to now - 1 day (enters BLOCKING zone)
        await this.prisma.customerMaterialHolding.update({
          where: { id: holdingId },
          data: { expiresAt: new Date(now.getTime() - 1 * DAY_MS) },
        });
        await this.materialRefreshService.enterBlockingStage(holdingId);
        return { ok: true, stage: 'BLOCKING', message: 'Holding expired, customer RESTRICTED' };
      }

      case 'T_PLUS_30': {
        // Find active cycle, set graceExpiresAt to past
        const cycle = await this.prisma.materialRefreshCycle.findFirst({
          where: { holdingId, status: 'PENDING_CUSTOMER_EVIDENCE' },
        });
        if (!cycle) {
          return { ok: false, message: 'No active cycle to terminate' };
        }
        await this.prisma.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: { graceExpiresAt: new Date(now.getTime() - 1 * DAY_MS) },
        });
        await this.materialRefreshService.terminateCycle(cycle.id, 'simulated_grace_expired');
        return { ok: true, stage: 'GRACE_EXPIRED', message: 'Grace expired, customer offboarded' };
      }

      case 'GREEN': {
        // Simulate customer completing refresh successfully
        const cycle = await this.prisma.materialRefreshCycle.findFirst({
          where: { holdingId, status: 'PENDING_CUSTOMER_EVIDENCE' },
        });
        if (!cycle) {
          return { ok: false, message: 'No active cycle to complete' };
        }
        await this.materialRefreshService.handleSumsubActionResult({
          actionId: cycle.sumsubActionId || 'mock-action-simulate',
          reviewResult: { reviewAnswer: 'GREEN' },
        });
        return { ok: true, stage: 'CLEARED', message: 'Customer refreshed material successfully' };
      }

      case 'RED': {
        return { ok: true, stage: 'STILL_PENDING', message: 'Customer submission rejected, cycle stays PENDING for retry' };
      }

      default:
        return { ok: false, message: `Unknown targetStage: ${body.targetStage}` };
    }
  }
}
```

- [ ] **Step 2: Register controller in material-refresh.module.ts**

Add `AdminMaterialManagementController` to the controllers array in `material-refresh.module.ts`.

- [ ] **Step 3: Build + commit**

```bash
npm run build 2>&1 | tail -10
git add src/modules/identity/material-refresh/
git commit -m "feat(material-refresh): admin Material Management API (list + detail + simulate-stage)"
```

---

## Task 3: Admin-web Material Management list page

**Files:**
- Create: `Exchange_js/admin-web/src/pages/MaterialManagementPage.tsx`
- Modify: `Exchange_js/admin-web/src/App.tsx` (add route)

- [ ] **Step 1: Create list page**

Create `MaterialManagementPage.tsx` following the existing admin-web patterns:
- Use `adminFetch` for API calls (same pattern as `ComplianceAlertsPage.tsx` or `ApprovalsPage.tsx`)
- Use `AdminBadge` for status chips
- Table columns: Customer (customerNo + email), Material Type, Management Mode, Status (badge), Expires At, Days Left (computed), Active Cycle (link to detail), Risk Tier
- Filter by: status dropdown, materialType dropdown
- Row click navigates to `/dashboard/compliance/material-management/:holdingId`
- API: `GET /admin/material-management/holdings`

The page should follow the FIATX admin dark theme (existing admin-web already uses its own dark theme — NOT the client-web Desert Monolith theme).

- [ ] **Step 2: Add route in App.tsx**

Add 2 lazy-loaded routes following existing patterns:

```tsx
const MaterialManagementPage = lazy(() => import('./pages/MaterialManagementPage'));
const MaterialHoldingDetailPage = lazy(() => import('./pages/MaterialHoldingDetailPage'));

// Inside the <Route path="/dashboard"> block, add:
<Route
  path="compliance/material-management"
  element={withPermission(<MaterialManagementPage />, [PERMISSIONS.CUSTOMERS_READ])}
/>
<Route
  path="compliance/material-management/:holdingId"
  element={withPermission(<MaterialHoldingDetailPage />, [PERMISSIONS.CUSTOMERS_READ])}
/>
```

- [ ] **Step 3: Add navigation entry in sidebar**

Find the sidebar/navigation component (likely `DashboardLayout.tsx` or similar) and add "Material Management" under the Compliance section.

- [ ] **Step 4: Build + commit**

```bash
cd admin-web && npm run build 2>&1 | tail -10 && cd ..
git add admin-web/src/pages/MaterialManagementPage.tsx admin-web/src/App.tsx admin-web/src/components/
git commit -m "feat(admin-web): Material Management list page"
```

---

## Task 4: Admin-web Material Management detail page + simulation panel

**Files:**
- Create: `Exchange_js/admin-web/src/pages/MaterialHoldingDetailPage.tsx`

- [ ] **Step 1: Create detail page**

Create `MaterialHoldingDetailPage.tsx`:

Structure:
```
┌─────────────────────────────────────────────────┐
│  ← Back to list                                  │
│  Material Holding: PROOF_OF_ADDRESS               │
│  Customer: CU2604108406 (bb@fiatx.com)           │
├─────────────────────────────────────────────────┤
│  Status: [REFRESH_IN_PROGRESS]  Risk: [LOW]      │
│  Management: SELF_MANAGED                        │
│  Verified: 2025-04-10                            │
│  Expires: 2026-04-30 (20 days left)              │
│  Sumsub Action Level: wave3-action-poa-refresh    │
├─────────────────────────────────────────────────┤
│  § Simulation Panel                              │
│                                                  │
│  Stage simulation:                               │
│  [→ T-30] [→ T-7] [→ T-0] [→ T+30]            │
│                                                  │
│  Customer action simulation:                     │
│  [✓ GREEN: Material accepted]                   │
│  [✗ RED: Material rejected]                     │
├─────────────────────────────────────────────────┤
│  § Refresh Cycle History                         │
│                                                  │
│  MRC-2026-00001 | CLEARED  | 2026-01-15         │
│    action: mock-action-abc | resolved in 3 days  │
│                                                  │
│  MRC-2026-00002 | PENDING  | NUDGE_ONLY         │
│    action: mock-action-def | grace: 2026-05-30   │
│    ← current active cycle                        │
└─────────────────────────────────────────────────┘
```

Each simulation button calls:
```
POST /admin/material-management/holdings/:id/simulate-stage
body: { targetStage: "T_MINUS_30" | "T_MINUS_7" | "T_0" | "T_PLUS_30" | "GREEN" | "RED" }
```

After each simulation, refresh the page data to show updated state.

- [ ] **Step 2: Build + commit**

```bash
cd admin-web && npm run build 2>&1 | tail -10 && cd ..
git add admin-web/src/pages/MaterialHoldingDetailPage.tsx
git commit -m "feat(admin-web): Material Holding detail page with stage simulation panel"
```

---

## Task 5: Customer Detail enhancements (material summary + tier assignment)

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/CustomerDetail.tsx`

- [ ] **Step 1: Add material holdings summary section**

In `CustomerDetail.tsx`, after loading customer detail data, add a section that:
1. Fetches `GET /admin/material-management/holdings?customerId={id}`
2. Renders a compact table showing each material's type, status, expiry countdown
3. Each row links to the Material Management detail page
4. Section header: "§ Material Holdings"

- [ ] **Step 2: Add Quick Tier Assignment simulation panel**

Below the material holdings section, add a "§ Risk Tier Simulation" panel with 5 buttons:

```tsx
<div>
  <h4>§ Risk Tier Simulation</h4>
  <p>Simulate AML check results to change this customer's risk tier</p>
  <div className="flex gap-2 mt-3">
    <button onClick={() => simulateTier('LOW')}>Set LOW</button>
    <button onClick={() => simulateTier('MEDIUM')}>Set MEDIUM</button>
    <button onClick={() => simulateTier('HIGH')}>Set HIGH</button>
    <button onClick={() => simulateTier('PEP')}>Detect PEP</button>
    <button onClick={() => simulateTier('SANCTIONS')}>Sanctions Hit</button>
  </div>
</div>
```

Each button makes 2 API calls in sequence:
1. `POST /admin/compliance/customers/:id/risk-assessment/trigger` — creates pending assessment
2. `POST /admin/sumsub/simulate/aml-check-result` — simulates the AML result

Mapping:
- `LOW`: `{ reviewAnswer: 'GREEN', rejectLabels: [] }` → auto-sign → tier stays LOW
- `MEDIUM`: `{ reviewAnswer: 'GREEN', rejectLabels: [] }` + then manually update the assessment's `resultingRiskTier` to MEDIUM (or add a backend shortcut)
- `HIGH`: `{ reviewAnswer: 'GREEN', rejectLabels: [] }` + update to HIGH
- `PEP`: `{ reviewAnswer: 'RED', rejectLabels: ['PEP_CLASS_1_DOMESTIC'] }` → RESTRICTED + creates PEP approval
- `SANCTIONS`: `{ reviewAnswer: 'RED', rejectLabels: ['SANCTIONS_UN'] }` → FROZEN

**Note on MEDIUM/HIGH buttons**: Since our policy v1 only has 6 rules and no behavioral scoring, a GREEN result always maps to LOW (rule P6). To force MEDIUM or HIGH, we need either:
- A backend shortcut endpoint: `POST /admin/material-management/simulate-tier-change` that directly sets `customer.riskTier`, creates appropriate holdings, and records a ClientRiskAssessment
- Or add temporary "local_behavior_score" parameters to the policy

For demo simplicity, create a backend shortcut:

```typescript
// In AdminMaterialManagementController:
@Post('customers/:customerId/simulate-tier-change')
async simulateTierChange(
  @Req() req: any,
  @Param('customerId') customerId: string,
  @Body() body: { targetTier: 'LOW' | 'MEDIUM' | 'HIGH' },
) {
  // 1. Update customer.riskTier directly
  // 2. Sync Sumsub level if needed (tier↔level constraint)
  // 3. Call recomputeHoldingsForCustomer for the new level
  // 4. Create a ClientRiskAssessment record for audit trail
}
```

- [ ] **Step 3: Build + commit**

```bash
cd admin-web && npm run build 2>&1 | tail -10 && cd ..
git add admin-web/src/pages/CustomerDetail.tsx \
        src/modules/identity/material-refresh/admin-material-management.controller.ts
git commit -m "feat(admin-web): Customer Detail material summary + Quick Tier Assignment"
```

---

## Verification

After all 5 tasks:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run build 2>&1 | tail -10
(cd admin-web && npm run build 2>&1 | tail -10)
npm test -- src/modules/identity --runInBand 2>&1 | tail -20
```

All must pass.

---

## Summary

| Task | Content | Files | Est. |
|---|---|---|---|
| **T1** | Policy JSON update + LIVENESS + level-based functions | 5 modify | 0.5d |
| **T2** | Backend admin Material Management API | 1 create + 1 modify | 0.5d |
| **T3** | Admin list page + route + nav | 1 create + 2 modify | 0.5d |
| **T4** | Admin detail page + simulation panel | 1 create | 0.5d |
| **T5** | Customer Detail material summary + tier buttons + backend shortcut | 1 modify + 1 modify | 0.5d |

**Total: 5 tasks, ~2.5 days**
