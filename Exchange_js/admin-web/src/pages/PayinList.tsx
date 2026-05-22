import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { getPayinStatusBadgeClass } from '../utils/depositActionMap';

interface PayinItem {
  id: string;
  payinNo: string;
  status: string;
  displayStatus?: string | null;
  type: string;
  amount: string;
  asset: { code: string; type: string; decimals?: number };
  txHash: string | null;
  depositId: string | null;
  transactionNo: string | null;
  deposit?: { depositNo: string } | null;
  createdAt?: string;
  receivedAt: string | null;
}

const PAYIN_STATUSES = ['DETECTED', 'CONFIRMING', 'CONFIRMED', 'CLEARED', 'FAILED'];

const PayinList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<PayinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [payinNoFilter, setPayinNoFilter] = useState('');
  const [txHashFilter, setTxHashFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchList = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (txHashFilter) params.append('txHash', txHashFilter);
      if (payinNoFilter) params.append('payinNo', payinNoFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/treasury/payins?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load payins'));
      }
      const result = await response.json();
      let filtered = result.items || [];
      if (typeFilter) {
        filtered = filtered.filter(
          (i: PayinItem) => i.type?.toUpperCase() === typeFilter.toUpperCase(),
        );
      }
      setItems(filtered);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [statusFilter, typeFilter, startDate, endDate]);

  const handleSearch = () => fetchList();

  const truncateHash = (hash: string | null) => {
    if (!hash || hash.length < 14) return hash || '—';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Payin Transactions</h1>
        <button onClick={fetchList} className={adminIconButtonClass()}>
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 border-b border-admin-border p-4">
          <div className="relative flex-1 min-w-[140px] max-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={payinNoFilter}
              onChange={(e) => setPayinNoFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Payin No..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg py-2 pl-9 pr-3 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <input
              type="text"
              value={txHashFilter}
              onChange={(e) => setTxHashFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Tx Hash..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            {PAYIN_STATUSES.map((s) => (
              <option key={s} value={s}>{formatRailStatusLabel(s)}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            <option value="CRYPTO">Crypto</option>
            <option value="FIAT">Fiat</option>
          </select>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm" />
          <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>Search</button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Payin No</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 text-right">Amount</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Tx Hash</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Deposit</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">
                  <RefreshCw className="mx-auto animate-spin mb-2" size={24} /> Loading...
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">No payins found</td></tr>
              ) : (
                items.map((item) => {
                  const ns = normalizeRailDisplayStatus(item.displayStatus || item.status);
                  const depNo = item.deposit?.depositNo || item.transactionNo;
                  return (
                    <tr
                      key={item.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      onClick={() => navigate(`/dashboard/treasury/payins/${item.id}`)}
                    >
                      <td className="px-6 py-3 font-semibold text-amber-600">{item.payinNo}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPayinStatusBadgeClass(ns)}`}>
                          {formatRailStatusLabel(ns)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold ${item.type?.toUpperCase() === 'CRYPTO' ? 'text-amber-600' : 'text-blue-600'}`}>
                          {formatTransactionTypeLabel(item.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{truncateHash(item.txHash)}</td>
                      <td className="px-4 py-3 text-blue-600 text-xs">{depNo || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {(item.createdAt || item.receivedAt) ? new Date(item.createdAt || item.receivedAt!).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-400">{'›'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PayinList;
