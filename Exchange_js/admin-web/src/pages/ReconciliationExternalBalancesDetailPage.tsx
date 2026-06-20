// admin-web/src/pages/ReconciliationExternalBalancesDetailPage.tsx
import { useEffect, useState, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ChevronRight } from 'lucide-react';
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

interface StatementLine {
  id: string;
  direction: string; // IN | OUT
  amount: string;
  externalRef: string | null;
  channelRef: string | null;
  subAccount: string | null;
  datetime: string;
  balanceAfter: string | null;
  description: string | null;
  raw: string | null;
}

interface ExternalBalanceDetail {
  id: string;
  source: string;
  accountRef: string;
  currency: string;
  book: string;
  cutoffDate: string;
  closingBalance: string;
  openingBalance: string | null;
  asOfAt: string | null;
  lineCount: number | null;
  status: string | null;
  statementId: string | null;
  ingestedAt: string | null;
  lines: StatementLine[];
}

/* ── Helpers ────────────────────────────────────────────────── */

const BOOK_TONE: Record<string, string> = {
  CLIENT: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  FIRM: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
};

const fmtAmount = (v: string | number | null) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};
const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

/* ── Component ──────────────────────────────────────────────── */

const ReconciliationExternalBalancesDetailPage = () => {
  const { statementId } = useParams<{ statementId: string }>();
  const navigate = useNavigate();
  const [bal, setBal] = useState<ExternalBalanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchBalance = async () => {
    if (!statementId) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/external-balances/${encodeURIComponent(statementId)}`,
      );
      if (res.ok) {
        setBal((await res.json()) as ExternalBalanceDetail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load external balance'));
        navigate('/admin/reconciliation/external-balances');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch external balance', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpanded(new Set());
    if (statementId) void fetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementId]);

  if (loading && !bal) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading external balance…</p>
      </div>
    );
  }
  if (!bal) return null;

  const lines = bal.lines ?? [];
  const neg = Number(bal.closingBalance) < 0;

  // Roll-forward self-check: opening + Σ(IN − OUT) should equal closing.
  const net = lines.reduce(
    (s, l) => s + (l.direction === 'IN' ? Number(l.amount) : -Number(l.amount)),
    0,
  );
  const opening = Number(bal.openingBalance ?? 0);
  const closing = Number(bal.closingBalance);
  const drift = opening + net - closing;
  const continuous = Math.abs(drift) < 0.01;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        onBack={() => navigate('/admin/reconciliation/external-balances')}
        onRefresh={fetchBalance}
        refreshing={loading}
        backLabel="External Balances"
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[18px] font-bold text-adm-amber">{bal.source}</span>
              <span className="font-mono text-[16px] text-adm-t1">{bal.accountRef}</span>
              <span
                className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${BOOK_TONE[bal.book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}
              >
                {bal.book}
              </span>
              <span className="font-mono text-[12px] text-adm-t3">{bal.currency}</span>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-adm-t3">Closing</span>
              <span className={`font-mono text-[22px] font-bold ${neg ? 'text-adm-red' : 'text-adm-t1'}`}>
                {fmtAmount(bal.closingBalance)}
              </span>
            </div>
          </div>

          {/* 2. Header fields */}
          <DetailCard title="Balance" columns={2}>
            <InfoField label="Opening" value={fmtAmount(bal.openingBalance)} mono />
            <InfoField label="Closing" value={fmtAmount(bal.closingBalance)} mono />
            <InfoField label="Lines" value={String(bal.lineCount ?? lines.length)} mono />
            <InfoField label="Cutoff Date" value={bal.cutoffDate} mono />
            <InfoField label="As Of" value={fmtTime(bal.asOfAt)} mono />
            <InfoField label="Source" value={bal.source} />
            <InfoField label="Currency" value={bal.currency} mono />
            <InfoField label="Status" value={bal.status ?? '—'} />
          </DetailCard>

          {/* 3. Roll-forward self-check */}
          <div className="bg-adm-card px-6 py-4">
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 ${continuous ? 'border-adm-green/30 bg-adm-green/10' : 'border-adm-red/30 bg-adm-red/10'}`}
            >
              <span
                className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${continuous ? 'text-adm-green' : 'text-adm-red'}`}
              >
                {continuous ? <Check size={14} /> : <AlertTriangle size={14} />}
                {continuous ? 'Roll-forward continuous' : `Roll-forward discontinuity Δ ${fmtAmount(drift)}`}
              </span>
              <span className="font-mono text-[11px] text-adm-t2">
                opening {fmtAmount(opening)} + Σnet {fmtAmount(net)} = closing {fmtAmount(closing)}
              </span>
            </div>
          </div>

          {/* 4. Statement lines */}
          <DetailCard title={`Statement Lines · ${lines.length}`} columns={1}>
            {lines.length === 0 ? (
              <p className="py-6 text-center font-mono text-[11px] text-adm-t3">No lines on this account.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      {['', 'Datetime', 'Dir', 'Amount', 'External Ref', 'Sub-account', 'Bal After', 'Description'].map(
                        (h) => (
                          <th
                            key={h}
                            className={`px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 ${h === 'Amount' || h === 'Bal After' ? 'text-right' : 'text-left'}`}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {lines.map((l) => {
                      const isIn = l.direction === 'IN';
                      const open = expanded.has(l.id);
                      return (
                        <Fragment key={l.id}>
                          <tr
                            className="cursor-pointer transition-colors hover:bg-adm-hover"
                            onClick={() => toggle(l.id)}
                          >
                            <td className="px-3 py-2.5 text-adm-t3">
                              <ChevronRight
                                size={13}
                                className={`transition-transform ${open ? 'rotate-90' : ''}`}
                              />
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                              {fmtTime(l.datetime)}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`font-mono text-[10px] font-semibold ${isIn ? 'text-adm-green' : 'text-adm-red'}`}
                              >
                                {l.direction}
                              </span>
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono text-[11px] ${isIn ? 'text-adm-t1' : 'text-adm-red'}`}
                            >
                              {fmtAmount(l.amount)}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                              {l.externalRef ?? <span className="text-adm-t3">—</span>}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                              {l.subAccount ?? <span className="text-adm-t3">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t3">
                              {fmtAmount(l.balanceAfter)}
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-adm-t2">{l.description ?? '—'}</td>
                          </tr>
                          {open && (
                            <tr className="bg-adm-bg">
                              <td />
                              <td colSpan={7} className="px-3 py-2.5">
                                <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-adm-t3">
                                  {l.channelRef && (
                                    <span>
                                      channelRef <span className="text-adm-t2">{l.channelRef}</span>
                                    </span>
                                  )}
                                </div>
                                <pre className="overflow-x-auto rounded border border-adm-border bg-adm-panel px-3 py-2 font-mono text-[10px] leading-relaxed text-adm-t2">
                                  {l.raw ?? '(no raw payload)'}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DetailCard>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Source" value={bal.source} />
            <SidebarKV label="Account" value={bal.accountRef} mono />
            <SidebarKV label="Book" value={bal.book} mono />
            <SidebarKV label="Currency" value={bal.currency} mono />
            <SidebarKV label="Cutoff" value={bal.cutoffDate} mono />
          </SidebarGroup>

          <SidebarGroup title="Ingest">
            <SidebarKV label="Statement" value={bal.statementId} mono />
            <SidebarKV label="Status" value={bal.status ? <StatusPill value={bal.status} /> : '—'} />
            <SidebarKV label="Ingested" value={fmtTime(bal.ingestedAt)} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationExternalBalancesDetailPage;
