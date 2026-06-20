// admin-web/src/pages/ReconciliationCasesDetailPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface CaseLineItem {
  id: string;
  lineNo: number;
  matchStatus: string;
  internalSourceType: string | null;
  internalSourceNo: string | null;
  internalAmount: string | null;
  internalDirection: string | null;
  internalTxHash: string | null;
  externalSource: string | null;
  externalTxId: string | null;
  externalTxHash: string | null;
  externalAmount: string | null;
  externalDirection: string | null;
  externalTimestamp: string | null;
  resolutionMemo: string | null;
  status: string;
}

interface ReconCaseDetail {
  id: string;
  caseNo: string;
  businessDate: string;
  assetId: string;
  assetCode: string;
  layer: string;
  book: string | null; // CLIENT | FIRM (redesign per-book case); null for legacy I1–I5
  tbAmount: string;
  inTransitAmount: string;
  expectedExternal: string;
  actualExternal: string;
  deltaAmount: string;
  status: string;
  openedByRunId: string | null;
  closedByRunId: string | null;
  lastObservedRunId: string | null;
  slaDeadline: string | null;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: CaseLineItem[];
}

/* ── Constants ──────────────────────────────────────────────── */

// Bucket / match-status classes mapped onto the four available adm-* semantic colors.
// PASS (green) / AMOUNT_MISMATCH (red) / ORPHAN_* (amber) / MANUAL (blue) per spec §4.3.
const MATCH_TONE: Record<string, string> = {
  MATCHED: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
  PASS: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
  ORPHAN_INTERNAL: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
  ORPHAN_EXTERNAL: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
  AMOUNT_MISMATCH: 'border-adm-red/30 bg-adm-red/10 text-adm-red',
  MANUAL: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
};

const runRef = (id: string | null) => (id ? id.slice(0, 8) : null);
const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

// Bucketed line-item memo is "qualifier=… | signedδ=… | sub_account=… | channel_ref=… | …".
// Pull a single key out for compact display (sub_account + qualifier surface in the drilldown table).
const memoField = (memo: string | null, key: string): string | null => {
  if (!memo) return null;
  const m = memo.split('|').map((s) => s.trim()).find((s) => s.startsWith(`${key}=`));
  return m ? m.slice(key.length + 1) : null;
};

const MatchPill = ({ value }: { value: string }) => {
  const tone = MATCH_TONE[value] || 'border-adm-border bg-adm-bg text-adm-t2';
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-semibold ${tone}`}
    >
      {value}
    </span>
  );
};

/* ── Book (Client / Firm) — the layering axis (spec 2026-06-20 §3) ── */

// Client case → 式2/式4; Firm case → 式5. The case row stores the book's off-book formula
// (tbAmount=LHS internal pool, expectedExternal=RHS external±in-transit, deltaAmount=Δ).
const BOOK_META: Record<
  string,
  { label: string; tone: string; formula: string; formulaTag: string; lhsLabel: string }
> = {
  CLIENT: {
    label: 'Client',
    tone: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
    formula: 'Client Off-book (式4)',
    formulaTag: 'F4',
    lhsLabel: 'Client Pool (internal)',
  },
  FIRM: {
    label: 'Firm',
    tone: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
    formula: 'Firm Off-book (式5)',
    formulaTag: 'F5',
    lhsLabel: 'Firm Treasury (internal)',
  },
};
const bookMeta = (book: string | null) =>
  (book && BOOK_META[book]) || {
    label: book ?? 'Legacy',
    tone: 'border-adm-border bg-adm-bg text-adm-t2',
    formula: 'Off-book Tie-out',
    formulaTag: '—',
    lhsLabel: 'Internal',
  };

const BookBadge = ({ book }: { book: string | null }) => {
  const m = bookMeta(book);
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${m.tone}`}
    >
      {m.label}
    </span>
  );
};

