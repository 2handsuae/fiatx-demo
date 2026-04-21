import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface Release {
  id: string;
  releaseNo: string;
  status: 'DRAFT' | 'VALIDATED' | 'ACTIVE' | 'SUPERSEDED' | 'INVALIDATED';
  itemCount: number;
  publishedAt: string | null;
  effectiveFrom: string | null;
  createdAt: string;
  updatedAt: string;
  validationSummary: {
    ok: boolean;
    issues: string[];
    validatedAt: string;
  } | null;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

const fmtDate = (v?: string | number | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  const d = new Date(typeof v === 'number' ? v : v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Build a map of releaseNo → effectiveUntil.
 * Releases are sorted newest-first; a version's end date is the next
 * (newer) version's effectiveFrom.
 */
const buildUntilMap = (releases: Release[]): Map<string, string | number | null> => {
  const map = new Map<string, string | number | null>();
  for (let i = 1; i < releases.length; i++) {
    const newer = releases[i - 1];
    const until = newer.effectiveFrom ?? newer.publishedAt ?? null;
    map.set(releases[i].releaseNo, until);
  }
  return map;
};

const COLS = [
  ['Release No',   '200px'],
  ['Status',       '130px'],
  ['Assets',       '90px'],
  ['Effective',    '150px'],
  ['Until',        '150px'],
  ['Published',    '150px'],
  ['Validation',   'auto'],
] as [string, string][];

/* ── Component ─────────────────────────────────────────────────── */

const AssetConfigHistory = () => {
  const navigate = useNavigate();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&take=50`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch history.'));
      const data = await res.json();
      setReleases(data.items ?? []);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Version History"
        meta="Assets · All releases"
      >
        <button
          onClick={() => navigate('/dashboard/system/asset-configs')}
          className={adminButtonClass('listSecondary')}
        >
          <ArrowLeft size={13} />
          Back to Assets
        </button>
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Error */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {COLS.map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
              <th className="w-8 border-b border-adm-border bg-adm-panel" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && releases.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No releases found.
                </td>
              </tr>
            )}
            {!loading && (() => {
              const untilMap = buildUntilMap(releases);
              return releases.map((r) => {
                const isActive = r.status === 'ACTIVE';
                const hasIssues = r.validationSummary !== null && !r.validationSummary.ok;
                const until = untilMap.get(r.releaseNo) ?? null;

                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/dashboard/system/asset-configs/history/${r.releaseNo}`)}
                  >
                    {/* Release No */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-adm-amber">
                          {r.releaseNo}
                        </span>
                        {isActive && (
                          <span className="rounded border border-adm-green/30 bg-adm-green/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-adm-green">
                            CURRENT
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <AdminBadge value={r.status} />
                    </td>

                    {/* Asset count */}
                    <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 tabular-nums">
                      {r.itemCount}
                    </td>

                    {/* Effective from */}
                    <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                      {fmtDate(r.effectiveFrom ?? r.publishedAt)}
                    </td>

                    {/* Until (derived: next release's effectiveFrom) */}
                    <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap">
                      {isActive ? (
                        <span className="text-adm-green">Ongoing</span>
                      ) : until ? (
                        <span className="text-adm-t2">{fmtDate(until)}</span>
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>

                    {/* Published */}
                    <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                      {fmtDate(r.publishedAt)}
                    </td>

                    {/* Validation */}
                    <td className="px-4 py-2.5">
                      {r.validationSummary === null ? (
                        <span className="font-mono text-[10px] text-adm-t3">—</span>
                      ) : hasIssues ? (
                        <span className="font-mono text-[10px] text-adm-red">
                          {r.validationSummary.issues.length} issue{r.validationSummary.issues.length !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-adm-green">OK</span>
                      )}
                    </td>

                    {/* Chevron */}
                    <td className="pr-4 py-2.5 text-right font-mono text-[12px] text-adm-t3">
                      ›
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          {releases.length > 0
            ? `${releases.length} release${releases.length === 1 ? '' : 's'}`
            : 'No releases'}
        </span>
      </div>

    </div>
  );
};

export default AssetConfigHistory;
