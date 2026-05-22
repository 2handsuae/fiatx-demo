// admin-web/src/pages/DepositTransactionList.tsx
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
  formatStatusLabel,
  formatTransactionTypeLabel,
} from '../utils/transactionRootDisplay';
import { getDepositStatusBadgeClass } from '../utils/depositActionMap';
import Pagination from '../components/common/Pagination';

interface DepositItem {
  id: string;
  depositNo: string;
  ownerNo: string | null;
  ownerId: string;
  ownerType: string;
  status: string;
  amount: string;
  type?: string | null;
  asset: { code: string; type: string; decimals?: number };
  createdAt: string;
}

const DEPOSIT_STATUSES = [
  'PAYIN_PENDING', 'COMPLIANCE_PENDING', 'ACTION_PENDING', 'FROZEN',
  'SUCCESS', 'REJECTED', 'FAILED', 'EXPIRED', 'CONFISCATED',
];

const DepositTransactionList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<DepositItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [depositNoFilter, setDepositNoFilter] = useState('');
  const [ownerNoFilter, setOwnerNoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const fetchList = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('skip', String((page - 1) * pageSize));
      params.append('take', String(pageSize));
      if (depositNoFilter) params.append('depositNo', depositNoFilter);
      if (ownerNoFilter) params.append('ownerNo', ownerNoFilter);
      if (statusFilter) params.append('status', statusFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      // Note: type filter is client-side since the backend doesn't have a type param yet
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load'));
      }
      const result = await response.json();
      let filteredItems = result.items || [];
      if (typeFilter) {
        filteredItems = filteredItems.filter(
          (i: DepositItem) => (i.type || i.asset.type)?.toUpperCase() === typeFilter.toUpperCase(),
        );
      }
      setItems(filteredItems);
      setTotal(result.total || 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchList();
  }, [statusFilter, typeFilter, startDate, endDate, page]);

  const handleSearch = () => {
    setPage(1);
    void fetchList();
  };

  return (
    <div className="space-y-6">
      {/* Title Bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Deposit Transactions</h1>
        <button onClick={() => void fetchList()} className={adminIconButtonClass()}>
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 border-b border-admin-border p-4">
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={depositNoFilter}
              onChange={(e) => setDepositNoFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Deposit No..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg py-2 pl-9 pr-3 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <input
              type="text"
              value={ownerNoFilter}
              onChange={(e) => setOwnerNoFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Owner No..."
              className="w-full rounded-lg border border-admin-border bg-admin-content-bg px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            {DEPOSIT_STATUSES.map((s) => (
              <option key={s} value={s}>{formatStatusLabel(s)}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            <option value="CRYPTO">Crypto</option>
            <option value="FIAT">Fiat</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm"
          />
          <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
            Search
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Deposit No</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 text-right">Amount</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Owner</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-500">
                  <RefreshCw className="mx-auto animate-spin mb-2" size={24} /> Loading...
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-500">No deposits found</td></tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                    onClick={() => navigate(`/exchange/deposit-transactions/${item.id}`)}
                  >
                    <td className="px-6 py-3">
                      <span className="font-semibold text-amber-600">{item.depositNo}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getDepositStatusBadgeClass(item.status)}`}>
                        {formatStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${(item.type || item.asset.type)?.toUpperCase() === 'CRYPTO' ? 'text-amber-600' : 'text-blue-600'}`}>
                        {formatTransactionTypeLabel(item.type || item.asset.type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-blue-600">{item.ownerNo || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-400">›</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
};

export default DepositTransactionList;