// One side of the book's off-book formula (internal LHS vs external RHS, emphasized Δ).
const FormulaSideRow = ({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) => (
  <div
    className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
      emphasized ? 'border-adm-amber/40 bg-adm-amber/10' : 'border-adm-border bg-adm-bg'
    }`}
  >
    <span
      className={`font-mono text-[9px] uppercase tracking-[0.1em] ${emphasized ? 'font-semibold text-adm-amber' : 'text-adm-t3'}`}
    >
      {label}
    </span>
    <span
      className={`font-mono ${emphasized ? 'text-[15px] font-bold text-adm-amber' : 'text-[13px] text-adm-t1'}`}
    >
      {value}
    </span>
  </div>
);

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationCasesDetailPage = () => {
  const { caseNo } = useParams<{ caseNo: string }>();
  const navigate = useNavigate();
  const [kase, setKase] = useState<ReconCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCase = async () => {
    if (!caseNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}`,
      );
      if (res.ok) {
        setKase((await res.json()) as ReconCaseDetail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load reconciliation case'));
        navigate('/admin/reconciliation/cases');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch reconciliation case', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (caseNo) void fetchCase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseNo]);

  if (loading && !kase) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading reconciliation case...</p>
      </div>
    );
  }

  if (!kase) return null;

  const lineItems = kase.lineItems ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/reconciliation/cases')}
        onRefresh={fetchCase}
        refreshing={loading}
        backLabel="Cases"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="font-mono text-[19px] font-bold text-adm-amber">{kase.caseNo}</div>
              <BookBadge book={kase.book} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={kase.status} size="md" />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Book
                </span>
                <span className="font-mono text-adm-t1">{bookMeta(kase.book).label}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Currency
                </span>
                <span className="font-mono text-adm-t1">{kase.assetCode}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Delta
                </span>
                <span className="font-mono font-semibold text-adm-amber">{kase.deltaAmount}</span>
              </div>
            </div>
          </div>

          {/* 2. Off-book Tie-out for this book (Client → 式4 / Firm → 式5) */}
          <DetailCard title={`Off-book Tie-out · ${bookMeta(kase.book).formula}`} columns={1}>
            <div className="flex flex-col gap-2">
              <FormulaSideRow label={bookMeta(kase.book).lhsLabel} value={kase.tbAmount} />
              <FormulaSideRow label="External + In-Transit" value={kase.expectedExternal} />
              <FormulaSideRow label="Delta (internal − external)" value={kase.deltaAmount} emphasized />
            </div>
          </DetailCard>

          {/* 3. Anomaly Drilldown (4 buckets, scoped to this book's line items) */}
          <DetailCard
            title={`Anomaly Drilldown · ${bookMeta(kase.book).label} (${lineItems.length})`}
            columns={1}
          >
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    {['#', 'Bucket', 'Source Ref', 'Sub-account', 'Internal', 'External'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {lineItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                      >
                        No anomaly line items recorded for this case.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item) => {
                      const ref = item.internalTxHash || item.externalTxHash;
                      const subAccount = memoField(item.resolutionMemo, 'sub_account');
                      const qualifier = memoField(item.resolutionMemo, 'qualifier');
                      const channelRef = memoField(item.resolutionMemo, 'channel_ref');
                      return (
                        <tr key={item.id} className="transition-colors hover:bg-adm-hover">
                          <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                            {item.lineNo}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="space-y-1">
                              <MatchPill value={item.matchStatus} />
                              {qualifier ? (
                                <div className="font-mono text-[9px] text-adm-t3">{qualifier}</div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[11px]">
                            {ref ? (
                              <span className="font-mono text-adm-t1">
                                {ref.length > 16 ? `${ref.slice(0, 16)}…` : ref}
                              </span>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                            {channelRef ? (
                              <div className="font-mono text-[9px] text-adm-t3">ch:{channelRef}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-[11px]">
                            {subAccount ? (
                              <span className="font-mono text-adm-t1">{subAccount}</span>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-adm-t2">
                            {item.internalSourceNo || item.internalAmount ? (
                              <div className="space-y-0.5">
                                <div>
                                  <span className="text-adm-t3">
                                    {item.internalSourceType || '—'}
                                  </span>{' '}
                                  <span className="font-mono text-adm-t1">
                                    {item.internalSourceNo || '—'}
                                  </span>
                                </div>
                                <div className="font-mono text-adm-t1">
                                  {item.internalAmount || '—'}
                                  {item.internalDirection ? ` (${item.internalDirection})` : ''}
                                </div>
                              </div>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-adm-t2">
                            {item.externalSource || item.externalAmount ? (
                              <div className="space-y-0.5">
                                <div>
                                  <span className="text-adm-t3">{item.externalSource || '—'}</span>
                                </div>
                                <div className="font-mono text-adm-t1">
                                  {item.externalAmount || '—'}
                                  {item.externalDirection ? ` (${item.externalDirection})` : ''}
                                </div>
                              </div>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </DetailCard>

          {/* 4. Technical (LAST) */}
          <DetailCard title="Technical" columns={2}>
            <InfoField label="Trace ID" value={kase.traceId} mono />
            <InfoField label="Case ID" value={kase.id} mono />
            <InfoField label="Asset ID" value={kase.assetId} mono />
          </DetailCard>
        </div>

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Case No" value={kase.caseNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={kase.status} />} />
            <SidebarKV label="Book" value={<BookBadge book={kase.book} />} />
            <SidebarKV label="Currency" value={kase.assetCode} mono />
            <SidebarKV label="Delta" value={kase.deltaAmount} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Opened Run" value={runRef(kase.openedByRunId)} mono />
            <SidebarKV label="Closed Run" value={runRef(kase.closedByRunId)} mono />
            <SidebarKV label="Last Observed Run" value={runRef(kase.lastObservedRunId)} mono />
            <SidebarKV label="SLA Deadline" value={fmtTime(kase.slaDeadline)} mono />
            <SidebarKV label="Created" value={fmtTime(kase.createdAt)} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationCasesDetailPage;
