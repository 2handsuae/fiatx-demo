# Admin Console Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the amber-on-slate design system (iterated in `/tmp/admin-preview.html`) to the Exchange.js admin-web React app — replacing the current blue/grey aesthetic with a precision-focused industrial data interface.

**Architecture:** Three-layer approach: (1) CSS custom-property design tokens + Tailwind mappings, (2) new shared UI primitives (`AdminBadge`, `PageTitleBar`), (3) updated existing components (`adminButtonStyles`, `DetailPageComponents`) — then apply to Audit Logs pages as end-to-end validation. Dark/light mode is automatic via CSS custom properties switched by Tailwind's `dark` class on `<html>`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3 (`darkMode: 'class'`), clsx + tailwind-merge, React Router v7, Lucide React, JetBrains Mono (Google Fonts)

**Design Reference:** `/tmp/admin-preview.html` — fully iterated preview with exact colors, spacing, and component shapes. Read it when in doubt.

**All files relative to:** `admin-web/` inside the Exchange_js repo root.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `index.html` | Add JetBrains Mono Google Font |
| Modify | `tailwind.config.js` | Add `adm-*` CSS-variable-backed color tokens |
| Modify | `src/index.css` | Define CSS custom properties (light + dark) |
| Create | `src/components/ui/AdminBadge.tsx` | Unified status + trigger badge component |
| Create | `src/components/ui/PageTitleBar.tsx` | Page title bar with meta + action slot |
| Modify | `src/components/common/adminButtonStyles.ts` | Amber-based button variants |
| Modify | `src/components/compliance/DetailPageComponents.tsx` | Reskin cards/fields to new tokens |
| Modify | `src/pages/AuditLogsPage.tsx` | New table columns, filter bar, title bar |
| Modify | `src/pages/AuditLogDetailPage.tsx` | Use `AdminBadge`, minor header adjustments |

---

## Task 1: Design Tokens — fonts, CSS variables, Tailwind config

**Files:**
- Modify: `index.html`
- Modify: `tailwind.config.js`
- Modify: `src/index.css`

### Background

The design uses two complementary token systems:
- **CSS custom properties** in `:root` / `.dark` for automatic light↔dark switching
- **Tailwind color tokens** that reference those variables (`text-adm-amber`, `bg-adm-panel`, etc.)

By mapping Tailwind tokens to CSS variables, we never need `dark:` prefix classes — the variable values change automatically when Tailwind adds the `dark` class to `<html>`.

- [ ] **Step 1: Add JetBrains Mono font to `index.html`**

Replace the existing font `<link>` line with:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

