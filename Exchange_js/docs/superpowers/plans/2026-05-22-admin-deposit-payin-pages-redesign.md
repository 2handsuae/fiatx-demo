# Admin Deposit & Payin Pages Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full redesign of 4 admin pages (Deposit List, Deposit Detail, Payin List, Payin Detail) with compliance-first IA, bidirectional entity links, and frontend-admin.md compliance.

**Architecture:** Rewrite all 4 page files using existing shared primitives (`DetailPageHeader`, `DetailCard`, `InfoField`, `SidebarGroup`, `SidebarKV`, `LinkedRelationCard`, `AdminBadge`). Add 3 new shared utility functions and 1 new component. No backend changes.

**Tech Stack:** React, TypeScript, Tailwind CSS, adminFetch, lucide-react icons.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `admin-web/src/utils/depositActionMap.ts` | Deposit action enable/disable map + payin sim action map + compliance gate style |
| Modify | `admin-web/src/pages/DepositTransactionDetail.tsx` | Full rewrite: Hero → Compliance Gates → Transaction → Linked Payin → Timeline → Technical + Sidebar |
| Modify | `admin-web/src/pages/DepositTransactionList.tsx` | Rewrite: new filters + streamlined columns |
| Modify | `admin-web/src/pages/PayinDetail.tsx` | Full rewrite: Hero → Chain → Linked Deposit → Timeline → Technical + Sidebar with sim controls |
| Modify | `admin-web/src/pages/PayinList.tsx` | Rewrite: new filters + linked deposit column + bug fixes |
| Modify | `doc-final/rules/frontend-admin.md` | Add DepositTransaction + Payin to per-entity sidebar fields table |

---

### Task 1: Shared Utility — depositActionMap.ts

**Files:**
- Create: `admin-web/src/utils/depositActionMap.ts`

- [ ] **Step 1: Create the utility file with all three functions**

```typescript
// admin-web/src/utils/depositActionMap.ts

/* ── Deposit Action Map ─────────────────────────────────────────
   State-machine-aware action availability for the Deposit Detail
   sidebar. Each action knows its button style and which statuses
   enable it.
   ────────────────────────────────────────────────────────────── */

export interface DepositAction {
  action: string;
  label: string;
  /** workflowPrimary | workflowSecondary | workflowNegative */
  variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
  /** Whether a reason modal is required before executing */
  requiresReason: boolean;
  /** Ordered set of statuses where this action is enabled */
  enabledStatuses: Set<string>;
}

/**
 * Canonical ordered list of deposit actions.
 * Order: primary → secondary → negative (per frontend-admin.md).
 */
export const DEPOSIT_ACTIONS: DepositAction[] = [
  {
    action: 'approve',
    label: 'Approve',
    variant: 'workflowPrimary',
    requiresReason: false,
    enabledStatuses: new Set(['COMPLIANCE_PENDING', 'ACTION_PENDING', 'FROZEN']),
  },
  {
    action: 'freeze',
    label: 'Freeze',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['COMPLIANCE_PENDING', 'ACTION_PENDING']),
  },
  {
    action: 'resume',
    label: 'Resume',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['ACTION_PENDING']),
  },
  {
    action: 'expire',
    label: 'Expire',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['ACTION_PENDING']),
  },
  {
    action: 'reject',
    label: 'Reject',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['COMPLIANCE_PENDING', 'ACTION_PENDING']),
  },
  {
    action: 'confiscate',
    label: 'Confiscate',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['FROZEN']),
  },
];

/** Terminal statuses where no actions are available at all */
const TERMINAL_STATUSES = new Set([
  'SUCCESS', 'REJECTED', 'FAILED', 'EXPIRED', 'CONFISCATED',
]);

/**
 * Returns the full DEPOSIT_ACTIONS list annotated with `enabled` for
 * the given current status. Hides all actions for terminal statuses.
 */
export function getDepositActionsForStatus(
  currentStatus: string,
): Array<DepositAction & { enabled: boolean }> {
  const isTerminal = TERMINAL_STATUSES.has(currentStatus);
  return DEPOSIT_ACTIONS.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus),
  }));
}

/* ── Compliance Gate Styling ───────────────────────────────────── */

const GATE_PASS = new Set(['PASSED', 'ACTIVE', 'APPROVED', 'CLEAR', 'CLEARED']);
const GATE_PENDING = new Set(['PENDING', 'CREATED', 'RECEIVED']);
const GATE_FAIL = new Set(['FAILED', 'REJECTED', 'SUSPENDED', 'BLOCKED']);

export interface GateStyle {
  borderColor: string;
  textColor: string;
  label: string;
}

export function getComplianceGateStyle(value: string | null | undefined): GateStyle {
  const v = String(value || '').trim().toUpperCase();
  if (!v) return { borderColor: 'border-adm-border', textColor: 'text-adm-t3', label: 'N/A' };
  if (GATE_PASS.has(v)) return { borderColor: 'border-adm-green', textColor: 'text-adm-green', label: v };
  if (GATE_PENDING.has(v)) return { borderColor: 'border-adm-amber', textColor: 'text-adm-amber', label: v };
  if (GATE_FAIL.has(v)) return { borderColor: 'border-adm-red', textColor: 'text-adm-red', label: v };
  return { borderColor: 'border-adm-border', textColor: 'text-adm-t3', label: v };
}

/* ── Payin Simulation Action Map ──────────────────────────────── */

export interface PayinSimAction {
  event: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: PayinSimAction[] = [
  { event: 'MEMPOOL_SEEN',     label: '⚡ Mempool Seen',     enabledStatuses: new Set(['DETECTED']) },
  { event: 'CHAIN_CONFIRMED',  label: '⚡ Chain Confirmed',  enabledStatuses: new Set(['CONFIRMING']) },
  { event: 'DROPPED',          label: '⚡ Drop / Fail',      enabledStatuses: new Set(['CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: PayinSimAction[] = [
  { event: 'FIAT_CONFIRMED',   label: '⚡ Bank Received',    enabledStatuses: new Set(['DETECTED']) },
  { event: 'FIAT_FAILED',      label: '⚡ Fiat Failed',      enabledStatuses: new Set(['DETECTED']) },
];

const PAYIN_TERMINAL = new Set(['CLEARED', 'FAILED']);

export function getPayinSimActionsForStatus(
  currentStatus: string,
  type: string,
): Array<PayinSimAction & { enabled: boolean }> {
  const isTerminal = PAYIN_TERMINAL.has(currentStatus.toUpperCase());
  const actions = type.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}

/* ── Deposit Status Badge Colors ──────────────────────────────── */

const DEPOSIT_BADGE_MAP: Record<string, string> = {
  PAYIN_PENDING:       'bg-blue-100 text-blue-800',
  COMPLIANCE_PENDING:  'bg-purple-100 text-purple-800',
  ACTION_PENDING:      'bg-amber-100 text-amber-800',
  FROZEN:              'bg-cyan-100 text-cyan-800',
  SUCCESS:             'bg-green-100 text-green-800',
  REJECTED:            'bg-red-100 text-red-800',
  FAILED:              'bg-orange-100 text-orange-800',
  EXPIRED:             'bg-gray-100 text-gray-800',
  CONFISCATED:         'bg-red-200 text-red-900',
};

export function getDepositStatusBadgeClass(status: string): string {
  return DEPOSIT_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}

/* ── Payin Status Badge Colors ────────────────────────────────── */

const PAYIN_BADGE_MAP: Record<string, string> = {
  DETECTED:   'bg-blue-100 text-blue-800',
  CONFIRMING: 'bg-amber-100 text-amber-800',
  CONFIRMED:  'bg-indigo-100 text-indigo-800',
  CLEARED:    'bg-green-100 text-green-800',
  FAILED:     'bg-red-100 text-red-800',
};

export function getPayinStatusBadgeClass(status: string): string {
  return PAYIN_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit src/utils/depositActionMap.ts 2>&1 | head -20`

