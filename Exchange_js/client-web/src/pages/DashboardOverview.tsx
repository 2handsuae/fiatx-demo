import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  RefreshCw,
  Lock,
  History,
  AlertCircle,
  Briefcase,
  X,
} from 'lucide-react';
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

interface PortfolioItem {
  assetId: string;
  assetCode: string;
  assetType: string;
  currency: string;
  available: string;
  locked: string;
  decimals: number;
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

/* ─── Statement types ─────────────────────────────────────────── */

interface StatementRow {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  direction: 'IN' | 'OUT';
  amount: number;
  runningBalance: number;
  assetCode: string;
  memo: string | null;
  createdAt: string;
}

/* ─── Page ─────────────────────────────────────────────────────── */

const DashboardOverview = () => {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statementAsset, setStatementAsset] = useState<{ code: string; currency: string; decimals: number } | null>(null);
  const [statementRows, setStatementRows] = useState<StatementRow[]>([]);
  const [statementBalance, setStatementBalance] = useState(0);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState('');

  const fetchPortfolio = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
      );
      if (response.ok) {
        const data = await response.json();
        setPortfolio(data);
      } else {
        setError(
          await getCustomerApiErrorMessage(response, 'Failed to load portfolio'),
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

  const openStatement = async (item: PortfolioItem) => {
    setStatementAsset({ code: item.assetCode, currency: item.currency, decimals: item.decimals });
    setStatementRows([]);
    setStatementBalance(0);
    setStatementError('');
    setStatementLoading(true);
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/portfolio/statement?assetCurrency=${item.currency}`,
      );
      if (res.ok) {
        const data = await res.json();
        setStatementRows(data.items ?? []);
        setStatementBalance(data.currentBalance ?? 0);
      } else {
        setStatementError(await getCustomerApiErrorMessage(res, 'Failed to load statement'));
      }
    } catch (err: unknown) {
      if (err instanceof CustomerSessionError) return;
      setStatementError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setStatementLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolio();
  }, [user]);

  /* ── Loading ─────────────────────────────────────────────────── */
  if (loading && portfolio.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-fx-dust" size={20} />
      </div>
    );
  }

  /* ── Build display rows from portfolio data ─────────────────── */
  const rows = portfolio.map((item) => {
    const available = parseFloat(item.available);
    const locked = parseFloat(item.locked);
    const rate = getAedRate(item.assetCode, item.currency);
    const totalBalance = available + locked;
    const aedValue = rate !== null ? totalBalance * rate : null;
    return { ...item, available, locked, rate, aedValue };
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
              onClick={fetchPortfolio}
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
            {portfolio.length} supported
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
              onClick={fetchPortfolio}
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
                    key={row.assetId}
                    className={`grid grid-cols-12 gap-4 items-center px-4 py-3 transition-colors ${
                      hasBalance
                        ? 'hover:bg-fx-sand/[0.02]'
                        : 'opacity-50'
                    }`}
                  >
                    {/* Asset code */}
                    <div className="col-span-3 flex items-center gap-3">
                      <div className="w-8 h-8 border border-fx-rule flex items-center justify-center font-mono text-[10px] text-fx-dune">
                        {row.assetCode.substring(0, 3)}
                      </div>
                      <span className="font-sans text-[13px] text-fx-sand font-medium">
                        {row.assetCode}
                      </span>
                    </div>

                    {/* Type */}
                    <div className="col-span-2">
                      <TypeBadge type={row.assetType} />
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

                    {/* Statement link */}
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => {
                          const item = portfolio.find((p) => p.assetId === row.assetId);
                          if (item) openStatement(item);
                        }}
                        className="text-fx-dust hover:text-fx-brass transition-colors"
                        title={`${row.assetCode} statement`}
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
      {portfolio.length > 0 && (
        <div>
          <SectionTitle>Indicative Rates</SectionTitle>
          <div className="mt-4 space-y-0 divide-y divide-fx-rule/50">
            {portfolio.map((item) => {
              const rate = getAedRate(item.assetCode, item.currency);
              return (
                <div
                  key={item.assetId}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <span className="font-mono text-[12px] text-fx-dune">
                    {item.currency}
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

      {/* ── Statement Modal ──────────────────────────────────── */}
      {statementAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-base border border-fx-rule w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-fx-rule shrink-0">
              <div>
                <h3 className="font-mono text-[14px] text-fx-sand font-medium">
                  {statementAsset.code} Statement
                </h3>
                <p className="font-mono text-[10px] text-fx-dust mt-0.5">
                  Account activity · {statementAsset.currency}
                </p>
              </div>
              <button
                onClick={() => setStatementAsset(null)}
                className="text-fx-dust hover:text-fx-sand transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-auto">
              {statementLoading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="animate-spin text-fx-dust" size={18} />
                </div>
              ) : statementError ? (
                <div className="flex items-center justify-center py-16">
                  <p className="font-mono text-[11px] text-fx-rust">{statementError}</p>
                </div>
              ) : statementRows.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <p className="font-mono text-[11px] text-fx-dust">No transactions yet.</p>
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-fx-base">
                    <tr className="border-b border-fx-rule">
                      <th className="px-3 py-2 text-left font-mono text-[9px] uppercase tracking-[0.12em] text-fx-dust/70">Date</th>
                      <th className="px-3 py-2 text-left font-mono text-[9px] uppercase tracking-[0.12em] text-fx-dust/70">Type</th>
                      <th className="px-3 py-2 text-left font-mono text-[9px] uppercase tracking-[0.12em] text-fx-dust/70">Ref</th>
                      <th className="px-3 py-2 text-right font-mono text-[9px] uppercase tracking-[0.12em] text-fx-dust/70">In</th>
                      <th className="px-3 py-2 text-right font-mono text-[9px] uppercase tracking-[0.12em] text-fx-dust/70">Out</th>
                      <th className="px-3 py-2 text-right font-mono text-[9px] uppercase tracking-[0.12em] text-fx-dust/70">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fx-rule/50">
                    {statementRows.map((row) => {
                      const scale = Math.pow(10, statementAsset.decimals);
                      const fmtAmt = (v: number) => formatAssetAmount(v / scale, statementAsset.decimals);
                      return (
                        <tr key={row.tbTransferId} className="hover:bg-fx-sand/[0.02] transition-colors">
                          <td className="px-3 py-2 font-mono text-[10px] text-fx-dust whitespace-nowrap">
                            {new Date(row.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`font-mono text-[9px] uppercase tracking-wide ${
                              row.sourceType === 'DEPOSIT' ? 'text-emerald-400' :
                              row.sourceType === 'WITHDRAWAL' ? 'text-blue-400' :
                              'text-fx-brass'
                            }`}>
                              {row.sourceType === 'WITHDRAWAL' ? 'WITHDRAW' : row.sourceType}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-fx-dune truncate max-w-[100px]" title={row.sourceNo}>
                            {row.sourceNo}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-emerald-400 font-medium">
                            {row.direction === 'IN' ? `+${fmtAmt(row.amount)}` : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-fx-rust font-medium">
                            {row.direction === 'OUT' ? `-${fmtAmt(row.amount)}` : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-fx-sand font-medium">
                            {fmtAmt(row.runningBalance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal footer */}
            {statementRows.length > 0 && (
              <div className="shrink-0 flex items-center justify-between px-5 py-2.5 border-t border-fx-rule">
                <span className="font-mono text-[9px] text-fx-dust">
                  {statementRows.length} transaction{statementRows.length !== 1 ? 's' : ''}
                </span>
                <span className="font-mono text-[11px] text-fx-sand font-medium">
                  {formatAssetAmount(statementBalance / Math.pow(10, statementAsset.decimals), statementAsset.decimals)} {statementAsset.currency}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardOverview;
