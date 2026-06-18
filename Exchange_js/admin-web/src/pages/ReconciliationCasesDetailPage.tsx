// admin-web/src/pages/ReconciliationCasesDetailPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Layers, GitBranch } from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  StatusBadge,
  DetailCard,
  InfoField,
} from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';

/* ── Interfaces ──────────────────────────────────────────────── */

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
  reimbursementObligationId: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: CaseLineItem[];
}

/* ── Constants ───────────────────────────────────────────────── */

const MATCH_STATUS_COLORS: Record<string, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-800',
  ORPHAN_INTERNAL: 'bg-amber-100 text-amber-800',
  ORPHAN_EXTERNAL: 'bg-orange-100 text-orange-800',
  AMOUNT_MISMATCH: 'bg-rose-100 text-rose-800',
};

const shortId = (id: string | null) => (id ? id.slice(0, 12) : '—');

/* ── Three-layer ladder row ── */

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
        ? 'border-brand-primary/40 bg-brand-primary/5'
        : 'border-admin-border bg-admin-content-bg'
    }`}
  >
    <span className={`text-sm ${emphasized ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      {label}
    </span>
    <span
      className={`font-mono ${emphasized ? 'text-base font-bold text-brand-primary' : 'text-sm text-gray-900'}`}
    >
      {value}
    </span>
  </div>
);

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationCasesDetailPage = () => {
  const { caseNo } = useParams<{ caseNo: string }>();
  const navigate = useNavigate();
  const [kase, setKase] = useState<ReconCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCase = async () => {
    if (!caseNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation case.'));
      const result = (await res.json()) as ReconCaseDetail;
      setKase(result);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation case.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseNo]);

  const lineItems = kase?.lineItems ?? [];

  return (
    <div className="min-h-full bg-admin-content-bg p-6">
      {/* ── Back + Refresh ── */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/admin/reconciliation/cases')}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to Cases
        </button>
        <button
          onClick={() => void fetchCase()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !kase && (
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {kase && (
        <div className="space-y-6">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-gray-900">{kase.caseNo}</h1>
            <span className="font-mono text-sm font-semibold text-brand-primary">
              {kase.assetCode}
            </span>
            <StatusBadge value={kase.status} />
          </div>

          {/* ── 三层数字对比 (ladder) ── */}
          <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <div className="text-brand-primary">
                <Layers size={18} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">三层数字对比</h2>
            </div>
            <div className="space-y-2">
              <LadderRow label="TB 账面" value={kase.tbAmount} />
              <LadderRow label="in-transit 扣减" value={kase.inTransitAmount} />
              <LadderRow label="期望外部" value={kase.expectedExternal} />
              <LadderRow label="实测外部" value={kase.actualExternal} />
              <LadderRow label="差额 Δ" value={kase.deltaAmount} emphasized />
            </div>
          </div>

          {/* ── Case 生命周期 ── */}
          <DetailCard title="Case 生命周期" icon={<GitBranch size={18} />}>
            <InfoField label="Opened By Run" value={shortId(kase.openedByRunId)} mono />
            <InfoField label="Closed By Run" value={shortId(kase.closedByRunId)} mono />
            <InfoField label="Last Observed Run" value={shortId(kase.lastObservedRunId)} mono />
            <InfoField label="SLA Deadline" value={formatDateTime(kase.slaDeadline)} />
            <InfoField label="Business Date" value={kase.businessDate} mono />
            <InfoField label="Layer" value={kase.layer} mono />
          </DetailCard>

          {/* ── 逐笔 line items ── */}
          <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">
                逐笔 line items ({lineItems.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-admin-border bg-admin-content-bg">
                  <tr>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">#</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">Match</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">Internal</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">External</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">
                        No line items recorded for this case.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                          {item.lineNo}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge value={item.matchStatus} colors={MATCH_STATUS_COLORS} />
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-700">
                          {item.internalSourceNo || item.internalAmount ? (
                            <div className="space-y-0.5">
                              <div>
                                <span className="text-gray-500">
                                  {item.internalSourceType || '-'}
                                </span>{' '}
                                <span className="font-mono">{item.internalSourceNo || '-'}</span>
                              </div>
                              <div className="font-mono text-gray-900">
                                {item.internalAmount || '-'}
                                {item.internalDirection ? ` (${item.internalDirection})` : ''}
                              </div>
                              {item.internalTxHash ? (
                                <div className="font-mono text-[10px] text-gray-400">
                                  {item.internalTxHash.slice(0, 14)}…
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-700">
                          {item.externalTxId || item.externalAmount ? (
                            <div className="space-y-0.5">
                              <div>
                                <span className="text-gray-500">{item.externalSource || '-'}</span>{' '}
                                <span className="font-mono">{item.externalTxId || '-'}</span>
                              </div>
                              <div className="font-mono text-gray-900">
                                {item.externalAmount || '-'}
                                {item.externalDirection ? ` (${item.externalDirection})` : ''}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge value={item.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReconciliationCasesDetailPage;
