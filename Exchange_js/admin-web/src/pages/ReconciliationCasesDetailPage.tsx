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
  externalAmount: string | null;
  externalDirection: string | null;
  externalTimestamp: string | null;
  status: string;
}

interface ReconCaseDetail {
  id: string;
  caseNo: string;
  businessDate: string;
  assetId: string;
  assetCode: string;
  layer: string;
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

// Match-status classes mapped onto the four available adm-* semantic colors.
const MATCH_TONE: Record<string, string> = {
  MATCHED: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
  ORPHAN_INTERNAL: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
  ORPHAN_EXTERNAL: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
  AMOUNT_MISMATCH: 'border-adm-red/30 bg-adm-red/10 text-adm-red',
};

const runRef = (id: string | null) => (id ? id.slice(0, 8) : null);
const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

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

/* ── Three-layer ladder row (adm-* tokens) ── */

const LadderRow = ({
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
      emphasized
        ? 'border-adm-amber/40 bg-adm-amber/10'
        : 'border-adm-border bg-adm-bg'
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
            <div className="font-mono text-[19px] font-bold text-adm-amber">{kase.caseNo}</div>
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
                  Asset
                </span>
                <span className="font-mono text-adm-t1">{kase.assetCode}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Layer
                </span>
                <span className="font-mono text-adm-t1">{kase.layer}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Delta
                </span>
                <span className="font-mono font-semibold text-adm-amber">{kase.deltaAmount}</span>
              </div>
            </div>
          </div>

          {/* 2. Three-Layer Comparison */}
          <DetailCard title="Three-Layer Comparison" columns={1}>
            <div className="flex flex-col gap-2">
              <LadderRow label="TB Ledger" value={kase.tbAmount} />
              <LadderRow label="In-Transit Adjustment" value={kase.inTransitAmount} />
              <LadderRow label="Expected External" value={kase.expectedExternal} />
              <LadderRow label="Actual External" value={kase.actualExternal} />
              <LadderRow label="Delta" value={kase.deltaAmount} emphasized />
            </div>
          </DetailCard>

          {/* 3. Line Items */}
          <DetailCard title={`Line Items (${lineItems.length})`} columns={1}>
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    {['Line No', 'Match', 'Internal', 'External', 'Status'].map((h) => (
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
                        colSpan={5}
                        className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                      >
                        No line items recorded for this case.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item) => (
                      <tr key={item.id} className="transition-colors hover:bg-adm-hover">
                        <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                          {item.lineNo}
                        </td>
                        <td className="px-3 py-2.5">
                          <MatchPill value={item.matchStatus} />
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
                              {item.internalTxHash ? (
                                <div className="font-mono text-[10px] text-adm-t3">
                                  {item.internalTxHash.slice(0, 14)}…
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-adm-t3">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-adm-t2">
                          {item.externalTxId || item.externalAmount ? (
                            <div className="space-y-0.5">
                              <div>
                                <span className="text-adm-t3">{item.externalSource || '—'}</span>{' '}
                                <span className="font-mono text-adm-t1">
                                  {item.externalTxId || '—'}
                                </span>
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
                        <td className="px-3 py-2.5">
                          <StatusPill value={item.status} />
                        </td>
                      </tr>
                    ))
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
            <SidebarKV label="Asset" value={kase.assetCode} mono />
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