If tsc can't resolve paths, just verify by checking for syntax errors: `node -e "require('./src/utils/depositActionMap.ts')" 2>&1 || echo "TS file — check manually"`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/utils/depositActionMap.ts
git commit -m "feat(admin): add deposit action map and compliance gate style utilities"
```

---

### Task 2: Deposit Detail — Full Rewrite

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx` (819 lines → ~450 lines)

This is the most complex page. The rewrite follows the spec's Information Gradient:
Hero → Compliance Gates → Transaction Details → Linked Payin → Status History → Technical Detail.
Sidebar: Actions (all shown, disabled when unavailable) → Identity → Lifecycle.

- [ ] **Step 1: Rewrite DepositTransactionDetail.tsx**

The complete rewrite replaces the existing 819-line file. Key changes:
- Remove: `DetailPageHeader title/subtitle` props (nav shows back+refresh only)
- Remove: Workflow Summary card, Compatibility Signal Profile, duplicate Linked Rail
- Remove: All raw `id` fields from UI
- Remove: `getNextStepLabel()`, `getProjectedFinalStates()` (hardcoded speculation)
- Add: Hero section with depositNo in amber mono 19px
- Add: Compliance Gates three-card grid with color-coded borders
- Add: LinkedRelationCard for Payin link
- Add: Full sidebar with all 6 action buttons (state-aware disable)
- Add: SidebarGroup/SidebarKV for Identity (5 fields) + Lifecycle
- Preserve: StatusTimeline component, GateBadge component, reason modal for reject/confiscate
- Preserve: All existing API call patterns (adminFetch, error handling)
- Preserve: Status badge color scheme

