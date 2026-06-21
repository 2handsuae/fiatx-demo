// admin-web/src/pages/ReconciliationDemoComparePage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, X, AlertTriangle } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
} from '../components/compliance/DetailPageComponents';
import { StatusPill } from '../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface ManifestItem {
  currency: string;
  book: string;
  bucket: string;
  targetType: string;
  targetRef: string;
  internalAmount: string;
  externalAmount: string;
  signedDelta: string;
  note?: string;
}

interface DetectedItem {
  _currency: string;
  _book: string;
  matchStatus: string;
  internalSourceNo?: string | null;
  internalTxHash?: string | null;
  externalTxId?: string | null;
  externalTxHash?: string | null;
  internalAmount: string;
  externalAmount: string;
}

interface MatchedPair {
  manifest: ManifestItem;
  detected: DetectedItem;
}

interface CompareResult {
  run: {
    runNo: string;
    businessDate: string;
    status: string;
    invariantStatus: string;
  };
  manifest: ManifestItem[];
  detected: DetectedItem[];
  reconciliation: {
    matched: MatchedPair[];
    missed: ManifestItem[];
    extra: DetectedItem[];
  };
}

/* ── Helpers ────────────────────────────────────────────────── */

const MonoCell = ({ value }: { value: string | null | undefined }) => (
  <span className="font-mono text-[12px] text-adm-t1">{value ?? '—'}</span>
);

