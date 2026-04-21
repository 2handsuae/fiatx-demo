import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface PolicyRow {
  businessKey: string;
  business: 'SWAP' | 'WITHDRAWAL';
  policyId: string;
  policyName: string;
  channelOnline: boolean;
  channelStoreSoon: boolean;
  itemCount: number;
  extremeVolatilityBlocked?: boolean;
}

/* ── Display helpers ────────────────────────────────────────────── */

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

const BusinessBadge = ({ business }: { business: 'SWAP' | 'WITHDRAWAL' }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
      business === 'SWAP'
        ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
        : 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
    }`}
  >
    {business}
  </span>
);

const COLS = [
  'Policy ID',
  'Business',
  'Policy Name',
  'Channel Online',
  'Store Soon',
  'Item Count',
] as const;

/* ── Component ─────────────────────────────────────────────────── */

const PricingPolicyList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [releaseNo, setReleaseNo] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=PRICING_POLICY&status=ACTIVE&take=1`,
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
      setEffectiveDate((detail.effectiveFrom ?? detail.publishedAt ?? null) as string | null);

      const parsed: PolicyRow[] = (detail.items ?? []).map(
        (item: { businessKey: string; payload: Record<string, unknown> }) => {
          const p = item.payload as Record<string, unknown>;
          const business = String(p.business ?? '') as 'SWAP' | 'WITHDRAWAL';
          const ch = (p.channel ?? {}) as Record<string, boolean>;
          const pairs = Array.isArray(p.pairs) ? p.pairs.length : 0;
          const assets = Array.isArray(p.assets) ? p.assets.length : 0;
          const restrictions = (p.restrictions ?? {}) as Record<string, unknown>;
          return {
            businessKey: String(item.businessKey ?? ''),
            business,
            policyId: String(p.policyId ?? ''),
            policyName: String(p.policyName ?? ''),
            channelOnline: Boolean(ch.online),
            channelStoreSoon: Boolean(ch.storeComingSoon),
            itemCount: business === 'SWAP' ? pairs : assets,
            extremeVolatilityBlocked:
              business === 'WITHDRAWAL' ? Boolean(restrictions.extremeVolatilityBlocked) : undefined,
          };
        },
      );

      setRows(parsed);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load pricing policies.');
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
        title="Pricing Policies"
        meta={`${rows.length} polic${rows.length === 1 ? 'y' : 'ies'} · System`}
      >
        <button
          onClick={() => navigate('/dashboard/pricing/policies/history')}
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
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No pricing policies found.
                </td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <tr
                key={row.businessKey}
                className="border-b border-adm-border transition-colors hover:bg-adm-hover"
              >
                {/* Business accent strip */}
                <td className="py-3 pl-3">
                  <div
                    className={`h-5 w-0.5 rounded-full ${
                      row.business === 'SWAP' ? 'bg-adm-amber' : 'bg-adm-blue'
                    }`}
                  />
                </td>

                {/* Policy ID */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {row.policyId}
                  </span>
                </td>

                {/* Business */}
                <td className="px-4 py-3">
                  <BusinessBadge business={row.business} />
                </td>

                {/* Policy Name */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t1">
                    {row.policyName}
                  </span>
                </td>

                {/* Channel Online */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.channelOnline} />
                </td>

                {/* Store Soon */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.channelStoreSoon} />
                </td>

                {/* Item Count */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[11px] text-adm-t2 tabular-nums">
                    {row.itemCount}
                  </span>
                  <span className="ml-1 font-mono text-[10px] text-adm-t3">
                    {row.business === 'SWAP' ? 'pairs' : 'assets'}
                  </span>
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
              ? `${rows.length} polic${rows.length === 1 ? 'y' : 'ies'}`
              : 'No policies'}
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
          {releaseNo && !effectiveDate && (
            <span className="font-mono text-[10px] text-adm-t3">{releaseNo}</span>
          )}
        </div>
      </div>

    </div>
  );
};

export default PricingPolicyList;