Full resulting `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <title>Exchange Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Add `adm-*` token colors to `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Legacy — keep for DashboardLayout / sidebar (migrated separately)
        'brand-primary':       '#2A5CAA',
        'brand-secondary':     '#F5F7FA',
        'brand-dark':          '#1A1A1A',
        'brand-accent':        '#00D1FF',
        'admin-sidebar-bg':    '#1a1a2e',
        'admin-sidebar-text':  '#ffffff',
        'admin-sidebar-hover': '#2a2a3a',
        'admin-content-bg':    '#f5f5f5',
        'admin-border':        '#dddddd',
        'deep-space':          '#121212',
        'deep-sea':            '#001a33',
        'neon-blue':           '#00f5ff',
        'finance-gold':        '#ffd700',
        'card-bg':             'rgba(18, 18, 18, 0.95)',

        // ── New admin design system ─────────────────────────────
        // These map to CSS custom properties defined in index.css.
        // Dark/light mode is handled automatically — no dark: prefix needed.
        'adm-bg':     'var(--adm-bg)',
        'adm-panel':  'var(--adm-panel)',
        'adm-card':   'var(--adm-card)',
        'adm-hover':  'var(--adm-hover)',
        'adm-border': 'var(--adm-border)',
        'adm-bhi':    'var(--adm-bhi)',
        'adm-amber':  'var(--adm-amber)',
        'adm-t1':     'var(--adm-text-1)',
        'adm-t2':     'var(--adm-text-2)',
        'adm-t3':     'var(--adm-text-3)',
        'adm-green':  'var(--adm-green)',
        'adm-red':    'var(--adm-red)',
        'adm-yellow': 'var(--adm-yellow)',
        'adm-blue':   'var(--adm-blue)',
      },
      fontFamily: {
        'noto-medium':  ['"Noto Sans SC"', 'sans-serif', '500'],
        'noto-regular': ['"Noto Sans SC"', 'sans-serif', '400'],
        sans:  ['"Noto Sans SC"', 'Inter', 'system-ui', 'sans-serif'],
        mono:  ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: Add CSS custom properties to `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── Admin Design Tokens ─────────────────────────────────────
   Light-mode defaults.  Dark-mode overrides set in .dark block.
   Tailwind adm-* colors in tailwind.config.js reference these vars.
──────────────────────────────────────────────────────────── */
:root {
  --adm-bg:      #f8fafc;
  --adm-panel:   #ffffff;
  --adm-card:    #f1f5f9;
  --adm-hover:   #f1f5f9;
  --adm-border:  #e2e8f0;
  --adm-bhi:     #cbd5e1;
  --adm-amber:   #d97706;
  --adm-text-1:  #0f172a;
  --adm-text-2:  #475569;
  --adm-text-3:  #94a3b8;
  --adm-green:   #059669;
  --adm-red:     #dc2626;
  --adm-yellow:  #d97706;
  --adm-blue:    #2563eb;
}

.dark {
  --adm-bg:      #0c1018;
  --adm-panel:   #111827;
  --adm-card:    #1a2332;
  --adm-hover:   #1e2d3f;
  --adm-border:  #1f2d3d;
  --adm-bhi:     #2a3d52;
  --adm-amber:   #f59e0b;
  --adm-text-1:  #e2e8f0;
  --adm-text-2:  #8b9eb0;
  --adm-text-3:  #4a6075;
  --adm-green:   #10b981;
  --adm-red:     #ef4444;
  --adm-yellow:  #f59e0b;
  --adm-blue:    #3b82f6;
}

:root {
  color-scheme: light dark;
}

body {
  @apply bg-admin-content-bg text-gray-900 overflow-x-hidden dark:bg-deep-space dark:text-white;
  font-family: 'Noto Sans SC', 'Inter', sans-serif;
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--adm-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--adm-bhi); }
```

- [ ] **Step 4: Verify the dev server starts without errors**

```bash
cd admin-web
npm run dev
```

Expected: server starts, no TypeScript or Tailwind errors. Visit `http://localhost:5173` — existing pages should still render (we haven't changed any component code yet).

- [ ] **Step 5: Commit**

```bash
git add index.html tailwind.config.js src/index.css
git commit -m "feat(admin-ui): add adm-* design tokens, JetBrains Mono font"
```

---

## Task 2: `AdminBadge` — unified status and trigger badge component

**Files:**
- Create: `src/components/ui/AdminBadge.tsx`

### Background

Currently, each page (AuditLogsPage, AuditLogDetailPage, etc.) has its own `getStatusClassName()` helper with inconsistent styling. `AdminBadge` centralises this. It:
- Renders a coloured pill with an optional leading dot
- Handles all known `result` values (SUCCESS / FAILED / REJECTED / PENDING / ACTIVE / DELETED / DRAFT / DONE / APPROVED / READY)
- Exports a secondary `TriggerTag` for trigger-type labels

Font is `font-mono` (JetBrains Mono via Tailwind). Colors use `adm-*` tokens — auto dark/light.

- [ ] **Step 1: Create `src/components/ui/AdminBadge.tsx`**

```tsx
// src/components/ui/AdminBadge.tsx

type BadgeVariant = 'success' | 'failed' | 'rejected' | 'pending' | 'active' | 'deleted' | 'info';

const STATUS_MAP: Record<string, BadgeVariant> = {
  SUCCESS:          'success',
  DONE:             'success',
  APPROVED:         'success',
  ACTIVE:           'active',
  FAILED:           'failed',
  ERROR:            'failed',
  REJECTED:         'rejected',
  PENDING:          'pending',
  PENDING_APPROVAL: 'pending',
  DRAFT:            'info',
  READY:            'info',
  DELETED:          'deleted',
};

const BADGE_CLS: Record<BadgeVariant, string> = {
  success:  'bg-adm-green/10  text-adm-green  border-adm-green/25',
  failed:   'bg-adm-red/10    text-adm-red    border-adm-red/25',
  rejected: 'bg-adm-amber/10  text-adm-amber  border-adm-amber/25',
  pending:  'bg-adm-blue/10   text-adm-blue   border-adm-blue/25',
  active:   'bg-adm-green/10  text-adm-green  border-adm-green/25',
  deleted:  'bg-adm-red/10    text-adm-red    border-adm-red/25',
  info:     'bg-adm-t3/10     text-adm-t2     border-adm-t3/25',
};

/** Status badge — SUCCESS / FAILED / REJECTED / PENDING / ACTIVE / DELETED / etc. */
export const AdminBadge = ({
  value,
  dot = true,
}: {
  value: string;
  dot?: boolean;
}) => {
  const variant: BadgeVariant = STATUS_MAP[value] ?? 'info';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${BADGE_CLS[variant]}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {value}
    </span>
  );
};

const TRIGGER_CLS: Record<string, string> = {
  AUTH_EVENT:       'bg-purple-500/10 text-purple-500 border-purple-500/20',
  EVIDENCE_EXPORT:  'bg-sky-500/10    text-sky-500    border-sky-500/20',
  STATE_TRANSITION: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  MANUAL_OVERRIDE:  'bg-orange-500/10 text-orange-500 border-orange-500/20',
  PERMISSION_CHANGE:'bg-violet-500/10 text-violet-500 border-violet-500/20',
  CONFIG_CHANGE:    'bg-teal-500/10   text-teal-500   border-teal-500/20',
};

/** Smaller tag for triggerType values */
export const TriggerTag = ({ value }: { value: string }) => {
  const cls =
    TRIGGER_CLS[value] ?? 'bg-adm-t3/10 text-adm-t3 border-adm-t3/20';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px font-mono text-[9px] font-medium ${cls}`}
    >
      {value}
    </span>
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/AdminBadge.tsx
git commit -m "feat(admin-ui): add AdminBadge + TriggerTag components"
```

---

## Task 3: `PageTitleBar` — page-level title with meta text and action slot

**Files:**
- Create: `src/components/ui/PageTitleBar.tsx`

### Background

Every list page currently has ad-hoc `<h1>` + subtitle markup. `PageTitleBar` standardises this as a sticky bar at the top of each module view (flush with the main content area, above the filter bar). It accepts:
- `title` — page name ("Audit Logs")
- `meta` — `font-mono` secondary line ("9 records · Compliance & Risk")
- `children` — optional action buttons pinned to the right

- [ ] **Step 1: Create `src/components/ui/PageTitleBar.tsx`**

```tsx
// src/components/ui/PageTitleBar.tsx
import type { ReactNode } from 'react';

interface PageTitleBarProps {
  title: string;
  meta?: string | null;
  children?: ReactNode;
}

export const PageTitleBar = ({ title, meta, children }: PageTitleBarProps) => (
  <div className="flex shrink-0 items-start justify-between border-b border-adm-border bg-adm-panel px-5 py-3.5">
    <div className="flex flex-col gap-1">
      <h1 className="text-[15px] font-semibold leading-none tracking-tight text-adm-t1">
        {title}
      </h1>
      {meta ? (
        <p className="font-mono text-[10px] text-adm-t3">{meta}</p>
      ) : null}
    </div>
    {children ? (
      <div className="flex items-center gap-2">{children}</div>
    ) : null}
  </div>
);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/PageTitleBar.tsx
git commit -m "feat(admin-ui): add PageTitleBar component"
```

---

## Task 4: Update `adminButtonStyles.ts` — amber-based variants

**Files:**
- Modify: `src/components/common/adminButtonStyles.ts`

### Background

Current buttons use `bg-slate-900` (black) as primary and `brand-primary` (blue #2A5CAA) for links. We update to use `adm-amber` for primary and `adm-amber` for key links. Ghost/secondary styles use `adm-border` and `adm-t2`.

Keep all existing variant names — this is a drop-in reskin with no API change.

- [ ] **Step 1: Replace full content of `src/components/common/adminButtonStyles.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type AdminButtonVariant =
  | 'listPrimary'
  | 'listSecondary'
  | 'rowKeyLink'
  | 'rowLink'
  | 'rowSecondaryUtility'
  | 'detailUtility'
  | 'workflowPrimary'
  | 'workflowSecondary'
  | 'workflowNegative'
  | 'repair'
  | 'simulationAction'
  | 'modalCancel'
  | 'modalConfirm';

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const blockBase =
  'inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 font-mono text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const variants: Record<AdminButtonVariant, string> = {
  // Amber-filled primary action
  listPrimary: `${blockBase} bg-adm-amber text-white hover:opacity-88 border border-adm-amber`,

  // Ghost secondary
  listSecondary: `${blockBase} border border-adm-border bg-transparent text-adm-t2 hover:border-adm-bhi hover:text-adm-t1 hover:bg-adm-hover`,

  // Amber mono link (audit no, ticket no, etc.)
  rowKeyLink:
    'inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] font-semibold text-adm-amber transition-colors hover:opacity-75 disabled:pointer-events-none disabled:opacity-40',

  // Standard text link (amber)
  rowLink:
    'inline-flex items-center justify-end font-mono text-[11px] font-medium text-adm-amber transition-colors hover:opacity-75 disabled:pointer-events-none disabled:opacity-40',

  // Muted secondary link
  rowSecondaryUtility:
    'inline-flex items-center justify-end font-mono text-[10px] font-medium text-adm-t3 transition-colors hover:text-adm-t2 disabled:pointer-events-none disabled:opacity-40',

  // Detail page utility ghost button
  detailUtility: `${blockBase} border border-adm-border bg-adm-panel text-adm-t2 hover:border-adm-bhi hover:text-adm-t1 hover:bg-adm-hover`,

  // Workflow actions
  workflowPrimary: `${blockBase} bg-adm-amber text-white hover:opacity-88 border border-adm-amber`,
  workflowSecondary: `${blockBase} border border-adm-border bg-transparent text-adm-t2 hover:border-adm-bhi hover:bg-adm-hover`,

  // Destructive
  workflowNegative:
    `${blockBase} border border-adm-red/35 bg-transparent text-adm-red hover:bg-adm-red/6`,

  // Repair / warning
  repair:
    `${blockBase} border border-adm-amber/35 bg-adm-amber/8 text-adm-amber hover:bg-adm-amber/12`,

  // Simulation
  simulationAction:
    `${blockBase} border border-adm-blue/25 bg-adm-blue/8 text-adm-blue hover:bg-adm-blue/12`,

  // Modal
  modalCancel: `${blockBase} border border-adm-border bg-transparent text-adm-t2 hover:border-adm-bhi hover:bg-adm-hover`,
  modalConfirm: `${blockBase} bg-adm-amber text-white hover:opacity-88 border border-adm-amber`,
};