```tsx
// admin-web/src/pages/DepositTransactionDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { AdminBadge } from '../components/ui/AdminBadge';
import { LinkedRelationCard } from '../components/ui/LinkedRelationCard';
import { copyToClipboard } from '../utils/clipboard';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';
import {
  formatStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import {
  getDepositActionsForStatus,
  getDepositStatusBadgeClass,
  getComplianceGateStyle,
} from '../utils/depositActionMap';

/* ── Types ──────────────────────────────────────────────────── */

interface DepositDetail {
  id: string;
  depositNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  type?: string | null;
  status: string;
  assetId: string;
  amount: string;
  netAmount: string;
  feeAmount: string;
  toWalletId: string;
  toWalletNo: string | null;
  toAddress: string | null;
  toIban: string | null;
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  kytStatus: string;
  kytRiskScore: number | null;
  kytCheckedAt: string | null;
  travelRuleRequired: boolean;
  travelRuleStatus: string;
  travelRuleCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  payinId: string | null;
  payinNo: string | null;
  payinStatus?: string | null;
  payinType?: string | null;
  traceId?: string | null;
  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  statusHistory: string | null;
  customer?: { complianceStatus?: string | null } | null;
}

/* ── Page Component ─────────────────────────────────────────── */

const DepositTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DepositDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [pendingAction, setPendingAction] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load detail'));
        navigate('/exchange/deposit-transactions');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  /* ── Action handlers ── */

  const handleAction = async (action: string, reason?: string) => {
    if (!id) return;
    setIsSubmitting(true);
    setActionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reason }),
        },
      );
      if (!response.ok) {
        setActionError(await getApiErrorMessage(response, 'Action failed.'));
        return;
      }
      await fetchData();
      setIsReasonModalOpen(false);
      setReasonText('');
      setPendingAction('');
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setActionError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onActionClick = (action: string, requiresReason: boolean) => {
    if (requiresReason) {
      setPendingAction(action);
      setIsReasonModalOpen(true);
    } else {
      handleAction(action);
    }
  };

  /* ── Loading / Empty ── */

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading details...</p>
      </div>
    );
  }

  if (!data) return null;

  const actions = getDepositActionsForStatus(data.status);
  const customerGate = getComplianceGateStyle(data.customer?.complianceStatus);
  const kytGate = getComplianceGateStyle(data.kytStatus);
  const trGate = getComplianceGateStyle(
    data.travelRuleRequired ? data.travelRuleStatus : null,
  );

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/exchange/deposit-transactions')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Deposits"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-adm-border">

          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.depositNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Status</span>
                <span className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getDepositStatusBadgeClass(data.status)}`}>
                  {formatStatusLabel(data.status)}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Amount</span>
                <span className="font-semibold text-adm-t1">{formatAssetAmount(data.amount, data.asset.decimals)} {data.asset.code}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Type</span>
                <span className="text-adm-t1">{formatTransactionTypeLabel(data.type || data.asset.type)}</span>
              </div>
              {data.ownerNo && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Owner</span>
                  <button
                    onClick={() => navigate(`/customers/${data.ownerId}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {data.ownerNo}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 2. Compliance Gates */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Compliance Gates
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {/* Gate 0: Customer */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${customerGate.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">Gate 0 · Customer</div>
                <div className={`mt-1 text-sm font-bold ${customerGate.textColor}`}>{customerGate.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">Sumsub</div>
              </div>
              {/* Gate 1: KYT */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${kytGate.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">Gate 1 · KYT</div>
                <div className={`mt-1 text-sm font-bold ${kytGate.textColor}`}>{kytGate.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">
                  Risk: {data.kytRiskScore ?? '—'}
                </div>
                <div className="font-mono text-[10px] text-adm-t3">
                  Checked: {data.kytCheckedAt ? new Date(data.kytCheckedAt).toLocaleString() : '—'}
                </div>
              </div>
              {/* Gate 2: Travel Rule */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${trGate.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">Gate 2 · Travel Rule</div>
                <div className={`mt-1 text-sm font-bold ${trGate.textColor}`}>
                  {data.travelRuleRequired ? trGate.label : 'NOT REQUIRED'}
                </div>
                {data.travelRuleRequired && (
                  <div className="mt-0.5 font-mono text-[10px] text-adm-t3">
                    Checked: {data.travelRuleCheckedAt ? new Date(data.travelRuleCheckedAt).toLocaleString() : '—'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3. Transaction Details */}
          <DetailCard title="Transaction Details" columns={2}>
            <InfoField label="Asset" value={`${data.asset.code} · ${data.asset.type} · ${data.asset.network || 'N/A'}`} />
            <InfoField label="Amount" value={formatAssetAmount(data.amount, data.asset.decimals)} accent />
            <InfoField label="Fee" value={formatAssetAmount(data.feeAmount, data.asset.decimals)} />
            <InfoField label="Net Amount" value={formatAssetAmount(data.netAmount, data.asset.decimals)} accent />
            <InfoField label="Tx Hash" value={data.txHash} copyable onCopy={(v) => handleCopy(v, 'txHash')} isCopied={copiedField === 'txHash'} mono />
            <InfoField label="From Address" value={data.fromAddress} copyable onCopy={(v) => handleCopy(v, 'fromAddr')} isCopied={copiedField === 'fromAddr'} mono />
            <InfoField label="To Wallet" value={data.toWalletNo} mono />
            <InfoField label="To Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'toAddr')} isCopied={copiedField === 'toAddr'} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
          </DetailCard>

          {/* 4. Linked Payin (conditional) */}
          {data.payinNo && (
            <div className="px-6 py-5">
              <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
                Linked Payin
              </h3>
              <LinkedRelationCard
                cap="Payin"
                identifier={data.payinNo}
                statusValue={data.payinStatus ? normalizeRailDisplayStatus(data.payinStatus) : undefined}
                meta={data.payinType ? formatTransactionTypeLabel(data.payinType) : undefined}
                onClick={() => navigate(`/dashboard/treasury/payins/${data.payinId}`)}
              />
            </div>
          )}

          {/* 5. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusTimeline historyJson={data.statusHistory} />
          </DetailCard>

          {/* 6. Technical Detail */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Technical Detail
            </h3>
            <InfoField label="Trace ID" value={data.traceId} mono />
            <div className="mt-3">
              <JsonBlock title="Status History (raw)" value={data.statusHistory} compact />
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">

          {/* Actions */}
          <SidebarGroup title="Actions">
            {actionError && <p className="mb-2 text-[11px] text-adm-red">{actionError}</p>}
            <div className="flex flex-col gap-2">
              {actions.map((a) => {
                const baseCls = a.variant === 'workflowPrimary'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : a.variant === 'workflowNegative'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300';
                return (
                  <button
                    key={a.action}
                    onClick={() => onActionClick(a.action, a.requiresReason)}
                    disabled={!a.enabled || isSubmitting}
                    className={`w-full rounded px-3 py-2 text-sm font-medium transition-colors ${baseCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isSubmitting && pendingAction === a.action ? 'Processing...' : a.label}
                  </button>
                );
              })}
            </div>
          </SidebarGroup>

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Deposit No" value={data.depositNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV
              label="Owner"
              value={
                data.ownerNo ? (
                  <button
                    onClick={() => navigate(`/customers/${data.ownerId}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {data.ownerNo}
                  </button>
                ) : null
              }
            />
            <SidebarKV label="Owner Type" value={data.ownerType} />
            <SidebarKV label="Asset" value={data.asset.code} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
          </SidebarGroup>
        </div>
      </div>

      {/* ── Reason Modal ── */}
      {isReasonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Reason Required</h3>
            <textarea
              className="w-full rounded border p-2 text-sm mb-4"
              rows={3}
              placeholder="Enter reason for this action..."
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setIsReasonModalOpen(false); setReasonText(''); setPendingAction(''); }}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction(pendingAction, reasonText)}
                disabled={isSubmitting || !reasonText.trim()}
                className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── StatusTimeline (preserved from existing) ── */

const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) return <div className="text-adm-t3 text-sm italic p-4 text-center">No history available</div>;

  let history: any[] = [];
  try {
    history = JSON.parse(historyJson);
    history.sort((a: any, b: any) =>
      new Date(b.timestamp || b.changedAt).getTime() -
      new Date(a.timestamp || a.changedAt).getTime(),
    );
  } catch {
    return <div className="text-adm-red text-sm p-4">Error parsing history</div>;
  }

  if (history.length === 0) return <div className="text-adm-t3 text-sm italic p-4 text-center">No events</div>;

  return (
    <div className="relative ml-4 space-y-6 border-l-2 border-adm-border my-2">
      {history.map((item: any, idx: number) => (
        <div key={idx} className="ml-8 relative">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className={`h-3 w-3 rounded-full ${getTimelineDotColor(item.status)}`} />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${getTimelineBadge(item.status)}`}>
                {formatStatusLabel(item.status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">{item.reason || 'No reason provided'}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">{item.operatorId || item.actorType || 'SYSTEM'}</span>
              <span>·</span>
              <time className="font-mono">
                {new Date(item.timestamp || item.changedAt).toLocaleString()}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const getTimelineDotColor = (status: string) => {
  const map: Record<string, string> = {
    SUCCESS: 'bg-green-500', FAILED: 'bg-orange-500', REJECTED: 'bg-red-500',
    CONFISCATED: 'bg-red-700', COMPLIANCE_PENDING: 'bg-purple-500',
    ACTION_PENDING: 'bg-amber-500', FROZEN: 'bg-cyan-500',
    PAYIN_PENDING: 'bg-blue-500', EXPIRED: 'bg-gray-400',
  };
  return map[status] || 'bg-gray-300';
};

const getTimelineBadge = (status: string) => {
  const map: Record<string, string> = {
    SUCCESS: 'bg-green-50 text-green-700 border-green-200',
    FAILED: 'bg-orange-50 text-orange-700 border-orange-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    CONFISCATED: 'bg-red-100 text-red-800 border-red-300',
    COMPLIANCE_PENDING: 'bg-purple-50 text-purple-700 border-purple-200',
    ACTION_PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    FROZEN: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    PAYIN_PENDING: 'bg-blue-50 text-blue-700 border-blue-200',
    EXPIRED: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  return map[status] || 'bg-gray-50 text-gray-700 border-gray-200';
};

export default DepositTransactionDetail;
```

- [ ] **Step 2: Verify the page renders**

Run dev server and navigate to a deposit detail page in the browser. Check:
- Hero section shows depositNo in amber
- Compliance Gates render three cards with correct gate colors
- Transaction Details show all fields
- Linked Payin card is clickable
- Sidebar: all 6 action buttons visible, correct ones enabled/disabled
- Sidebar: Identity shows 5 fields, Lifecycle shows timestamps
- No raw UUIDs visible anywhere

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/DepositTransactionDetail.tsx
git commit -m "feat(admin): rewrite deposit detail page with compliance-first IA"
```

---

### Task 3: Deposit List — Rewrite

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionList.tsx` (482 lines → ~280 lines)

- [ ] **Step 1: Rewrite DepositTransactionList.tsx**

Key changes:
- Replace filter bar: depositNo + ownerNo + status (9 V4) + type (Crypto/Fiat) + date range
- Remove: `assetIdFilter` state, `ownerId` filter, `toWalletId` filter, CSV export, raw ID columns
- Simplify table columns: depositNo (amber, clickable) · Status badge · Amount+Asset · Type · Owner (ownerNo) · Created · Chevron
- Add type filter to query params
- Fix: refetch on all filter changes via useEffect dependency array

```tsx
// admin-web/src/pages/DepositTransactionList.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatStatusLabel,
  formatTransactionTypeLabel,
} from '../utils/transactionRootDisplay';
import { getDepositStatusBadgeClass } from '../utils/depositActionMap';
import { Pagination } from '../components/common/Pagination';

interface DepositItem {
  id: string;
  depositNo: string;
  ownerNo: string | null;
  ownerId: string;
  ownerType: string;
  status: string;
  amount: string;
  type?: string | null;
  asset: { code: string; type: string; decimals?: number };
  createdAt: string;
}

const DEPOSIT_STATUSES = [
  'PAYIN_PENDING', 'COMPLIANCE_PENDING', 'ACTION_PENDING', 'FROZEN',
  'SUCCESS', 'REJECTED', 'FAILED', 'EXPIRED', 'CONFISCATED',
];

const DepositTransactionList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<DepositItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [depositNoFilter, setDepositNoFilter] = useState('');
  const [ownerNoFilter, setOwnerNoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const fetchList = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('skip', String((page - 1) * pageSize));
      params.append('take', String(pageSize));
      if (depositNoFilter) params.append('depositNo', depositNoFilter);
      if (ownerNoFilter) params.append('ownerNo', ownerNoFilter);
      if (statusFilter) params.append('status', statusFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      // Note: type filter is client-side since the backend doesn't have a type param yet
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load'));
      }
      const result = await response.json();
      let filteredItems = result.items || [];
      if (typeFilter) {
        filteredItems = filteredItems.filter(
          (i: DepositItem) => (i.type || i.asset.type)?.toUpperCase() === typeFilter.toUpperCase(),
        );
      }
      setItems(filteredItems);
      setTotal(result.total || 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [statusFilter, typeFilter, startDate, endDate, page]);

  const handleSearch = () => {
    setPage(1);
    fetchList();
  };

  return (
    <div className="space-y-6">
      {/* Title Bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Deposit Transactions</h1>
        <button onClick={fetchList} className={adminIconButtonClass()}>
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 border-b border-admin-border p-4">
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={depositNoFilter}
              onChange={(e) => setDepositNoFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Deposit No..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg py-2 pl-9 pr-3 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <input
              type="text"
              value={ownerNoFilter}
              onChange={(e) => setOwnerNoFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Owner No..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            {DEPOSIT_STATUSES.map((s) => (
              <option key={s} value={s}>{formatStatusLabel(s)}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            <option value="CRYPTO">Crypto</option>
            <option value="FIAT">Fiat</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          />
          <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
            Search
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Deposit No</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 text-right">Amount</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Owner</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-500">
                  <RefreshCw className="mx-auto animate-spin mb-2" size={24} /> Loading...
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-500">No deposits found</td></tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                    onClick={() => navigate(`/exchange/deposit-transactions/${item.id}`)}
                  >
                    <td className="px-6 py-3">
                      <span className="font-semibold text-amber-600">{item.depositNo}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getDepositStatusBadgeClass(item.status)}`}>
                        {formatStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${(item.type || item.asset.type)?.toUpperCase() === 'CRYPTO' ? 'text-amber-600' : 'text-blue-600'}`}>
                        {formatTransactionTypeLabel(item.type || item.asset.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-blue-600">{item.ownerNo || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-400">›</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="border-t border-admin-border p-4">
            <Pagination
              current={page}
              total={Math.ceil(total / pageSize)}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DepositTransactionList;
```

- [ ] **Step 2: Verify the list page renders**

Navigate to the deposit list. Check: new filters work, columns are correct, no raw IDs, chevron click navigates.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/DepositTransactionList.tsx
git commit -m "feat(admin): rewrite deposit list with enhanced filters and streamlined columns"
```

---

### Task 4: Payin Detail — Full Rewrite

**Files:**
- Modify: `admin-web/src/pages/PayinDetail.tsx` (617 lines → ~380 lines)

Key changes:
- Add sidebar (the existing page has NO sidebar)
- Add Hero section with payinNo in amber mono
- Add Linked Deposit section with LinkedRelationCard
- Move simulation controls to sidebar Actions block with `⚡ SIM` distinctive style
- Remove raw IDs, dual audit sections, SimulationRail from main body
- Follow same two-column layout as Deposit Detail

- [ ] **Step 1: Rewrite PayinDetail.tsx**

```tsx
// admin-web/src/pages/PayinDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { AdminBadge } from '../components/ui/AdminBadge';
import { LinkedRelationCard } from '../components/ui/LinkedRelationCard';
import { copyToClipboard } from '../utils/clipboard';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { useSimulationMode } from '../utils/simulationMode';
import {
  getPayinStatusBadgeClass,
  getPayinSimActionsForStatus,
} from '../utils/depositActionMap';

/* ── Types ── */

interface PayinDetailData {
  id: string;
  payinNo: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  type: string;
  status: string;
  displayStatus?: string | null;
  assetId: string;
  asset: { code: string; type: string; network: string | null; decimals: number };
  amount: string;
  toWalletId: string | null;
  toWalletNo: string | null;
  toAddress: string | null;
  toIban: string | null;
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  providerTxnId: string | null;
  transactionNo: string | null;
  depositId: string | null;
  receivedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: string | null;
  traceId?: string | null;
  deposit?: {
    depositNo: string;
    status: string;
  } | null;
}

/* ── Page ── */

const PayinDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PayinDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [simSubmitting, setSimSubmitting] = useState(false);
  const { enabled: simulationModeEnabled } = useSimulationMode();

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/treasury/payins/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load payin'));
        navigate('/dashboard/treasury/payins');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch payin', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSimEvent = async (event: string) => {
    setSimSubmitting(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/treasury/payins/${id}/mock-event`,
        { method: 'POST', body: JSON.stringify({ event }) },
      );
      if (response.ok) {
        const updated = await response.json();
        setData((prev) => (prev ? { ...prev, ...updated } : updated));
      } else {
        alert(await getApiErrorMessage(response, 'Simulation failed'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Sim failed', error);
    } finally {
      setSimSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading payin details...</p>
      </div>
    );
  }

  if (!data) return null;

  const normalizedStatus = normalizeRailDisplayStatus(data.displayStatus || data.status);
  const simActions = simulationModeEnabled
    ? getPayinSimActionsForStatus(normalizedStatus, data.type)
    : [];
  const linkedDepositNo = data.deposit?.depositNo || data.transactionNo;
  const linkedDepositStatus = data.deposit?.status;

  return (
    <div className="flex h-full flex-col">
      {/* Nav Header */}
      <DetailPageHeader
        onBack={() => navigate('/dashboard/treasury/payins')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Payins"
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex-1 overflow-y-auto divide-y divide-adm-border">

          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.payinNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Status</span>
                <span className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getPayinStatusBadgeClass(normalizedStatus)}`}>
                  {formatRailStatusLabel(normalizedStatus)}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Amount</span>
                <span className="font-semibold text-adm-t1">{formatAssetAmount(data.amount, data.asset.decimals)} {data.asset.code}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Type</span>
                <span className="text-adm-t1">{formatTransactionTypeLabel(data.type)}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Asset</span>
                <span className="text-adm-t1">{data.asset.code} · {data.asset.network || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* 2. Chain Details */}
          <DetailCard title="Chain Details" columns={2}>
            <InfoField label="Tx Hash" value={data.txHash} copyable onCopy={(v) => handleCopy(v, 'txHash')} isCopied={copiedField === 'txHash'} mono
              link={data.txHash && data.asset.type !== 'FIAT' ? `https://etherscan.io/tx/${data.txHash}` : undefined}
            />
            <InfoField label="Confirmations" value={data.confirmations?.toString()} />
            <InfoField label="From Address" value={data.fromAddress} copyable onCopy={(v) => handleCopy(v, 'from')} isCopied={copiedField === 'from'} mono />
            <InfoField label="To Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'to')} isCopied={copiedField === 'to'} mono />
            <InfoField label="From IBAN" value={data.fromIban} mono />
            <InfoField label="To IBAN" value={data.toIban} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
            <InfoField label="Provider Txn ID" value={data.providerTxnId} mono />
          </DetailCard>

          {/* 3. Linked Deposit (conditional) */}
          {linkedDepositNo && (
            <div className="px-6 py-5">
              <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
                Linked Deposit
              </h3>
              <LinkedRelationCard
                cap="Deposit"
                identifier={linkedDepositNo}
                statusValue={linkedDepositStatus || undefined}
                onClick={data.depositId ? () => navigate(`/exchange/deposit-transactions/${data.depositId}`) : undefined}
              />
            </div>
          )}

          {/* 4. Status History */}
          <DetailCard title="Status History" columns={1}>
            <PayinTimeline historyJson={data.statusHistory} />
          </DetailCard>

          {/* 5. Technical */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Technical Detail
            </h3>
            <InfoField label="Trace ID" value={data.traceId} mono />
            <div className="mt-3">
              <JsonBlock title="Status History (raw)" value={data.statusHistory} compact />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">

          {/* Simulation Actions (only in sim mode) */}
          {simulationModeEnabled && simActions.length > 0 && (
            <SidebarGroup title="Simulation Controls">
              <div className="rounded border border-dashed border-amber-400 bg-amber-900/20 p-2">
                <div className="mb-2 flex items-center gap-1 font-mono text-[9px] text-amber-400">
                  ⚡ SIM MODE
                </div>
                <div className="flex flex-col gap-1.5">
                  {simActions.map((a) => (
                    <button
                      key={a.event}
                      onClick={() => handleSimEvent(a.event)}
                      disabled={!a.enabled || simSubmitting}
                      className="w-full rounded border border-dashed border-amber-500/50 bg-amber-900/30 px-2 py-1.5 text-left font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {simSubmitting ? '...' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            </SidebarGroup>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Payin No" value={data.payinNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={normalizedStatus} />} />
            <SidebarKV label="Type" value={formatTransactionTypeLabel(data.type)} />
            <SidebarKV label="Asset" value={data.asset.code} />
            <SidebarKV
              label="Deposit"
              value={
                linkedDepositNo && data.depositId ? (
                  <button
                    onClick={() => navigate(`/exchange/deposit-transactions/${data.depositId}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {linkedDepositNo}
                  </button>
                ) : linkedDepositNo || null
              }
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Confirmed"
              value={data.confirmedAt ? new Date(data.confirmedAt).toLocaleString() : null}
              mono
            />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

/* ── PayinTimeline ── */

const PayinTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) return <div className="text-adm-t3 text-sm italic p-4 text-center">No history</div>;

  let history: any[] = [];
  try {
    history = JSON.parse(historyJson);
    history.sort((a: any, b: any) =>
      new Date(b.changedAt || b.timestamp).getTime() -
      new Date(a.changedAt || a.timestamp).getTime(),
    );
  } catch {
    return <div className="text-adm-red text-sm p-4">Error parsing history</div>;
  }

  if (!history.length) return <div className="text-adm-t3 text-sm italic p-4 text-center">No events</div>;

  const dotColor: Record<string, string> = {
    CLEARED: 'bg-green-500', FAILED: 'bg-red-500', CONFIRMED: 'bg-indigo-500',
    CONFIRMING: 'bg-amber-500', DETECTED: 'bg-blue-500',
  };
  const badgeCls: Record<string, string> = {
    CLEARED: 'bg-green-50 text-green-700 border-green-200',
    FAILED: 'bg-red-50 text-red-700 border-red-200',
    CONFIRMED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    CONFIRMING: 'bg-amber-50 text-amber-700 border-amber-200',
    DETECTED: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <div className="relative ml-4 space-y-6 border-l-2 border-adm-border my-2">
      {history.map((item: any, idx: number) => {
        const st = normalizeRailDisplayStatus(item.status);
        return (
          <div key={idx} className="ml-8 relative">
            <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
              <div className={`h-3 w-3 rounded-full ${dotColor[st] || 'bg-gray-300'}`} />
            </span>
            <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${badgeCls[st] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                {formatRailStatusLabel(st)}
              </span>
              <p className="mt-1 text-sm text-adm-t2">{item.reason || '—'}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
                <User size={10} />
                <span className="font-mono">{item.operatorId || 'SYSTEM'}</span>
                <span>·</span>
                <time className="font-mono">
                  {new Date(item.changedAt || item.timestamp).toLocaleString()}
                </time>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PayinDetail;
```

- [ ] **Step 2: Verify the page renders**

Navigate to a payin detail page. Check:
- Hero shows payinNo in amber
- Chain Details displays all chain info
- Linked Deposit card links to deposit detail
- Sidebar: simulation controls appear with ⚡ SIM style in sim mode
- Sidebar: Identity (5 fields) + Lifecycle
- No raw UUIDs visible

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/PayinDetail.tsx
git commit -m "feat(admin): rewrite payin detail with sidebar and simulation controls"
```

---

### Task 5: Payin List — Rewrite

**Files:**
- Modify: `admin-web/src/pages/PayinList.tsx` (293 lines → ~260 lines)

- [ ] **Step 1: Rewrite PayinList.tsx**

Key changes:
- Add filters: payinNo, txHash, status, type, date range
- Add Linked Deposit column
- Fix: txHash filter triggers refetch (add to useEffect deps)
- Fix: normalize CLEAR → CLEARED
- Remove: raw IDs, overly complex column structure

```tsx
// admin-web/src/pages/PayinList.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { getPayinStatusBadgeClass } from '../utils/depositActionMap';

interface PayinItem {
  id: string;
  payinNo: string;
  status: string;
  displayStatus?: string | null;
  type: string;
  amount: string;
  asset: { code: string; type: string; decimals?: number };
  txHash: string | null;
  depositId: string | null;
  transactionNo: string | null;
  deposit?: { depositNo: string } | null;
  createdAt?: string;
  receivedAt: string | null;
}

const PAYIN_STATUSES = ['DETECTED', 'CONFIRMING', 'CONFIRMED', 'CLEARED', 'FAILED'];

const PayinList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<PayinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [payinNoFilter, setPayinNoFilter] = useState('');
  const [txHashFilter, setTxHashFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchList = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (txHashFilter) params.append('txHash', txHashFilter);
      if (payinNoFilter) params.append('payinNo', payinNoFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/treasury/payins?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load payins'));
      }
      const result = await response.json();
      let filtered = result.items || [];
      if (typeFilter) {
        filtered = filtered.filter(
          (i: PayinItem) => i.type?.toUpperCase() === typeFilter.toUpperCase(),
        );
      }
      setItems(filtered);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [statusFilter, typeFilter, startDate, endDate]);

  const handleSearch = () => fetchList();

  const truncateHash = (hash: string | null) => {
    if (!hash || hash.length < 14) return hash || '—';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Payin Transactions</h1>
        <button onClick={fetchList} className={adminIconButtonClass()}>
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 border-b border-admin-border p-4">
          <div className="relative flex-1 min-w-[140px] max-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={payinNoFilter}
              onChange={(e) => setPayinNoFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Payin No..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg py-2 pl-9 pr-3 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <input
              type="text"
              value={txHashFilter}
              onChange={(e) => setTxHashFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Tx Hash..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            {PAYIN_STATUSES.map((s) => (
              <option key={s} value={s}>{formatRailStatusLabel(s)}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            <option value="CRYPTO">Crypto</option>
            <option value="FIAT">Fiat</option>
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm" />
          <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>Search</button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Payin No</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 text-right">Amount</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Tx Hash</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Deposit</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">
                  <RefreshCw className="mx-auto animate-spin mb-2" size={24} /> Loading...
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">No payins found</td></tr>
              ) : (
                items.map((item) => {
                  const ns = normalizeRailDisplayStatus(item.displayStatus || item.status);
                  const depNo = item.deposit?.depositNo || item.transactionNo;
                  return (
                    <tr
                      key={item.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      onClick={() => navigate(`/dashboard/treasury/payins/${item.id}`)}
                    >
                      <td className="px-6 py-3 font-semibold text-amber-600">{item.payinNo}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPayinStatusBadgeClass(ns)}`}>
                          {formatRailStatusLabel(ns)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold ${item.type?.toUpperCase() === 'CRYPTO' ? 'text-amber-600' : 'text-blue-600'}`}>
                          {formatTransactionTypeLabel(item.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{truncateHash(item.txHash)}</td>
                      <td className="px-4 py-3 text-blue-600 text-xs">{depNo || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {(item.createdAt || item.receivedAt) ? new Date(item.createdAt || item.receivedAt!).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-400">›</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PayinList;
```

- [ ] **Step 2: Verify the list page renders**

Navigate to payin list. Check: new filters, linked deposit column, txHash truncated, status badges correct, CLEAR → CLEARED normalized.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/PayinList.tsx
git commit -m "feat(admin): rewrite payin list with enhanced filters and linked deposit column"
```

---

### Task 6: Documentation Update

**Files:**
- Modify: `doc-final/rules/frontend-admin.md`

- [ ] **Step 1: Add DepositTransaction and Payin to per-entity sidebar fields table**

Add two new rows to the table at the end of the "Per-entity Sidebar Fields" section:

```markdown
| **DepositTransaction** | `depositNo`, `status` badge, `ownerNo`, `ownerType`, `asset.code` | `createdAt`, `completedAt` |
| **Payin** | `payinNo`, `status` badge, `type`, `asset.code`, linked `depositNo` | `createdAt`, `completedAt` |
```

- [ ] **Step 2: Commit**

```bash
git add doc-final/rules/frontend-admin.md
git commit -m "docs: add DepositTransaction and Payin to per-entity sidebar fields table"
```

---

### Task 7: Integration Verification

- [ ] **Step 1: Start the dev stack**

```bash
cd Exchange_js && npm run dev:start
```

Wait for all services to be ready on ports 3500/3501/3502.

- [ ] **Step 2: Verify Deposit List**

Navigate to `http://localhost:3501` → Deposit Transactions.
Check:
- Page loads without errors
- All 6 filter controls visible: Deposit No, Owner No, Status, Type, Start Date, End Date
- Status dropdown has all 9 V4 statuses
- Table columns: Deposit No (amber) · Status · Amount · Type · Owner · Created · Chevron
- Row click navigates to detail
- No raw UUIDs anywhere

- [ ] **Step 3: Verify Deposit Detail**

Click into a deposit. Check:
- Hero: depositNo (amber 19px), status badge, amount, type, owner (clickable)
- Compliance Gates: 3 cards with color-coded borders
- Transaction Details: all fields, no raw IDs
- Linked Payin: clickable card (if payin exists)
- Status History: timeline
- Sidebar: all 6 action buttons (correct ones enabled/disabled)
- Sidebar: Identity (5 fields) + Lifecycle
- Clicking action buttons works (test approve on a COMPLIANCE_PENDING deposit)

- [ ] **Step 4: Verify Payin List**

Navigate to Payins list. Check:
- Filters: Payin No, Tx Hash, Status, Type, Dates
- Columns: Payin No · Status · Amount · Type · Tx Hash (truncated) · Deposit · Created · Chevron
- Linked Deposit column shows depositNo

- [ ] **Step 5: Verify Payin Detail**

Click into a payin. Check:
- Hero: payinNo (amber), status, amount, type, asset
- Chain Details: txHash, addresses, confirmations
- Linked Deposit: clickable card
- Sidebar: simulation controls with ⚡ SIM style (if sim mode on)
- Sidebar: Identity (5 fields) + Lifecycle
- No raw UUIDs

- [ ] **Step 6: Verify bidirectional links**

From Deposit Detail → click Linked Payin → arrives at Payin Detail.
From Payin Detail → click Linked Deposit → arrives at Deposit Detail.

- [ ] **Step 7: Commit verification result**

If all checks pass, no additional commit needed (all code already committed).
If fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(admin): address integration issues found during verification"
```