const AmountCell = ({ value }: { value: string }) => (
  <span className="font-mono text-[12px] text-adm-t1">{value}</span>
);

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationDemoComparePage = () => {
  const { runNo } = useParams<{ runNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!runNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/demo/compare?runNo=${encodeURIComponent(runNo)}`,
      );
      if (res.ok) {
        setData((await res.json()) as CompareResult);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load demo compare'));
        navigate('/admin/reconciliation/runs');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch demo compare', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (runNo) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNo]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading demo compare...</p>
      </div>
    );
  }

  if (!data) return null;

  const { run, reconciliation } = data;
  const { matched, missed, extra } = reconciliation;
  const hasNoManifest = data.manifest.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header ── */}
      <DetailPageHeader
        onBack={() => navigate(`/admin/reconciliation/runs/${encodeURIComponent(runNo ?? '')}`)}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Run Detail"
      />

      {/* ── Body ── */}
      <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
        {/* 1. Hero */}
        <div className="bg-adm-card px-6 py-5">
          <div className="font-mono text-[13px] font-semibold text-adm-t3">Demo: Injected vs Detected</div>
          <div className="mt-1 font-mono text-[19px] font-bold text-adm-amber">{run.runNo}</div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Business Date</span>
              <span className="font-mono text-adm-t1">{run.businessDate}</span>
            </div>
            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Run Status</span>
              <span className="mt-1 inline-block"><StatusPill value={run.status} size="md" /></span>
            </div>
            <div>
              <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Invariant Status</span>
              <span className="mt-1 inline-block"><StatusPill value={run.invariantStatus} size="md" /></span>
            </div>
          </div>
        </div>

        {/* 2. Summary strip */}
        <div className="bg-adm-bg px-6 py-4">
          <div className="flex flex-wrap gap-4">
            <div className="rounded-md border border-adm-green/30 bg-adm-green/10 px-4 py-2 text-center">
              <div className="font-mono text-[9px] uppercase tracking-wider text-adm-green/70">Matched</div>
              <div className="mt-0.5 font-mono text-[22px] font-bold text-adm-green">{matched.length}</div>
            </div>
            <div className="rounded-md border border-adm-red/30 bg-adm-red/10 px-4 py-2 text-center">
              <div className="font-mono text-[9px] uppercase tracking-wider text-adm-red/70">Missed</div>
              <div className="mt-0.5 font-mono text-[22px] font-bold text-adm-red">{missed.length}</div>
            </div>
            <div className="rounded-md border border-adm-amber/30 bg-adm-amber/10 px-4 py-2 text-center">
              <div className="font-mono text-[9px] uppercase tracking-wider text-adm-amber/70">Extra</div>
              <div className="mt-0.5 font-mono text-[22px] font-bold text-adm-amber">{extra.length}</div>
            </div>
          </div>
        </div>

        {/* 3. Empty state — real/pass run */}
        {hasNoManifest && (
          <div className="px-6 py-12 text-center">
            <Check className="mx-auto mb-3 text-adm-green" size={36} />
            <p className="font-mono text-[14px] font-semibold text-adm-green">
              Perfect tie — no injected breaks (pass run)
            </p>
            <p className="mt-1 font-mono text-[11px] text-adm-t3">
              This run has no demoManifest. All engine detections, if any, appear below as "extra".
            </p>
          </div>
        )}

        {/* 4. Matched pairs */}
        {matched.length > 0 && (
          <DetailCard title={`Matched Pairs (${matched.length})`} columns={1}>
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table className="w-full text-left">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    {['', 'Currency', 'Book', 'Bucket', 'Ref', 'Injected Δ', 'Detected Int.', 'Detected Ext.'].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-adm-t3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {matched.map((pair, i) => (
                    <tr key={i} className="transition-colors hover:bg-adm-hover">
                      <td className="px-3 py-2.5">
                        <Check size={14} className="text-adm-green" />
                      </td>
                      <td className="px-3 py-2.5"><MonoCell value={pair.manifest.currency} /></td>
                      <td className="px-3 py-2.5"><MonoCell value={pair.manifest.book} /></td>
                      <td className="px-3 py-2.5"><MonoCell value={pair.manifest.bucket} /></td>
                      <td className="px-3 py-2.5 max-w-[160px]">
                        <span className="block truncate font-mono text-[11px] text-adm-t2" title={pair.manifest.targetRef}>
                          {pair.manifest.targetRef}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <AmountCell value={pair.manifest.signedDelta} />
                      </td>
                      <td className="px-3 py-2.5">
                        <AmountCell value={pair.detected.internalAmount} />
                      </td>
                      <td className="px-3 py-2.5">
                        <AmountCell value={pair.detected.externalAmount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        )}

        {/* 5. Missed (injected but not detected) */}
        {missed.length > 0 && (
          <DetailCard title={`Missed — Injected but Not Detected (${missed.length})`} columns={1}>
            <div className="overflow-x-auto rounded-lg border border-adm-red/30 bg-adm-red/5">
              <table className="w-full text-left">
                <thead className="border-b border-adm-red/20">
                  <tr>
                    {['', 'Currency', 'Book', 'Bucket', 'Ref', 'Injected Δ', 'Note'].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-adm-red/70">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-red/10">
                  {missed.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2.5">
                        <X size={14} className="text-adm-red" />
                      </td>
                      <td className="px-3 py-2.5"><MonoCell value={item.currency} /></td>
                      <td className="px-3 py-2.5"><MonoCell value={item.book} /></td>
                      <td className="px-3 py-2.5"><MonoCell value={item.bucket} /></td>
                      <td className="px-3 py-2.5 max-w-[160px]">
                        <span className="block truncate font-mono text-[11px] text-adm-t2" title={item.targetRef}>
                          {item.targetRef}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <AmountCell value={item.signedDelta} />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t3">
                        {item.note ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        )}

        {/* 6. Extra (detected but not injected) */}
        {extra.length > 0 && (
          <DetailCard title={`Extra — Detected but Not Injected (${extra.length})`} columns={1}>
            <div className="overflow-x-auto rounded-lg border border-adm-amber/30 bg-adm-amber/5">
              <table className="w-full text-left">
                <thead className="border-b border-adm-amber/20">
                  <tr>
                    {['', 'Currency', 'Book', 'Match Status', 'Internal Amt', 'External Amt', 'Source No'].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-adm-amber/70">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-amber/10">
                  {extra.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2.5">
                        <AlertTriangle size={14} className="text-adm-amber" />
                      </td>
                      <td className="px-3 py-2.5"><MonoCell value={item._currency} /></td>
                      <td className="px-3 py-2.5"><MonoCell value={item._book} /></td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-[11px] text-adm-t2">{item.matchStatus}</span>
                      </td>
                      <td className="px-3 py-2.5"><AmountCell value={item.internalAmount} /></td>
                      <td className="px-3 py-2.5"><AmountCell value={item.externalAmount} /></td>
                      <td className="px-3 py-2.5 max-w-[160px]">
                        <span className="block truncate font-mono text-[11px] text-adm-t3" title={item.internalSourceNo ?? undefined}>
                          {item.internalSourceNo ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        )}

        {/* All-pass empty state when manifest exists but all matched */}
        {!hasNoManifest && matched.length > 0 && missed.length === 0 && extra.length === 0 && (
          <div className="px-6 py-8">
            <div className="rounded-lg border border-adm-green/30 bg-adm-green/5 p-5 text-center">
              <Check className="mx-auto mb-2 text-adm-green" size={28} />
              <p className="font-mono text-[13px] font-semibold text-adm-green">
                All {matched.length} injected breaks detected — engine match perfect
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReconciliationDemoComparePage;
