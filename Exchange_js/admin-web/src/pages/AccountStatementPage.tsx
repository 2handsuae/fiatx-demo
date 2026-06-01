import { useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { adminIconButtonClass, adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

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

interface StatementResult {
  items: StatementRow[];
  currentBalance: number;
  customerNo: string;
  assetCurrency: string;
  decimals: number;
}

const CURRENCIES = ['USDT', 'AED'];

const AccountStatementPage = () => {
  const [customerNo, setCustomerNo] = useState('');
  const [assetCurrency, setAssetCurrency] = useState('USDT');
  const [result, setResult] = useState<StatementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const requestSeqRef = useRef(0);

  const fetchStatement = async () => {
    if (!customerNo.trim()) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams({ customerNo: customerNo.trim(), assetCurrency });
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/account-statement?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch statement.'));
        setResult(null);
        return;
      }
      setResult(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load account statement.');
      setResult(null);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const decimals = result?.decimals ?? 6;
  const scale = Math.pow(10, decimals);
  const formatAmount = (v: number) => {
    const human = v / scale;
    return human.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const items = result?.items ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="Account Statement"
        subtitle="Customer ledger activity by asset"
      >
        <button
          onClick={fetchStatement}
          className={adminIconButtonClass()}
          title="Refresh"
          disabled={!customerNo.trim()}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          placeholder="Customer No…"
          value={customerNo}
          onChange={(e) => setCustomerNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchStatement()}
          className={`${fi} w-44`}
        />
        <select
          value={assetCurrency}
          onChange={(e) => setAssetCurrency(e.target.value)}
          className={`${fi} w-28`}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          onClick={fetchStatement}
          disabled={!customerNo.trim()}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={12} className="mr-1 inline" />
          Search
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {!searched ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-[12px] text-adm-t3">
              Enter a Customer No and select an asset to view the statement.
            </p>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="animate-spin text-adm-t3" size={20} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-[12px] text-adm-t3">
              No transactions found.
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-adm-panel">
              <tr className="border-b border-adm-border">
                <th className={th} style={{ width: 140 }}>Date</th>
                <th className={th} style={{ width: 90 }}>Type</th>
                <th className={th} style={{ width: 140 }}>Reference</th>
                <th className={th} style={{ width: 160 }}>Event</th>
                <th className={`${th} text-right`} style={{ width: 120 }}>In (+)</th>
                <th className={`${th} text-right`} style={{ width: 120 }}>Out (−)</th>
                <th className={`${th} text-right`} style={{ width: 130 }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr
                  key={row.tbTransferId}
                  className="border-b border-adm-border transition-colors hover:bg-adm-hover"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-adm-t3 whitespace-nowrap">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={row.sourceType} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[140px]" title={row.sourceNo}>
                    {row.sourceNo}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                    {row.eventCode}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-adm-green font-semibold">
                    {row.direction === 'IN' ? formatAmount(row.amount) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-adm-red font-semibold">
                    {row.direction === 'OUT' ? formatAmount(row.amount) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-adm-t1 font-semibold">
                    {formatAmount(row.runningBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {result && items.length > 0 && (
        <div className="shrink-0 flex items-center justify-between border-t border-adm-border px-5 py-2">
          <span className="font-mono text-[10px] text-adm-t3">
            {items.length} transaction{items.length !== 1 ? 's' : ''} · {result.assetCurrency}
          </span>
          <span className="font-mono text-[11px] text-adm-t1 font-semibold">
            Balance: {formatAmount(result.currentBalance)} {result.assetCurrency}
          </span>
        </div>
      )}
    </div>
  );
};

export default AccountStatementPage;
