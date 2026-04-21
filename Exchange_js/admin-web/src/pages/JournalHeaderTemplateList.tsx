import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface TemplateRow {
  templateCode: string;
  eventCode: string;
  assetType: 'CRYPTO' | 'FIAT' | 'ALL';
  enabled: boolean;  // header.status === 'ACTIVE'
  lineCount: number;
}

interface FilterState {
  assetType: string;
  enabled: string;
}

/* ── Display helpers ────────────────────────────────────────────── */

const AssetTypeBadge = ({ type }: { type: 'CRYPTO' | 'FIAT' | 'ALL' }) => {
  const cls =
    type === 'CRYPTO'
      ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
      : type === 'FIAT'
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

function deriveAssetType(eventCode: string): 'CRYPTO' | 'FIAT' | 'ALL' {
  if (eventCode.endsWith('__CRYPTO')) return 'CRYPTO';
  if (eventCode.endsWith('__FIAT')) return 'FIAT';
  return 'ALL';
}

const DEFAULT_FILTERS: FilterState = { assetType: '', enabled: '' };

const COLS = ['Template Code', 'Event Code', 'Asset Type', 'Lines', 'Enabled', ''] as const;

/* ── Component ─────────────────────────────────────────────────── */

const JournalHeaderTemplateList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [releaseNo, setReleaseNo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=JOURNAL_TEMPLATE&status=ACTIVE&take=1`,
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
      // Payload structure: { header: { templateCode, eventCode, status, ... }, lines: [...] }
      const templates: TemplateRow[] = (
        (detail.items ?? []) as Array<{ businessKey: string; payload: Record<string, unknown> }>
      ).map((item) => {
        const p = item.payload;
        const h = (p.header ?? {}) as Record<string, unknown>;
        const eventCode = String(h.eventCode ?? '');
        return {
          templateCode: String(h.templateCode ?? item.businessKey),
          eventCode,
          assetType: deriveAssetType(eventCode),
          enabled: String(h.status) === 'ACTIVE',
          lineCount: Array.isArray(p.lines) ? (p.lines as unknown[]).length : 0,
        };
      });
      setRows(templates);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load journal templates.');
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
    if (filters.assetType && r.assetType !== filters.assetType) return false;
    if (filters.enabled === 'enabled' && !r.enabled) return false;
    if (filters.enabled === 'disabled' && r.enabled) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Journal Header Templates"
        meta={`${rows.length} template${rows.length === 1 ? '' : 's'} · System`}
      >
        <button
          onClick={() => navigate('/dashboard/system/journal-header-templates/history')}
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
          value={filters.assetType}
          onChange={(e) => setFilters((p) => ({ ...p, assetType: e.target.value }))}
          className={`${fi} w-40`}
        >
          <option value="">All types</option>
          <option value="CRYPTO">CRYPTO</option>
          <option value="FIAT">FIAT</option>
          <option value="ALL">ALL</option>
        </select>
        <select
          value={filters.enabled}
          onChange={(e) => setFilters((p) => ({ ...p, enabled: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
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
                key={row.templateCode}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/system/journal-header-templates/${row.templateCode}`)}
              >
                {/* Accent strip */}
                <td className="py-3 pl-3">
                  <div
                    className={`h-5 w-0.5 rounded-full ${
                      row.assetType === 'CRYPTO'
                        ? 'bg-adm-amber'
                        : row.assetType === 'FIAT'
                          ? 'bg-adm-blue'
                          : 'bg-adm-t3/50'
                    }`}
                  />
                </td>

                {/* Template Code */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {row.templateCode}
                  </span>
                </td>

                {/* Event Code */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t2">
                    {row.eventCode}
                  </span>
                </td>

                {/* Asset Type */}
                <td className="px-4 py-3">
                  <AssetTypeBadge type={row.assetType} />
                </td>

                {/* Lines */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t2 tabular-nums">
                    {row.lineCount}
                  </span>
                </td>

                {/* Enabled */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.enabled} />
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

export default JournalHeaderTemplateList;
