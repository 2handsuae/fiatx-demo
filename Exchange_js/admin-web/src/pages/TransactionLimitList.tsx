import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Types ───────────────────────────────────────────────────── */

type GateType = 'SINGLE' | 'CUMULATIVE' | 'LARGE_APPROVAL';

interface AssetOption {
  id: string;
  code: string;
  type: string;
}

interface RuleItem {
  id: string;
  ruleNo: string;
  gateType: GateType;
  operationType: string;
  assetId: string | null;
  tradingTier: string | null;
  period: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  defaultLimit: string | null;
  threshold: string | null;
  approvalCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const GATE_LABELS: Record<GateType, string> = {
  SINGLE: 'Single',
  CUMULATIVE: 'Cumulative',
  LARGE_APPROVAL: 'Large Approval',
};

const TYPE_FILTERS: { key: 'ALL' | GateType; label: string }[] = [
  { key: 'ALL', label: 'All Types' },
  { key: 'SINGLE', label: 'Single' },
  { key: 'CUMULATIVE', label: 'Cumulative' },
  { key: 'LARGE_APPROVAL', label: 'Large Approval' },
];

/* ── Helpers ─────────────────────────────────────────────────── */

const fmtAmount = (v?: string | null): string => {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return Number.isNaN(n)
    ? v
    : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
};

/** One-field "Applies To" — the target dimensions vary by gate type. */
const appliesTo = (r: RuleItem, assetCodeById: Map<string, string>): string => {
  if (r.gateType === 'SINGLE') return r.assetId ? assetCodeById.get(r.assetId) ?? '—' : '—';
  if (r.gateType === 'CUMULATIVE') return `${r.tradingTier ?? '—'} · ${r.period ?? '—'}`;
  return 'All'; // LARGE_APPROVAL
};

/** One-field "Limit" summary — the amount fields vary by gate type. */
const limitSummary = (r: RuleItem): string => {
  if (r.gateType === 'SINGLE') {
    const parts = [
      r.minAmount != null && r.minAmount !== '' ? `min ${fmtAmount(r.minAmount)}` : null,
      r.maxAmount != null && r.maxAmount !== '' ? `max ${fmtAmount(r.maxAmount)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' / ') : '—';
  }
  if (r.gateType === 'CUMULATIVE') return `${fmtAmount(r.defaultLimit)} AED`;
  return `≥ ${fmtAmount(r.threshold)} AED`; // LARGE_APPROVAL
};

/* ── Component ───────────────────────────────────────────────── */

const TransactionLimitList = () => {
  const navigate = useNavigate();

  const [typeFilter, setTypeFilter] = useState<'ALL' | GateType>('ALL');
  const [items, setItems] = useState<RuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assets, setAssets] = useState<AssetOption[]>([]);

  const requestSeqRef = useRef(0);

  /* ── Fetch assets (for the Single "Applies To" asset-code lookup) ── */
  const fetchAssets = async () => {
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`,
      );
      if (res.ok) {
        const data = (await res.json()) as { items: AssetOption[] };
        if (Array.isArray(data.items)) setAssets(data.items);
      }
    } catch {
      /* ignore */
    }
  };

  const assetCodeById = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((a) => map.set(a.id, a.code));
    return map;
  }, [assets]);

  /* ── Data fetching — one list of ALL rules; type filter is client-side ── */
  const fetchItems = async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-rules`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load rules.'));

      const data = (await res.json()) as RuleItem[];
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load rules.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
    void fetchAssets();
  }, []);

  const visibleItems = useMemo(
    () => (typeFilter === 'ALL' ? items : items.filter((r) => r.gateType === typeFilter)),
    [items, typeFilter],
  );

  /* ── Row ── */
  const goDetail = (ruleNo: string) =>
    navigate(`/admin/assets/transaction-limits/${ruleNo}`);

  /* ── Styles ── */
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title (no create — rules are a pre-configured, asset-derived grid; edit-only) ─── */}
      <PageTitleBar
        title="Transaction Limits"
        meta={`${visibleItems.length} rule${visibleItems.length === 1 ? '' : 's'}`}
      />

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-border bg-adm-danger/5 px-4 py-2 font-mono text-[11px] text-adm-danger">
          {error}
        </div>
      )}

      {/* ─── Zone 2: Type filter ─── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-adm-border px-4 py-2">
        <label className="font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
          Type
        </label>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'ALL' | GateType)}
          className="rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[11px] text-adm-t1 focus:border-adm-amber focus:outline-none"
        >
          {TYPE_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <button
          onClick={() => void fetchItems()}
          className={`${adminIconButtonClass()} ml-auto`}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ─── Zone 3: Table (unified columns) ─── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 150 }}>Rule No</th>
              <th className={th} style={{ width: 130 }}>Type</th>
              <th className={th} style={{ width: 120 }}>Operation</th>
              <th className={th} style={{ width: 160 }}>Applies To</th>
              <th className={th}>Limit</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No rules found
                </td>
              </tr>
            ) : (
              visibleItems.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover"
                  onClick={() => goDetail(r.ruleNo)}
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        goDetail(r.ruleNo);
                      }}
                      title={r.ruleNo}
                    >
                      {r.ruleNo}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={GATE_LABELS[r.gateType]} />
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={r.operationType} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {appliesTo(r, assetCodeById)}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t1">{limitSummary(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-4 py-2 text-[10px] text-adm-t3">
        <span>Showing {visibleItems.length} rules</span>
      </div>
    </div>
  );
};

export default TransactionLimitList;
