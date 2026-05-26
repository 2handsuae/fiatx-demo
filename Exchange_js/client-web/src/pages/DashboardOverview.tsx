import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  RefreshCw,
  Lock,
  History,
  AlertCircle,
  Briefcase,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatAssetAmount } from '../utils/number-format';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

/* ────────────────────────────────────────────────────────────────
 *  Overview — FIATX Terminal dialect.
 *  Portfolio value in AED, holdings with AED valuation, and
 *  indicative exchange rates. No external API calls.
 * ──────────────────────────────────────────────────────────────── */

interface AssetData {
  assetId: string;
  assetCode: string;
  assetType: string;
  clientCredit: string;
  lockedBalance: string;
  walletId: string;
  assetDecimals?: number;
}

interface PlatformAsset {
  id: string;
  code: string;
  currency: string;
  type: string;
  status: string;
  name?: string;
  decimals?: number;
}

/* ─── Indicative rates: asset → AED ──────────────────────────── */

const RATES_TO_AED: Record<string, number> = {
  AED: 1.0,
  USDT: 3.6725,
  USDC: 3.6725,
  USD: 3.6725,
};

function getAedRate(code: string, currency: string): number | null {
  return RATES_TO_AED[code] ?? RATES_TO_AED[currency] ?? null;
}

