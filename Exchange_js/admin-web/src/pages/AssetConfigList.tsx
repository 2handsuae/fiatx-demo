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

interface AssetRow {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null;
}

interface FilterState {
  type: string;
  status: string;
}

/* ── Display helpers ────────────────────────────────────────────── */

const TypeBadge = ({ type }: { type: 'FIAT' | 'CRYPTO' }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
      type === 'FIAT'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
    }`}
  >
    {type}
  </span>
);

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

const AmtRange = ({ min, max }: { min: string; max: string | null }) => (
  <span className="font-mono text-[11px] text-adm-t2 tabular-nums">
    {min}
    <span className="mx-1 text-adm-t3">/</span>
    <span className={max ? 'text-adm-t2' : 'text-adm-t3'}>{max ?? '∞'}</span>
  </span>
);

const DEFAULT_FILTERS: FilterState = { type: '', status: '' };

const COLS = [
  'Asset',
  'Network',
  'Status',
  'Deposit',
  'Dep. Min / Max',
  'Withdraw',
  'Wtd. Min / Max',
  'Confirmations',
] as const;

/* ── Component ─────────────────────────────────────────────────── */

const AssetConfigList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AssetRow[]>([]);
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
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1`,
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

      const assets: AssetRow[] = ((detail.items ?? []) as Array<{ businessKey: string; payload: Record<string, unknown> }>).map((item) => {
        const p = item.payload;
        return {
          assetNo: String(p.assetNo ?? item.businessKey),
          code: String(p.code ?? ''),
          type: (p.type as 'FIAT' | 'CRYPTO') ?? 'FIAT',
          network: String(p.network ?? ''),
          decimals: Number(p.decimals ?? 0),
          description: p.description ? String(p.description) : null,
          status: (p.status as 'ACTIVE' | 'DISABLED') ?? 'ACTIVE',
          depositEnabled: Boolean(p.depositEnabled),
          withdrawEnabled: Boolean(p.withdrawEnabled),
          depositMinAmount: String(p.depositMinAmount ?? ''),
          depositMaxAmount: p.depositMaxAmount != null ? String(p.depositMaxAmount) : null,
          withdrawMinAmount: String(p.withdrawMinAmount ?? ''),
          withdrawMaxAmount: p.withdrawMaxAmount != null ? String(p.withdrawMaxAmount) : null,
          minConfirmations: p.minConfirmations != null ? Number(p.minConfirmations) : null,
        };
      });

      setRows(assets);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load assets.');
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
    if (filters.status && r.status !== filters.status) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Assets"
        meta={`${rows.length} asset${rows.length === 1 ? '' : 's'} · System`}
      >
        <button
          onClick={() => navigate('/dashboard/system/asset-configs/history')}
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
          className={`${fi} w-36`}
        >
          <option value="">All types</option>
          <option value="FIAT">FIAT</option>
          <option value="CRYPTO">CRYPTO</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="DISABLED">DISABLED</option>
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
              <th className="w-8 border-b border-adm-border bg-adm-panel" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLS.length + 2} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 2} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No assets found.
                </td>
              </tr>
            )}
            {!loading && visibleRows.map((row) => (
              <tr
                key={row.assetNo}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/system/asset-configs/${row.assetNo}`)}
              >
                {/* Type accent strip */}
                <td className="py-3 pl-3">
                  <div
                    className={`h-5 w-0.5 rounded-full ${
                      row.type === 'CRYPTO' ? 'bg-adm-amber' : 'bg-adm-blue'
                    }`}
                  />
                </td>

                {/* Asset: type badge + code + assetNo */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={row.type} />
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {row.code}
                    </span>
                    <span className="font-mono text-[10px] text-adm-t3">
                      {row.assetNo}
                    </span>
                  </div>
                </td>

                {/* Network */}
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {row.network || <span className="text-adm-t3">—</span>}
                </td>

                {/* Status from payload */}
                <td className="px-4 py-3">
                  <AdminBadge value={row.status} />
                </td>

                {/* Deposit enabled */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.depositEnabled} />
                </td>
                {/* Deposit range */}
                <td className="px-4 py-3">
                  <AmtRange min={row.depositMinAmount} max={row.depositMaxAmount} />
                </td>
                {/* Withdraw enabled */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.withdrawEnabled} />
                </td>
                {/* Withdraw range */}
                <td className="px-4 py-3">
                  <AmtRange min={row.withdrawMinAmount} max={row.withdrawMaxAmount} />
                </td>
                {/* Min confirmations */}
                <td className="px-4 py-3 font-mono text-[11px] tabular-nums whitespace-nowrap">
                  {row.type === 'CRYPTO' && row.minConfirmations != null ? (
                    <span className="text-adm-t2">{row.minConfirmations}</span>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
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
              ? `${visibleRows.length} / ${rows.length} asset${rows.length === 1 ? '' : 's'}`
              : 'No assets'}
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

export default AssetConfigList;
