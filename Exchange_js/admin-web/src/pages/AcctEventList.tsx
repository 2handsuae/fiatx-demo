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

interface AcctEventRow {
  businessKey: string;
  eventCode: string;
  entityType: 'DEPOSIT' | 'SWAP' | 'WITHDRAW' | 'INTERNAL_TX';
  ownerScope: 'CUSTOMER' | 'PLATFORM';
  assetType: 'CRYPTO' | 'FIAT' | 'ALL';
  triggerType: string;
  toStatus: string;
  postingMode: string;
  clearingMode: string;
  isActive: boolean;
}

interface FilterState {
  entityType: string;
  assetType: string;
}

/* ── Display helpers ────────────────────────────────────────────── */

const EntityBadge = ({ type }: { type: AcctEventRow['entityType'] }) => {
  const cls: Record<AcctEventRow['entityType'], string> = {
    DEPOSIT:     'border-adm-blue/25 bg-adm-blue/10 text-adm-blue',
    SWAP:        'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
    WITHDRAW:    'border-adm-red/25 bg-adm-red/10 text-adm-red',
    INTERNAL_TX: 'border-adm-green/25 bg-adm-green/10 text-adm-green',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${cls[type]}`}
    >
      {type}
    </span>
  );
};

const EnabledDot = ({ v }: { v: boolean }) => (
  <span
    className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium ${
      v ? 'text-adm-green' : 'text-adm-t3'
    }`}
  >
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${v ? 'bg-adm-green' : 'bg-adm-t3'}`}
    />
    {v ? 'On' : 'Off'}
  </span>
);

const accentColor = (assetType: AcctEventRow['assetType']): string => {
  if (assetType === 'CRYPTO') return 'bg-adm-amber';
  if (assetType === 'FIAT') return 'bg-adm-blue';
  return 'bg-adm-t3';
};

const DEFAULT_FILTERS: FilterState = { entityType: '', assetType: '' };

const COLS = [
  'Event Code',
  'Entity',
  'Scope',
  'Asset',
  'To Status',
  'Posting',
  'Clearing',
  'Active',
  '',
] as const;

/* ── Component ─────────────────────────────────────────────────── */

const AcctEventList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AcctEventRow[]>([]);
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
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ACCT_EVENT&status=ACTIVE&take=1`,
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

      const events: AcctEventRow[] = (
        (detail.items ?? []) as Array<{ businessKey: string; payload: Record<string, unknown> }>
      ).map((item) => {
        const p = item.payload;
        return {
          businessKey: item.businessKey,
          eventCode: String(p.eventCode ?? item.businessKey),
          entityType: (p.entityType as AcctEventRow['entityType']) ?? 'DEPOSIT',
          ownerScope: (p.ownerScope as AcctEventRow['ownerScope']) ?? 'CUSTOMER',
          assetType: (p.assetType as AcctEventRow['assetType']) ?? 'ALL',
          triggerType: String(p.triggerType ?? ''),
          toStatus: String(p.toStatus ?? ''),
          postingMode: String(p.postingMode ?? ''),
          clearingMode: String(p.clearingMode ?? ''),
          isActive: Boolean(p.isActive),
        };
      });

      setRows(events);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load accounting events.');
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
    if (filters.entityType && r.entityType !== filters.entityType) return false;
    if (filters.assetType && r.assetType !== filters.assetType) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Accounting Events"
        meta={`${rows.length} event${rows.length === 1 ? '' : 's'} · System`}
      >
        <button
          onClick={() => navigate('/dashboard/system/acct-events/history')}
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
          value={filters.entityType}
          onChange={(e) => setFilters((p) => ({ ...p, entityType: e.target.value }))}
          className={`${fi} w-44`}
        >
          <option value="">All entities</option>
          <option value="DEPOSIT">DEPOSIT</option>
          <option value="SWAP">SWAP</option>
          <option value="WITHDRAW">WITHDRAW</option>
          <option value="INTERNAL_TX">INTERNAL_TX</option>
        </select>
        <select
          value={filters.assetType}
          onChange={(e) => setFilters((p) => ({ ...p, assetType: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All assets</option>
          <option value="CRYPTO">CRYPTO</option>
          <option value="FIAT">FIAT</option>
          <option value="ALL">ALL</option>
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
                  No events found.
                </td>
              </tr>
            )}
            {!loading && visibleRows.map((row) => (
              <tr
                key={row.businessKey}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/system/acct-events/${row.eventCode}`)}
              >
                {/* Asset type accent strip */}
                <td className="py-3 pl-3">
                  <div className={`h-5 w-0.5 rounded-full ${accentColor(row.assetType)}`} />
                </td>

                {/* Event Code */}
                <td className="px-4 py-3 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                  {row.eventCode}
                </td>

                {/* Entity */}
                <td className="px-4 py-3">
                  <EntityBadge type={row.entityType} />
                </td>

                {/* Scope */}
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {row.ownerScope}
                </td>

                {/* Asset */}
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {row.assetType}
                </td>

                {/* To Status */}
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {row.toStatus || <span className="text-adm-t3">—</span>}
                </td>

                {/* Posting Mode */}
                <td className="px-4 py-3 max-w-[120px]">
                  <span className="block truncate font-mono text-[11px] text-adm-t2" title={row.postingMode}>
                    {row.postingMode || <span className="text-adm-t3">—</span>}
                  </span>
                </td>

                {/* Clearing Mode */}
                <td className="px-4 py-3 max-w-[120px]">
                  <span className="block truncate font-mono text-[11px] text-adm-t2" title={row.clearingMode}>
                    {row.clearingMode || <span className="text-adm-t3">—</span>}
                  </span>
                </td>

                {/* Active */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.isActive} />
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
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {rows.length > 0
              ? `${visibleRows.length} / ${rows.length} event${rows.length === 1 ? '' : 's'}`
              : 'No events'}
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

export default AcctEventList;