export const adminButtonClass = (
  variant: AdminButtonVariant,
  className?: ClassValue,
) => cn(variants[variant], className);

export const adminIconButtonClass = (className?: ClassValue) =>
  cn(
    'inline-flex h-8 w-8 items-center justify-center rounded border border-adm-border bg-adm-panel text-adm-t2 transition-colors hover:bg-adm-hover hover:text-adm-t1 disabled:cursor-not-allowed disabled:opacity-40',
    className,
  );
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Check a page that uses buttons still renders**

Visit any existing page in the dev server. Buttons should now appear amber-primary / ghost-secondary.

- [ ] **Step 4: Commit**

```bash
git add src/components/common/adminButtonStyles.ts
git commit -m "feat(admin-ui): update button variants to amber design system"
```

---

## Task 5: Update `DetailPageComponents.tsx` — reskin cards and info fields

**Files:**
- Modify: `src/components/compliance/DetailPageComponents.tsx`

### Background

The shared components `DetailPageHeader`, `DetailCard`, `InfoField`, `JsonBlock`, `ActionSection` use `bg-white`, `border-admin-border`, `text-brand-primary`. We update to `adm-*` tokens. All props/signatures stay identical.

Key visual changes:
- `DetailCard` header: dark panel bar (`bg-adm-card`) + 9px mono uppercase title
- `InfoField` label: `text-adm-t3 font-mono text-[9px] uppercase tracking-[0.1em]`
- `InfoField` accent: `text-adm-amber` instead of `text-brand-primary`
- `DetailPageHeader`: cleaned up — back link style, amber entity no display
- `JsonBlock`: keep dark `bg-gray-900` code block (already good)

