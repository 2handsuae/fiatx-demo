# Recon Run Detail — Health Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ReconciliationRunsDetailPage` health section's `scope×currency` matrix + drill panel with per-asset tabs that list each asset's five formulas, identified by COA-code equations (no F1–F5 numbers), right side showing only the net Δ.

**Architecture:** Pure frontend refactor of one file's `layer=REDESIGN` branch. Same `getRun` data (`invariantChecks` + `cases`); add a static `invariantCode → {scope, name, COA codes, external term}` map mirroring `engine/formula-checker.service.ts`. No backend, schema, data, or legacy I1–I5 changes.

**Tech Stack:** React 19 + TypeScript + Tailwind (admin-web), lucide-react icons, react-router-dom.

---

## Spec

`doc-final/superpowers/specs/2026-06-22-recon-run-detail-redesign-design.md`

## File Structure

- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx` — the only file. Within it:
  - Constants region (lines ~81–132): swap matrix/lane/F-tag constants for `FORMULA_COMPONENTS` / `FORMULA_DISPLAY_ORDER` / `SCOPE_META`.
  - Add `FormulaRow` presentational component.
  - Page component: replace cell-selection state + scorecard/drill derivation + matrix/drill JSX with tab state + tab bar + per-asset formula list.
  - Untouched: hero, run summary, verdict+metric strip (two small reference fixes), legacy I1–I5 branch, sidebar, technical.

---

## Task 1: Refactor the Reconciliation Health section

**Files:**
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`

- [ ] **Step 1.1: Replace the constants region**

Find the block from `const isRedesignRun =` through the `LANE_SUB` declaration (current lines ~81–132: `isRedesignRun`, `FORMULA_ORDER`, `FORMULA_LABEL`, `FORMULA_TAG`, `LaneKey`/`LANES`/`LANE_TONE`, `SCOPE_OF`, `LANE_SUB`). Replace **all of it** with:

```tsx
// Redesign (5-formula) runs carry layer=REDESIGN; their invariantChecks hold 式1..式5.
const isRedesignRun = (layer: string) => layer === 'REDESIGN';

type Scope = 'CLIENT' | 'FIRM' | 'LEDGER';

// COA-code makeup per formula — mirrors engine/formula-checker.service.ts blocks
// (CLIENT_BLOCK_CODES / CLIENT_POOL_CODES / BRIDGE_BLOCK_CODES / FIRM_POOL_CODE). Keep in sync.
// lhsCodes = internal ledger side (concrete COA codes); rhsTerm = external/subledger quantity
// (no single COA account → kept descriptive); null rhsTerm = identity that must net to 0.
const FORMULA_COMPONENTS: Record<
  string,
  { scope: Scope; name: string; lhsCodes: string; rhsTerm: string | null }
> = {
  式2: {
    scope: 'CLIENT',
    name: 'Client tie-out',
    lhsCodes: 'A.CLIENT_BANK + A.CLIENT_CUSTODY + L.CLIENT_PAYABLE + L.DEPOSIT_SUSPENSE',
    rhsTerm: 'open outstanding − unsettled w/d fee',
  },
  式4: {
    scope: 'CLIENT',
    name: 'Client off-book',
    lhsCodes: 'A.CLIENT_BANK + A.CLIENT_CUSTODY',
    rhsTerm: 'external ± in-transit',
  },
  式5: {
    scope: 'FIRM',
    name: 'Firm off-book',
    lhsCodes: 'A.FIRM_TREASURY',
    rhsTerm: 'external ± in-transit',
  },
  式1: {
    scope: 'LEDGER',
    name: 'Trial balance',
    lhsCodes: 'Σ all accounts (client + bridge + firm)',
    rhsTerm: null,
  },
  式3: {
    scope: 'LEDGER',
    name: 'Bridge tie-out',
    lhsCodes: 'L.TRADE_CLEARING',
    rhsTerm: 'unswept swap',
  },
};

// Tab-internal display order: Client → Firm → Ledger-wide.
const FORMULA_DISPLAY_ORDER = ['式2', '式4', '式5', '式1', '式3'];

const SCOPE_META: Record<Scope, { label: string; tone: string; book: 'CLIENT' | 'FIRM' | null }> = {
  CLIENT: { label: 'Client', tone: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber', book: 'CLIENT' },
  FIRM: { label: 'Firm', tone: 'border-adm-green/30 bg-adm-green/10 text-adm-green', book: 'FIRM' },
  LEDGER: { label: 'Ledger-wide', tone: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue', book: null },
};
```

