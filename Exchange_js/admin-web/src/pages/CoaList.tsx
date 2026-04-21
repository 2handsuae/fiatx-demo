import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw } from 'lucide-react';
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

interface CoaRow {
  businessKey: string;
  code: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  name: string;
  status: 'ACTIVE' | 'DISABLED';
}

interface FilterState {
  type: string;
}

/* ── Display helpers ────────────────────────────────────────────── */

const TypeBadge = ({ type }: { type: CoaRow['type'] }) => {
  const cls: Record<CoaRow['type'], string> = {
    ASSET:     'border-adm-blue/25 bg-adm-blue/10 text-adm-blue',
    LIABILITY: 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
    EQUITY:    'border-adm-green/25 bg-adm-green/10 text-adm-green',
    REVENUE:   'border-adm-green/25 bg-adm-green/10 text-adm-green',
    EXPENSE:   'border-adm-red/25 bg-adm-red/10 text-adm-red',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${cls[type]}`}
    >
      {type}
    </span>
  );
};

const accentColor = (type: CoaRow['type']): string => {
  if (type === 'ASSET' || type === 'EQUITY') return 'bg-adm-blue';
  if (type === 'LIABILITY') return 'bg-adm-amber';
  if (type === 'REVENUE') return 'bg-adm-green';
  return 'bg-adm-red'; // EXPENSE
};

const DEFAULT_FILTERS: FilterState = { type: '' };

const COLS = ['Code', 'Type', 'Name', 'Status', ''] as const;

/* ── Component ─────────────────────────────────────────────────── */

const CoaList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CoaRow[]>([]);
  const [releaseNo, setReleaseNo] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relListRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=COA&status=ACTIVE&take=1`,
      );
      if (!relListRes.ok) {
        setError(await getApiErrorMessage(relListRes, 'Failed to fetch releases.'));
        return;
      }

      const relListData = await relListRes.json();
      const firstRelease = relListData?.items?.[0];

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
      setEffectiveDate((detail.effectiveFrom ?? detail.publishedAt ?? null) as string | null);

      const accounts: CoaRow[] = (
        (detail.items ?? []) as Array<{ businessKey: string; payload: Record<string, unknown> }>
      ).map((item) => {
        const p = item.payload;
        return {
          businessKey: item.businessKey,
          code: String(p.code ?? item.businessKey),
          type: (p.type as CoaRow['type']) ?? 'ASSET',
          name: String(p.name ?? ''),
          status: (p.status as 'ACTIVE' | 'DISABLED') ?? 'ACTIVE',
        };
      });

      setRows(accounts);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const visibleRows = rows.filter((r) => {
    if (filters.type && r.type !== filters.type) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Chart of Accounts"
        meta={`${rows.length} account${rows.length === 1 ? '' : 's'} · Ledger`}
      >
        <button
          onClick={() => navigate('/ledger/coa/history')}
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.type}
          onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}
          className={`${fi} w-40`}
        >
          <option value="">All types</option>
          <option value="ASSET">ASSET</option>
          <option value="LIABILITY">LIABILITY</option>
          <option value="EQUITY">EQUITY</option>
          <option value="REVENUE">REVENUE</option>
          <option value="EXPENSE">EXPENSE</option>
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
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
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
                  No accounts found.
                </td>
              </tr>
            )}
            {!loading && visibleRows.map((row) => (
              <tr
                key={row.businessKey}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/ledger/coa/${row.code}`)}
              >
                {/* Type accent strip */}
                <td className="py-3 pl-3">
                  <div className={`h-5 w-0.5 rounded-full ${accentColor(row.type)}`} />
                </td>

                {/* Code */}
                <td className="px-4 py-3 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                  {row.code}
                </td>

                {/* Type */}
                <td className="px-4 py-3">
                  <TypeBadge type={row.type} />
                </td>

                {/* Name */}
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1">
                  {row.name || <span className="text-adm-t3">—</span>}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <AdminBadge value={row.status} />
                </td>

                {/* Chevron */}
                <td className="pr-4 py-3 text-right font-mono text-[12px] text-adm-t3">
                  ›
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {rows.length > 0
              ? `${visibleRows.length} / ${rows.length} account${rows.length === 1 ? '' : 's'}`
              : 'No accounts'}
          </span>
          {effectiveDate && (
            <span className="font-mono text-[10px] text-adm-t3">
              Config effective{' '}
              {new Date(effectiveDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>

    </div>
  );
};

export default CoaList;