- [ ] **Step 1: Replace full content of `src/components/compliance/DetailPageComponents.tsx`**

```tsx
import type { ReactNode } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text === '' ? '-' : text;
};

/* ── Detail Page Header ──────────────────────────────────────── */
export const DetailPageHeader = ({
  title,
  subtitle,
  onBack,
  onRefresh,
  refreshing = false,
  backLabel = 'Back',
  children,
}: {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  backLabel?: string;
  children?: ReactNode;
}) => (
  <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className={adminButtonClass('detailUtility')}>
            <ArrowLeft size={14} />
            {backLabel}
          </button>
          <button onClick={onRefresh} className={adminButtonClass('detailUtility')}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-1 font-mono text-lg font-semibold text-adm-amber">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  </div>
);

/* ── Detail Card ──────────────────────────────────────────────── */
export const DetailCard = ({
  title,
  icon,
  description,
  children,
  columns = 3,
}: {
  title: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) => {
  const gridCls =
    columns === 1
      ? 'grid grid-cols-1 gap-4'
      : columns === 2
        ? 'grid grid-cols-1 gap-4 md:grid-cols-2'
        : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-panel shadow-sm">
      {/* Card header bar */}
      <div className="flex items-center gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
        {icon ? <span className="text-adm-t3">{icon}</span> : null}
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
          {title}
        </span>
      </div>
      {/* Card body */}
      <div className="p-4">
        {description ? (
          <p className="mb-4 font-mono text-[11px] text-adm-t3">{description}</p>
        ) : null}
        <div className={gridCls}>{children}</div>
      </div>
    </div>
  );
};

/* ── Info Field ───────────────────────────────────────────────── */
export const InfoField = ({
  label,
  value,
  mono = false,
  accent = false,
  highlight = false,
  emptyLabel = '—',
  copyable = false,
  copied = false,
  isCopied = false,
  onCopy,
  link,
  source: _source,
  icon,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
  accent?: boolean;
  highlight?: boolean;
  emptyLabel?: string;
  copyable?: boolean;
  copied?: boolean;
  isCopied?: boolean;
  onCopy?: (value: string) => void;
  link?: string;
  source?: 'main' | 'kyc' | 'edd';
  icon?: ReactNode;
}) => {
  const normalized = formatValue(value);
  const hasValue = normalized !== '-';
  const displayValue = hasValue ? normalized : emptyLabel;
  const showCopied = copied || isCopied;

  const valueCls = [
    'mt-1 flex items-center gap-2 break-all',
    mono || accent || highlight ? 'font-mono text-[11px]' : 'text-[13px]',
    accent || highlight ? 'font-semibold text-adm-amber' : hasValue ? 'text-adm-t1' : 'text-adm-t3',
  ].join(' ');

  return (
    <div className="min-w-0">
      {/* Label */}
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">{label}</div>
      {/* Value */}
      <div className={valueCls}>
        {icon ? <span className="text-adm-t3">{icon}</span> : null}
        {link && hasValue ? (
          <a
            href={link}
            target={link.startsWith('/') ? undefined : '_blank'}
            rel={link.startsWith('/') ? undefined : 'noopener noreferrer'}
            className="inline-flex items-center gap-1 text-adm-amber hover:opacity-75"
          >
            {displayValue}
            <ExternalLink size={11} />
          </a>
        ) : (
          <span>{displayValue}</span>
        )}
        {copyable && hasValue && onCopy ? (
          <button
            onClick={() => onCopy(normalized)}
            className="shrink-0 rounded p-0.5 text-adm-t3 transition-colors hover:bg-adm-hover hover:text-adm-amber"
            title="Copy"
          >
            {showCopied ? <Check size={12} className="text-adm-green" /> : <Copy size={12} />}
          </button>
        ) : null}
      </div>
    </div>
  );
};

/* ── Json Block ───────────────────────────────────────────────── */
export const JsonBlock = ({
  title,
  value,
  compact = false,
}: {
  title: string;
  value: unknown;
  compact?: boolean;
}) => (
  <div className="min-w-0">
    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
      {title}
    </div>
    <pre
      className={`overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100 ${
        compact ? 'max-h-56' : 'max-h-96'
      }`}
    >
      {typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
    </pre>
  </div>
);

/* ── Action Section ───────────────────────────────────────────── */
export const ActionSection = ({
  title,
  description,
  emptyText,
  children,
}: {
  title: string;
  description?: string;
  emptyText?: string;
  children?: ReactNode;
}) => (
  <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-panel shadow-sm">
    <div className="border-b border-adm-border bg-adm-card px-4 py-2.5">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
        {title}
      </span>
    </div>
    <div className="p-4">
      {description ? (
        <p className="mb-3 font-mono text-[11px] text-adm-t3">{description}</p>
      ) : null}
      {children ?? (
        <div className="font-mono text-[11px] text-adm-t3">{emptyText ?? '—'}</div>
      )}
    </div>
  </div>
);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: no errors. If you see errors about `adm-*` being unknown colors, check that Task 1 (tailwind.config.js) was committed correctly.

- [ ] **Step 3: Visually spot-check any detail page**

Navigate to any existing detail page (e.g., an Audit Log Detail). Cards should now show the dark header bar + amber accent on highlighted fields.

- [ ] **Step 4: Commit**

```bash
git add src/components/compliance/DetailPageComponents.tsx
git commit -m "feat(admin-ui): reskin DetailCard, InfoField, DetailPageHeader to adm-* tokens"
```

---

## Task 6: Redesign `AuditLogsPage.tsx` — title bar, filter bar, new table columns

**Files:**
- Modify: `src/pages/AuditLogsPage.tsx`

### Background

**Keep all business logic untouched:** `FilterState`, `DEFAULT_FILTERS`, `PAGE_SIZE`, `buildSearchParams`, `fetchLogs`, `handleExportSelected`, `handleReset`, `toggleSelection`, `toggleSelectCurrentPage`, `selectSubjectAnchor`, all `useState`/`useEffect` hooks.

**What changes (JSX return only):**

1. Remove the current `<div className="space-y-6">` wrapper. Replace with a `flex flex-col h-full` layout that fills the DashboardLayout content area.
2. Replace the ad-hoc `<h1>` title section with `<PageTitleBar>`.
3. Replace the 14-field filter grid with a compact filter bar. Primary fields (always visible): Keyword/Audit No, Result, TriggerType, Actor No. Advanced fields (behind a toggle): Workflow No, Trace ID, Subject No, Entity Owner No, Date range, Include Archived.
4. Replace the 11-column table with a 7-column table: ☐ | Time | Audit No | Result | Action | Subject | Actor. The separate "Record / View" column is removed — clicking anywhere on the row navigates to detail.
5. Status left-border on the Audit No cell for visual status scanning.
6. Pagination + status bar pinned at the bottom.

**New import additions:** `AdminBadge`, `TriggerTag` from `../components/ui/AdminBadge`, `PageTitleBar` from `../components/ui/PageTitleBar`.

**New state addition:** `const [showAdvanced, setShowAdvanced] = useState(false);`

- [ ] **Step 1: Add new imports and `showAdvanced` state to `AuditLogsPage.tsx`**

At the top of the file, add to the existing imports:

```tsx
import { AdminBadge, TriggerTag } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
```

Inside `AuditLogsPage` component body, after existing `useState` declarations, add:

```tsx
const [showAdvanced, setShowAdvanced] = useState(false);
```

Remove the now-unused imports:
- `RefreshCw` is still used (keep it)
- `Search` is still used (keep it)
- `CheckSquare`, `Square`, `FileUp`, `X` are still used (keep all)

- [ ] **Step 2: Replace the `return (...)` block in `AuditLogsPage`**

Replace everything from `return (` to the closing `);` with:

```tsx
  /* ── Shared input className for filter inputs ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Page Title Bar ── */}
      <PageTitleBar
        title="Audit Logs"
        meta={`${total} records · Compliance & Risk`}
      >
        <button
          onClick={() => void handleExportSelected()}
          disabled={exporting || selectedIds.length === 0}
          className={adminButtonClass('listPrimary')}
        >
          <FileUp size={13} />
          {exporting
            ? 'Creating…'
            : selectedIds.length > 0
              ? `Create Package (${selectedIds.length})`
              : 'Create Evidence Package'}
        </button>
        <button
          onClick={() => navigate('/dashboard/audit/evidence-exports')}
          className={adminButtonClass('listSecondary')}
        >
          Evidence Packages
        </button>
        <button
          onClick={() => void fetchLogs(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Primary Filter Bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.keyword}
          onChange={(e) => setFilters((p) => ({ ...p, keyword: e.target.value }))}
          placeholder="Audit No / Keyword"
          className={`${fi} w-40`}
        />
        <select
          value={filters.result}
          onChange={(e) =>
            setFilters((p) => ({ ...p, result: e.target.value as FilterState['result'] }))
          }
          className={`${fi} w-32`}
        >
          <option value="">All Results</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILED">FAILED</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <select
          value={filters.triggerType}
          onChange={(e) =>
            setFilters((p) => ({
              ...p,
              triggerType: e.target.value as FilterState['triggerType'],
            }))
          }
          className={`${fi} w-44`}
        >
          <option value="">All Triggers</option>
          <option value="EVIDENCE_EXPORT">EVIDENCE_EXPORT</option>
          <option value="STATE_TRANSITION">STATE_TRANSITION</option>
          <option value="MANUAL_OVERRIDE">MANUAL_OVERRIDE</option>
          <option value="AUTH_EVENT">AUTH_EVENT</option>
          <option value="PERMISSION_CHANGE">PERMISSION_CHANGE</option>
          <option value="CONFIG_CHANGE">CONFIG_CHANGE</option>
          <option value="DATA_CREATE">DATA_CREATE</option>
          <option value="DATA_UPDATE">DATA_UPDATE</option>
          <option value="DATA_DELETE">DATA_DELETE</option>
          <option value="SYSTEM_EVENT">SYSTEM_EVENT</option>
        </select>
        <input
          value={filters.actorNo}
          onChange={(e) => setFilters((p) => ({ ...p, actorNo: e.target.value }))}
          placeholder="Actor No"
          className={`${fi} w-28`}
        />
        <button
          onClick={() => void fetchLogs(1, filters)}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button onClick={() => void handleReset()} className={adminButtonClass('listSecondary')}>
          Reset
        </button>
        <button
          onClick={() => setShowAdvanced((p) => !p)}
          className="ml-1 font-mono text-[10px] text-adm-t3 transition-colors hover:text-adm-amber"
        >
          {showAdvanced ? 'Less ▲' : 'Advanced ▾'}
        </button>
      </div>

      {/* ── Advanced Filter Bar ── */}
      {showAdvanced && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-bg/60 px-5 py-2">
          <input
            value={filters.workflowNo}
            onChange={(e) => setFilters((p) => ({ ...p, workflowNo: e.target.value }))}
            placeholder="Workflow No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.traceId}
            onChange={(e) => setFilters((p) => ({ ...p, traceId: e.target.value }))}
            placeholder="Trace ID"
            className={`${fi} w-36`}
          />
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((p) => ({ ...p, subjectNo: e.target.value }))}
            placeholder="Subject No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.entityOwnerNo}
            onChange={(e) => setFilters((p) => ({ ...p, entityOwnerNo: e.target.value }))}
            placeholder="Entity Owner No"
            className={`${fi} w-36`}
          />
          <input
            type="datetime-local"
            value={filters.startAt}
            onChange={(e) => setFilters((p) => ({ ...p, startAt: e.target.value }))}
            className={fi}
          />
          <input
            type="datetime-local"
            value={filters.endAt}
            onChange={(e) => setFilters((p) => ({ ...p, endAt: e.target.value }))}
            className={fi}
          />
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-adm-t2">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) =>
                setFilters((p) => ({ ...p, includeArchived: e.target.checked }))
              }
            />
            Include Archived
          </label>
        </div>
      )}

      {/* ── Message / Error banners ── */}
      {message && (
        <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green">
          {message}
          {lastExportId && (
            <button
              onClick={() => navigate('/dashboard/audit/evidence-exports')}
              className={adminButtonClass('rowLink', 'ml-3')}
            >
              View package →
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Selection bar ── */}
      {selectedIds.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-adm-amber/20 bg-adm-amber/5 px-5 py-2">
          <span className="font-mono text-[11px] text-adm-t2">
            {selectedIds.length} selected
          </span>
          <div className="h-3 w-px bg-adm-border" />
          <button
            onClick={() => setSelectedIds([])}
            className={adminButtonClass('listSecondary')}
          >
            <X size={12} />
            Deselect
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-9 border-b border-adm-border bg-adm-panel px-3 py-2">
                <button
                  onClick={toggleSelectCurrentPage}
                  className="text-adm-t3 hover:text-adm-amber transition-colors"
                  title="Select page"
                >
                  {allCurrentPageSelected ? (
                    <CheckSquare size={14} />
                  ) : (
                    <Square size={14} />
                  )}
                </button>
              </th>
              {(
                [
                  ['Time',     '110px'],
                  ['Audit No', '152px'],
                  ['Result',   '84px'],
                  ['Action',   'auto'],
                  ['Subject',  '180px'],
                  ['Actor',    '130px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  No audit logs found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => {
                const subjectAnchor = selectSubjectAnchor(item);
                const borderCls =
                  item.result === 'SUCCESS'
                    ? 'border-l-2 border-l-adm-green'
                    : item.result === 'FAILED'
                      ? 'border-l-2 border-l-adm-red'
                      : item.result === 'REJECTED'
                        ? 'border-l-2 border-l-adm-amber'
                        : '';
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/dashboard/audit/audit-logs/${item.id}`)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelection(item.id);
                        }}
                        className="text-adm-t3 hover:text-adm-amber transition-colors"
                      >
                        {selectedIdSet.has(item.id) ? (
                          <CheckSquare size={14} />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                    </td>
                    {/* Time — 2 lines */}
                    <td className="px-3 py-2.5 font-mono text-[10px] leading-relaxed text-adm-t2">
                      {new Date(item.occurredAt).toLocaleDateString()}
                      <br />
                      {new Date(item.occurredAt).toLocaleTimeString()}
                    </td>
                    {/* Audit No — amber + status left-border */}
                    <td className={`px-3 py-2.5 ${borderCls}`}>
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {item.auditNo}
                      </span>
                    </td>
                    {/* Result badge */}
                    <td className="px-3 py-2.5">
                      <AdminBadge value={item.result} />
                    </td>
                    {/* Action — main label + trigger tag */}
                    <td className="max-w-[240px] px-3 py-2.5">
                      <div className="text-[11px] leading-snug text-adm-t1">
                        {item.userActionLabel || item.userAction || item.action}
                      </div>
                      <div className="mt-1">
                        <TriggerTag value={item.triggerType} />
                      </div>
                    </td>
                    {/* Subject */}
                    <td className="px-3 py-2.5">
                      {subjectAnchor ? (
                        <>
                          <div className="font-mono text-[11px] font-semibold text-adm-amber">
                            {subjectAnchor.subjectNo}
                          </div>
                          <div className="font-mono text-[9px] text-adm-t3">
                            {subjectAnchor.subjectRole} / {subjectAnchor.subjectType}
                          </div>
                        </>
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>
                    {/* Actor */}
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[11px] font-semibold text-adm-amber">
                        {item.actorNo ?? item.actorId.slice(0, 8) + '…'}
                      </div>
                      <div className="font-mono text-[9px] text-adm-t3">{item.actorType}</div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchLogs(page, filters)}
        />
      </div>
    </div>
  );
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: no errors. Common issue: if `TriggerTag` import path is wrong — verify the relative path from `src/pages/` to `src/components/ui/`.

- [ ] **Step 4: Manually test the page**

In dev server, navigate to Audit Logs list. Verify:
- Title bar shows "Audit Logs" + record count
- Filter bar has 4 primary inputs + "Advanced ▾" toggle
- "Advanced ▾" click reveals secondary filter row
- Table shows 7 columns (☐ | Time | Audit No | Result | Action | Subject | Actor)
- Each row is clickable → navigates to detail
- Checkbox click (stop propagation) selects row without navigating
- Selected rows show selection bar at top
- "Create Package" button activates when rows selected

- [ ] **Step 5: Commit**

```bash
git add src/pages/AuditLogsPage.tsx
git commit -m "feat(admin-ui): redesign AuditLogsPage with amber design system"
```

---

## Task 7: Update `AuditLogDetailPage.tsx` — use AdminBadge, tighten layout

**Files:**
- Modify: `src/pages/AuditLogDetailPage.tsx`

### Background

The detail page already uses `DetailPageHeader` and `DetailCard` (updated in Task 5), so most of the visual change is automatic. This task handles the remaining inline styling: the status badge in the header, and the Subject Nos chips.

**Keep all business logic untouched:** `fetchDetail`, `useEffect`, `useParams`, `useState`.

- [ ] **Step 1: Add `AdminBadge` and `TriggerTag` imports to `AuditLogDetailPage.tsx`**

Add to existing imports at the top:

```tsx
import { AdminBadge, TriggerTag } from '../components/ui/AdminBadge';
```

- [ ] **Step 2: Remove the local `getStatusClassName` helper**

Delete these lines from `AuditLogDetailPage.tsx` (they are replaced by `AdminBadge`):

```tsx
const getStatusClassName = (result: AuditResult) => {
  switch (result) {
    case 'SUCCESS':
      return 'bg-green-100 text-green-700';
    case 'FAILED':
      return 'bg-red-100 text-red-700';
    case 'REJECTED':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};
```

- [ ] **Step 3: Update the `return (...)` block — replace inline badges and subject chips**

In the return JSX, find the `<DetailPageHeader>` children and replace:

```tsx
{/* OLD — remove these two spans */}
<span className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusClassName(detail.result)}`}>
  {detail.result}
</span>
<span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
  {detail.triggerType}
</span>
```

With:

```tsx
{/* NEW */}
<AdminBadge value={detail.result} />
<TriggerTag value={detail.triggerType} />
```

Then find the Subject Nos chips inside `DetailCard title="Subject Nos"` and replace:

```tsx
{/* OLD */}
<span
  key={subject.id}
  className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
>
  {subject.subjectRole} / {subject.subjectType} / {subject.subjectNo}
</span>
```

With:

```tsx
{/* NEW */}
<span
  key={subject.id}
  className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-card px-2.5 py-1 font-mono text-[10px] text-adm-t2"
>
  <span className="text-adm-t3">{subject.subjectRole}</span>
  <span className="text-adm-t3">/</span>
  <span>{subject.subjectType}</span>
  <span className="text-adm-t3">/</span>
  <span className="font-semibold text-adm-amber">{subject.subjectNo}</span>
</span>
```

Also update the loading spinner color:

```tsx
{/* OLD */}
<RefreshCw size={28} className="animate-spin text-brand-primary" />

{/* NEW */}
<RefreshCw size={28} className="animate-spin text-adm-amber" />
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manually test the detail page**

In dev server, click any audit log row to open detail. Verify:
- `DetailPageHeader` shows "← Back to Audit Logs" + "Refresh" buttons, amber audit no, status badge + trigger tag in header
- All `DetailCard` instances show the dark header bar with mono uppercase title
- `InfoField` labels are 9px mono uppercase muted, values are readable with amber for accented fields
- Subject Nos chips show the new structured style
- JSON payload blocks still display correctly

- [ ] **Step 6: Commit**

```bash
git add src/pages/AuditLogDetailPage.tsx
git commit -m "feat(admin-ui): update AuditLogDetailPage to use AdminBadge, adm-* tokens"
```

---

## Self-Review

**Spec coverage:**
- ✅ Design tokens (Task 1) — CSS variables + Tailwind mapping
- ✅ JetBrains Mono font (Task 1)
- ✅ Light/dark mode automatic switching (Task 1 CSS vars)
- ✅ StatusBadge component (Task 2 AdminBadge)
- ✅ TriggerTag component (Task 2)
- ✅ PageTitleBar (Task 3)
- ✅ Button variants updated (Task 4)
- ✅ DetailCard dark header bar (Task 5)
- ✅ InfoField amber accent + mono label (Task 5)
- ✅ AuditLogsPage 7-column table (Task 6)
- ✅ AuditLogsPage filter bar primary + advanced (Task 6)
- ✅ AuditLogsPage title bar (Task 6)
- ✅ Status left-border on table rows (Task 6)
- ✅ AuditLogDetailPage badges updated (Task 7)
- ✅ All business logic preserved (Tasks 6, 7)

**No placeholders found.** All tasks contain complete code.

**Type consistency:** `AdminBadge` imported as named export in both Tasks 6 and 7. `PageTitleBar` imported as named export in Task 6. `AdminButtonVariant` type unchanged — no breakage to callers.
