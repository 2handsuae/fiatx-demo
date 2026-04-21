import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface TemplatePayload {
  code: string;
  clearingType: string;
  sourceType: string;
  description: string;
  isEnabled: boolean;
  feeMethod: 'CONFIGURED_FEE' | 'ACTUAL_FEE';
  lineTemplates: unknown[];
}

interface FilterState {
  clearingType: string;
}

/* ── Display helpers ────────────────────────────────────────────── */

const ClearingTypeBadge = ({ type }: { type: string }) => {
  const cls =
    type === 'WITHDRAWAL'
      ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
      : type === 'INTERNAL_COLLECTION'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-border bg-adm-bg text-adm-t3';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${cls}`}>
      {type}
    </span>
  );
};

const EnabledDot = ({ v }: { v: boolean }) => (
  <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium ${v ? 'text-adm-green' : 'text-adm-t3'}`}>
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v ? 'bg-adm-green' : 'bg-adm-t3'}`} />
    {v ? 'On' : 'Off'}
  </span>
);

const DEFAULT_FILTERS: FilterState = { clearingType: '' };

const COLS = ['Code', 'Clearing Type', 'Source Type', 'Fee Method', 'Lines', 'Enabled', ''] as const;

/* ── Component ─────────────────────────────────────────────────── */

const ClearingHeaderTemplateList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TemplatePayload[]>([]);
  const [releaseNo, setReleaseNo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=CLEARING_TEMPLATE&status=ACTIVE&take=1`,
      );
      if (!relRes.ok) {
        setError(await getApiErrorMessage(relRes, 'Failed to fetch releases.'));
        return;
      }
      const relData = await relRes.json();
      const firstRelease = relData?.items?.[0];
      if (!firstRelease?.releaseNo) {
        setRows([]);
        return;
      }
      setReleaseNo(firstRelease.releaseNo as string);

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${firstRelease.releaseNo as string}`,
      );
      if (!detailRes.ok) {
        setError(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));
        return;
      }
      const detail = await detailRes.json();
      const templates: TemplatePayload[] = (
        (detail.items ?? []) as Array<{ businessKey: string; payload: Record<string, unknown> }>
      ).map((item) => {
        const p = item.payload;
        return {
          code: String(p.code ?? item.businessKey),
          clearingType: String(p.clearingType ?? ''),
          sourceType: String(p.sourceType ?? ''),
          description: String(p.description ?? ''),
          isEnabled: Boolean(p.isEnabled),
          feeMethod: (p.feeMethod as 'CONFIGURED_FEE' | 'ACTUAL_FEE') ?? 'CONFIGURED_FEE',
          lineTemplates: Array.isArray(p.lineTemplates) ? (p.lineTemplates as unknown[]) : [],
        };
      });
      setRows(templates);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load clearing templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  const visibleRows = rows.filter((r) => {
    if (filters.clearingType && r.clearingType !== filters.clearingType) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Clearing Header Templates"
        meta={`${rows.length} template${rows.length === 1 ? '' : 's'} · System`}
      >
        <button
          onClick={() => navigate('/dashboard/system/clearing-header-templates/history')}
          className={adminButtonClass('listSecondary')}
        >
          <Clock size={13} />
          Version History
        </button>
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="shrink-0 flex items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.clearingType}
          onChange={(e) => setFilters((p) => ({ ...p, clearingType: e.target.value }))}
          className={`${fi} w-52`}
        >
          <option value="">All clearing types</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
          <option value="INTERNAL_COLLECTION">INTERNAL_COLLECTION</option>
        </select>
        {releaseNo && (
          <span className="ml-auto font-mono text-[10px] text-adm-t3">
            {releaseNo}
          </span>
        )}
      </div>

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
              <th className="w-1 border-b border-adm-border bg-adm-panel" />
              {COLS.map((label) => (
                <th
                  key={label}
                  className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap border-b border-adm-border bg-adm-panel px-4 py-2 text-left"
                >
                  {label}
                </th>
              ))}
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
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No templates found.
                </td>
              </tr>
            )}
            {!loading && visibleRows.map((row) => (
              <tr
                key={row.code}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/system/clearing-header-templates/${row.code}`)}
              >
                {/* Accent strip */}
                <td className="py-3 pl-3">
                  <div
                    className={`h-5 w-0.5 rounded-full ${
                      row.clearingType === 'WITHDRAWAL'
                        ? 'bg-adm-amber'
                        : row.clearingType === 'INTERNAL_COLLECTION'
                          ? 'bg-adm-blue'
                          : 'bg-adm-t3/50'
                    }`}
                  />
                </td>

                {/* Code */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {row.code}
                  </span>
                </td>

                {/* Clearing Type */}
                <td className="px-4 py-3">
                  <ClearingTypeBadge type={row.clearingType} />
                </td>

                {/* Source Type */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t2">
                    {row.sourceType}
                  </span>
                </td>

                {/* Fee Method */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t2">
                    {row.feeMethod}
                  </span>
                </td>

                {/* Lines */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t2 tabular-nums">
                    {Array.isArray(row.lineTemplates) ? row.lineTemplates.length : 0}
                  </span>
                </td>

                {/* Enabled */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.isEnabled} />
                </td>

                {/* Chevron */}
                <td className="pr-4 py-3 text-right font-mono text-[12px] text-adm-t3">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          {rows.length > 0
            ? `${visibleRows.length} / ${rows.length} template${rows.length === 1 ? '' : 's'}`
            : 'No templates'}
        </span>
      </div>

    </div>
  );
};

export default ClearingHeaderTemplateList;