/* ─── Section heading — matches Profile page pattern ─────────── */
function SectionTitle({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pb-3 border-b border-fx-rule">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-fx-dust">
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ─── Asset type badge ────────────────────────────────────────── */
function TypeBadge({ type }: { type: string }) {
  const tone =
    type === 'CRYPTO'
      ? 'text-fx-brass border-fx-brass/20'
      : 'text-fx-sage border-fx-sage/20';
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.10em] ${tone}`}
    >
      {type}
    </span>
  );
}

/* ─── Page ─────────────────────────────────────────────────────── */

const DashboardOverview = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetData[]>([]);
  const [platformAssets, setPlatformAssets] = useState<PlatformAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAssets = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const platformResponse = await customerFetch(
        `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`,
      );
      if (platformResponse.ok) {
        const platformData = await platformResponse.json();
        setPlatformAssets(platformData.items || []);
      }

      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/treasury/customer/${user.id}/assets`,
      );
      if (response.ok) {
        const data = await response.json();
        setAssets(data);
      } else {
        setError(
          await getCustomerApiErrorMessage(response, 'Failed to load assets'),
        );
      }
    } catch (err: unknown) {
      if (err instanceof CustomerSessionError) return;
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Network connection error',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [user]);

  /* ── Loading ─────────────────────────────────────────────────── */
  if (loading && assets.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-fx-dust" size={20} />
      </div>
    );
  }

  /* ── Merged list: platform assets with user balances + AED ───── */
  const rows = platformAssets.map((pa) => {
    const ua = assets.find((a) => a.assetCode === pa.code);
    const available = ua ? parseFloat(ua.clientCredit) : 0;
    const locked = ua ? parseFloat(ua.lockedBalance) : 0;
    const decimals = pa.decimals ?? ua?.assetDecimals;
    const rate = getAedRate(pa.code, pa.currency);
    const totalBalance = available + locked;
    const aedValue = rate !== null ? totalBalance * rate : null;
    return { ...pa, available, locked, decimals, assetId: pa.id, rate, aedValue };
  });

  const nonZeroCount = rows.filter(
    (r) => r.available > 0 || r.locked > 0,
  ).length;

  const totalAed = rows.reduce((sum, r) => sum + (r.aedValue ?? 0), 0);

  return (
    <div className="space-y-10">
      {/* ── Portfolio Value ────────────────────────────────────── */}
      <div>
        <SectionTitle
          right={
            <button
              onClick={fetchAssets}
              className="flex items-center gap-1.5 text-fx-dust hover:text-fx-brass transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} />
              <span className="font-mono text-[9px] uppercase tracking-[0.12em]">
                Refresh
              </span>
            </button>
          }
        >
          Portfolio Value
        </SectionTitle>
        <div className="mt-5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[9px] text-fx-dust tracking-wide">≈</span>
            <span className="font-mono text-[36px] font-light tabular-nums text-fx-sand leading-none tracking-tight">
              {totalAed.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="font-mono text-[14px] text-fx-brass tracking-wide">
              AED
            </span>
          </div>
          <p className="mt-3 font-mono text-[11px] text-fx-dust tracking-wide">
            {nonZeroCount} asset{nonZeroCount !== 1 ? 's' : ''} with balance
            {' · '}
            {platformAssets.length} supported
          </p>
        </div>
      </div>

      {/* ── Holdings ──────────────────────────────────────────── */}
      <div>
        <SectionTitle>Holdings</SectionTitle>

        {error ? (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle size={24} className="text-fx-rust" />
            <p className="font-mono text-[12px] text-fx-rust">{error}</p>
            <button
              onClick={fetchAssets}
              className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <Briefcase size={24} className="text-fx-dust" />
            <p className="font-mono text-[12px] text-fx-dust">
              No assets available on this platform.
            </p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="mt-4 hidden sm:grid grid-cols-12 gap-4 px-4 pb-2">
              <div className="col-span-3 font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70">
                Asset
              </div>
              <div className="col-span-2 font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70">
                Type
              </div>
              <div className="col-span-2 font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 text-right">
                Available
              </div>
              <div className="col-span-2 font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 text-right">
                Locked
              </div>
              <div className="col-span-2 font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 text-right">
                ≈ AED
              </div>
              <div className="col-span-1" />
            </div>

            {/* Rows */}
            <div className="divide-y divide-fx-rule">
              {rows.map((row) => {
                const hasBalance = row.available > 0 || row.locked > 0;
                return (
                  <div
                    key={row.id}
                    className={`grid grid-cols-12 gap-4 items-center px-4 py-3 transition-colors ${
                      hasBalance
                        ? 'hover:bg-fx-sand/[0.02]'
                        : 'opacity-50'
                    }`}
                  >
                    {/* Asset code */}
                    <div className="col-span-3 flex items-center gap-3">
                      <div className="w-8 h-8 border border-fx-rule flex items-center justify-center font-mono text-[10px] text-fx-dune">
                        {row.code.substring(0, 3)}
                      </div>
                      <span className="font-sans text-[13px] text-fx-sand font-medium">
                        {row.code}
                      </span>
                    </div>

                    {/* Type */}
                    <div className="col-span-2">
                      <TypeBadge type={row.type} />
                    </div>

                    {/* Available */}
                    <div className="col-span-2 text-right">
                      <span
                        className={`font-mono text-[13px] tabular-nums ${
                          row.available > 0 ? 'text-fx-sand' : 'text-fx-dust'
                        }`}
                      >
                        {formatAssetAmount(row.available, row.decimals)}
                      </span>
                    </div>

                    {/* Locked */}
                    <div className="col-span-2 text-right flex items-center justify-end gap-1">
                      {row.locked > 0 && (
                        <Lock size={10} className="text-fx-brass" />
                      )}
                      <span
                        className={`font-mono text-[13px] tabular-nums ${
                          row.locked > 0 ? 'text-fx-brass' : 'text-fx-dust'
                        }`}
                      >
                        {formatAssetAmount(row.locked, row.decimals)}
                      </span>
                    </div>

                    {/* ≈ AED */}
                    <div className="col-span-2 text-right">
                      <span
                        className={`font-mono text-[13px] tabular-nums ${
                          row.aedValue !== null && row.aedValue > 0
                            ? 'text-fx-sand'
                            : 'text-fx-dust'
                        }`}
                      >
                        {row.aedValue !== null
                          ? formatAssetAmount(row.aedValue, 2)
                          : '—'}
                      </span>
                    </div>

                    {/* History link */}
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() =>
                          navigate(`/transactions?assetId=${row.assetId}`)
                        }
                        className="text-fx-dust hover:text-fx-brass transition-colors"
                        title={`${row.code} history`}
                      >
                        <History size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total row */}
            <div className="grid grid-cols-12 gap-4 items-center px-4 py-3 border-t border-fx-rule">
              <div className="col-span-9" />
              <div className="col-span-2 text-right">
                <span className="font-mono text-[13px] tabular-nums text-fx-sand font-medium">
                  {formatAssetAmount(totalAed, 2)}
                </span>
              </div>
              <div className="col-span-1 text-right">
                <span className="font-mono text-[9px] uppercase tracking-[0.10em] text-fx-dust">
                  AED
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Indicative Rates ──────────────────────────────────── */}
      {platformAssets.length > 0 && (
        <div>
          <SectionTitle>Indicative Rates</SectionTitle>
          <div className="mt-4 space-y-0 divide-y divide-fx-rule/50">
            {platformAssets.map((pa) => {
              const rate = getAedRate(pa.code, pa.currency);
              return (
                <div
                  key={pa.id}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <span className="font-mono text-[12px] text-fx-dune">
                    {pa.currency}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-fx-sand">
                    {rate !== null
                      ? `${rate.toLocaleString('en-US', {
                          minimumFractionDigits: 4,
                          maximumFractionDigits: 4,
                        })} AED`
                      : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 px-4 font-mono text-[9px] text-fx-dust/60 tracking-wide">
            Indicative only · AED pegged at 3.6725 AED/USD
          </p>
        </div>
      )}
    </div>
  );
};

export default DashboardOverview;