Keep `num`, `Metric`, `SeverityPill`, `SEVERITY_TONE`, `TRIGGER_LABELS`, `fmtTrigger`, `fmtTime` exactly as they are.

- [ ] **Step 1.2: Drop the now-unused `Fragment` import**

The `<Fragment>` was used only by the matrix. Edit the React import (line ~2):

```tsx
import { useEffect, useState, type ReactNode } from 'react';
```

- [ ] **Step 1.3: Delete `buildScorecard`, `MatrixCell`, and `CellState`**

Remove the `type CellState = ...` line, the entire `function buildScorecard(...)`, and the entire `const MatrixCell = (...) => {...}` component (current lines ~139–216). The new design renders rows directly; none of these are referenced anymore.

- [ ] **Step 1.4: Add the `FormulaRow` component**

Immediately after the `Metric` component definition, add:

```tsx
// One formula row: scope badge + short name + COA-code equation on the left;
// net Δ on the right (Δ=0 → green pass, Δ≠0 → red break + link to that scope's case).
const FormulaRow = ({
  check,
  prevScope,
  caseNo,
  onCase,
}: {
  check: InvariantCheck;
  prevScope: Scope | undefined;
  caseNo: string | null;
  onCase: () => void;
}) => {
  const comp = FORMULA_COMPONENTS[check.invariantCode];
  if (!comp) return null;
  const scope = SCOPE_META[comp.scope];
  const fail = check.status === 'FAIL';
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border border-adm-border bg-adm-bg px-3.5 py-3 ${
        prevScope && prevScope !== comp.scope ? 'mt-1.5' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${scope.tone}`}
          >
            {scope.label}
          </span>
          <span className="text-[13px] text-adm-t1">{comp.name}</span>
        </div>
        <div className="mt-1.5 leading-relaxed">
          <span className="font-mono text-[12px] text-adm-t2">{comp.lhsCodes}</span>{' '}
          <span className="font-mono text-[12px] font-semibold text-adm-t1">{check.lhsValue}</span>
          {comp.rhsTerm ? (
            <>
              <span className="px-1.5 font-mono text-[12px] text-adm-t3">↔</span>
              <span className="font-mono text-[12px] text-adm-t2">{comp.rhsTerm}</span>{' '}
              <span className="font-mono text-[12px] font-semibold text-adm-t1">{check.rhsValue}</span>
            </>
          ) : (
            <span className="px-1.5 font-mono text-[12px] text-adm-t3">→ 0</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5" style={{ minWidth: 120 }}>
        {fail ? (
          <span className="font-mono text-[15px] font-semibold text-adm-red">Δ {check.delta}</span>
        ) : (
          <span className="flex items-center gap-1 font-mono text-[14px] text-adm-green">
            <Check size={13} /> {check.delta}
          </span>
        )}
        <StatusPill value={check.status} />
        {fail && caseNo && (
          <button
            type="button"
            onClick={onCase}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
          >
            {caseNo} <ArrowRight size={11} />
          </button>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 1.5: Swap cell-selection state for active-asset state**

Change the state declaration (current line ~234):

```tsx
  // Selected asset tab; null falls back to the first asset with a break (else the first asset).
  const [activeCcy, setActiveCcy] = useState<string | null>(null);
```

And in the `useEffect` on `[runNo]` (current line ~258), change `setSelected(null);` to:

```tsx
    setActiveCcy(null);
```

- [ ] **Step 1.6: Replace the scorecard/drill derivation block**

Replace the derivation block — from `const { currencies, cells } = redesign ...` through `const activeCase = ...` (current lines ~277–306) — with:

```tsx
  // Currencies present in this run's checks (redesign only).
  const currencies = redesign ? [...new Set(checks.map((c) => c.currency ?? '—'))].sort() : [];

  // Run-health roll-up.
  let passCount = 0;
  let failCount = 0;
  let worstChk: InvariantCheck | null = null;
  for (const c of checks) {
    if (c.status === 'FAIL') {
      failCount += 1;
      if (!worstChk || Math.abs(num(c.delta)) > Math.abs(num(worstChk.delta))) worstChk = c;
    } else {
      passCount += 1;
    }
  }
  const ledgerOk = checks
    .filter((c) => c.invariantCode === '式1' || c.invariantCode === '式3')
    .every((c) => c.status === 'PASS');
  const isBreak = failCount > 0;

  // Active tab defaults to the first asset with a break, else the first asset.
  const firstBreakCcy = currencies.find((ccy) =>
    checks.some((c) => (c.currency ?? '—') === ccy && c.status === 'FAIL'),
  );
  const activeCurrency = activeCcy ?? firstBreakCcy ?? currencies[0] ?? null;

  // The active asset's five formulas, ordered Client → Firm → Ledger-wide.
  const activeRows = activeCurrency
    ? checks
        .filter((c) => (c.currency ?? '—') === activeCurrency)
        .sort(
          (a, b) =>
            FORMULA_DISPLAY_ORDER.indexOf(a.invariantCode) -
            FORMULA_DISPLAY_ORDER.indexOf(b.invariantCode),
        )
    : [];
```

Note: the `passCount`/`failCount`/`worstChk`/`ledgerOk`/`isBreak` lines already exist further down in the current file (lines ~283–297) — move them up into this block as shown and delete the old duplicate so they are declared once.

- [ ] **Step 1.7: Fix the two verdict-strip references**

In the verdict/metric strip JSX (inside the `redesign ?` DetailCard), make two edits:

Scope count (current line ~404) — change `{LANES.length} scopes` to:

```tsx
                        {currencies.length} currencies · 3 scopes · {checks.length} formula checks
```

Worst-Δ scope label (current line ~420) — change `{(SCOPE_OF[worstChk.invariantCode] ?? 'LEDGER').toLowerCase()}` to:

```tsx
                              {(FORMULA_COMPONENTS[worstChk.invariantCode]?.scope ?? 'LEDGER').toLowerCase()}
```

- [ ] **Step 1.8: Replace the matrix + drill JSX with tabs + formula list**

Replace both the `{/* ── Scorecard matrix ... ── */}` `<div>` and the `{/* ── Drill panel ... ── */}` block (current lines ~439–554) with:

```tsx
                  {/* ── Asset tabs ── */}
                  <div className="border-b border-adm-border pb-3">
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                      Assets
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {currencies.map((ccy) => {
                        const broke = checks.some(
                          (c) => (c.currency ?? '—') === ccy && c.status === 'FAIL',
                        );
                        const isActive = ccy === activeCurrency;
                        return (
                          <button
                            key={ccy}
                            type="button"
                            onClick={() => setActiveCcy(ccy)}
                            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 font-mono text-[13px] transition-colors ${
                              isActive
                                ? 'border-adm-amber/50 bg-adm-amber/10 text-adm-amber'
                                : 'border-adm-border text-adm-t2 hover:bg-adm-hover'
                            }`}
                          >
                            {ccy}
                            {broke && (
                              <span className="h-1.5 w-1.5 rounded-full bg-adm-red" aria-label="break" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Active asset · five formulas (Client → Firm → Ledger-wide) ── */}
                  <div className="flex flex-col gap-2">
                    {activeRows.map((c, i) => {
                      const comp = FORMULA_COMPONENTS[c.invariantCode];
                      const book = comp ? SCOPE_META[comp.scope].book : null;
                      const kase = book
                        ? run.cases?.find((k) => k.assetCode === activeCurrency && k.book === book)
                        : undefined;
                      return (
                        <FormulaRow
                          key={c.id}
                          check={c}
                          prevScope={
                            i > 0 ? FORMULA_COMPONENTS[activeRows[i - 1].invariantCode]?.scope : undefined
                          }
                          caseNo={kase?.caseNo ?? null}
                          onCase={() =>
                            kase &&
                            navigate(`/admin/reconciliation/cases/${encodeURIComponent(kase.caseNo)}`)
                          }
                        />
                      );
                    })}
                  </div>
```

- [ ] **Step 1.9: Type-check and lint**

Run: `cd admin-web && npm run build`
Expected: `tsc -b` + `vite build` complete with 0 errors. Watch specifically for "declared but never used" (a leftover reference to `LANES`/`SCOPE_OF`/`FORMULA_TAG`/`MatrixCell`/`Fragment` means a removal was missed — go fix it).

Run: `cd admin-web && npm run lint`
Expected: 0 errors.

- [ ] **Step 1.10: Commit**

```bash
git add admin-web/src/pages/ReconciliationRunsDetailPage.tsx
git commit -m "feat(recon): run-detail health — asset tabs + COA-code formula rows (drop F1-5 matrix)"
```

---

## Task 2: Render verification (break + pass)

**Files:** none (verification only).

UI correctness is verified by rendering, not type-check alone (curl/tsc do not count). The admin login is MFA-gated — drive the login with a TOTP, or hand the screenshot step to the user.

- [ ] **Step 2.1: Ensure a break run exists**

Run (from `Exchange_js/`, services already up on branch ports):

```bash
npm run recon:demo -- --mode=break
```

Expected: console prints a REDESIGN run with injected breaks; note its `runNo` (and that it spans AED + USDT).

- [ ] **Step 2.2: Open the run detail page**

Admin `http://localhost:3501` → Reconciliation → Runs → open that `runNo` (or `/admin/reconciliation/runs/<runNo>`). HMR already serves the rebuilt component.

- [ ] **Step 2.3: Screenshot-verify against spec §3**

Confirm, by eye/screenshot:
- AED | USDT tabs render; the broken asset(s) show a red dot; clicking switches and only that asset's formulas show.
- Each tab lists 5 formulas ordered Client → Firm → Ledger-wide, each with a scope badge + COA-code equation.
- No `F1`–`F5` (or `式1`–`式5`) tags appear anywhere in the UI.
- Right column shows only Δ: green ✓ for pass, red `Δ <value>` + Break + a case link on the breaking Client/Firm row; Ledger-wide rows never show a case link.
- The top verdict/metric strip is unchanged and stays constant across tab switches.

- [ ] **Step 2.4: Pass-mode sanity**

Run `npm run recon:demo -- --mode=pass`, open that run: every row green ✓, no red dots on tabs, no case links. Verdict strip shows Balanced.

- [ ] **Step 2.5: Legacy non-regression**

Open any older `layer≠REDESIGN` run — confirm the legacy I1–I5 table still renders unchanged (the `redesign ? ... : ...` else-branch was not touched).

---

## Self-Review

**Spec coverage:**
- §1.1 asset tabs → Task 1 Step 1.8 (tab bar) + 1.5/1.6 (state, active asset). ✓
- §1.2 five formulas per asset, scope badge, order Client→Firm→Ledger → 1.4 (`FormulaRow` badge) + 1.1 (`FORMULA_DISPLAY_ORDER`) + 1.8 (list). ✓
- §1.3 drop Internal/External, all content left, Δ-only right → 1.4 (`FormulaRow` layout). ✓
- §1.4 drop F1–5, use COA codes → 1.1 (`FORMULA_COMPONENTS`, no `FORMULA_TAG`) + 1.3 (delete matrix). ✓
- §2 formula→scope/COA map (incl. 式1 `Σ all accounts`, RHS descriptive) → 1.1. ✓
- §3.1 keep verdict/metric strip → preserved; 1.7 fixes its two lane references. ✓
- §3.4 case link per (currency, book) on break rows; ledger has none → 1.8 (`book` lookup, `book ? find : undefined`). ✓
- §4 frontend-only, reuse `getRun` → no backend touched. ✓
- §5 acceptance incl. legacy non-regression + render → Task 2. ✓
- §7 per-COA-code amounts deferred → not in plan (correctly out of scope). ✓

**Placeholder scan:** none — every step has concrete code or an exact command.

**Type consistency:** `Scope` union, `FORMULA_COMPONENTS`/`SCOPE_META` keyed by `invariantCode`/`Scope`, `FormulaRow` props (`check: InvariantCheck`, `prevScope: Scope | undefined`, `caseNo: string | null`, `onCase: () => void`), `activeCcy`/`setActiveCcy`, `activeCurrency`, `activeRows`, `run.cases` (`caseNo`/`assetCode`/`book`) — all consistent across steps. `Check`/`AlertTriangle`/`ArrowRight`/`RefreshCw` imports remain in use; only `Fragment` removed.
