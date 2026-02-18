import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, RefreshCw, Search } from 'lucide-react';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

interface SwapQuoteListItem {
  id: string;
  quoteNo: string | null;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  ownerType: string;
  ownerNo: string | null;
  fromAssetCode: string;
  toAssetCode: string;
  fromAsset?: { code: string; decimals?: number | null } | null;
  toAsset?: { code: string; decimals?: number | null } | null;
  amountIn: string;
  amountOut: string;
  rateAllIn: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  swapTransaction?: {
    swapNo: string | null;
  } | null;
}

const SwapQuoteList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<SwapQuoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [quoteNo, setQuoteNo] = useState('');
  const [ownerNo, setOwnerNo] = useState('');
  const [swapNo, setSwapNo] = useState('');
  const [fromAssetId, setFromAssetId] = useState('');
  const [toAssetId, setToAssetId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (quoteNo) params.set('quoteNo', quoteNo);
      if (ownerNo) params.set('ownerNo', ownerNo);
      if (swapNo) params.set('swapNo', swapNo);
      if (fromAssetId) params.set('fromAssetId', fromAssetId);
      if (toAssetId) params.set('toAssetId', toAssetId);
      if (startDate) params.set('startDate', new Date(startDate).toISOString());
      if (endDate) params.set('endDate', new Date(endDate).toISOString());

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/quotes?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else if (response.status === 401) {
        localStorage.removeItem('admin_token');
        navigate('/admin/login');
      }
    } catch (error) {
      console.error('Failed to fetch swap quotes', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotes();
  }, [status]);

  const renderStatusBadge = (value: string) => {
    const classNameMap: Record<string, string> = {
      ACTIVE: 'bg-green-100 text-green-800',
      USED: 'bg-blue-100 text-blue-800',
      EXPIRED: 'bg-gray-100 text-gray-700',
      CANCELLED: 'bg-red-100 text-red-800',
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          classNameMap[value] || 'bg-gray-100 text-gray-700'
        }`}
      >
        {value}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Swap Quotes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Read-only quote snapshots for pricing auditability
          </p>
        </div>
        <button
          onClick={fetchQuotes}
          className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-8 gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="USED">USED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <input
              value={quoteNo}
              onChange={(e) => setQuoteNo(e.target.value)}
              placeholder="Quote No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={ownerNo}
              onChange={(e) => setOwnerNo(e.target.value)}
              placeholder="Owner No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={swapNo}
              onChange={(e) => setSwapNo(e.target.value)}
              placeholder="Linked Swap No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={fromAssetId}
              onChange={(e) => setFromAssetId(e.target.value)}
              placeholder="From Asset ID"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={toAssetId}
              onChange={(e) => setToAssetId(e.target.value)}
              placeholder="To Asset ID"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <button
              onClick={fetchQuotes}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
            >
              <Search size={16} />
              Search
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Quote No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Linked Swap No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Pair</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Lifecycle</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                    <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={22} />
                    Loading quotes...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                    No quotes found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.quoteNo || 'N/A'}</td>
                    <td className="px-6 py-4">{renderStatusBadge(item.status)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ownerNo || 'N/A'}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.swapTransaction?.swapNo || 'N/A'}</td>
                    <td className="px-6 py-4 font-mono text-gray-700">
                      {item.fromAssetCode} → {item.toAssetCode}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-red-600">
                        {formatAssetAmount(item.amountIn, item.fromAsset?.decimals)} {item.fromAssetCode}
                      </div>
                      <div className="text-green-600 text-xs">
                        {formatAssetAmount(item.amountOut, item.toAsset?.decimals)} {item.toAssetCode}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-700">
                      {formatRate8(item.rateAllIn)}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      <div>C: {new Date(item.createdAt).toLocaleString('en-US')}</div>
                      <div>E: {new Date(item.expiresAt).toLocaleString('en-US')}</div>
                      {item.usedAt && <div>U: {new Date(item.usedAt).toLocaleString('en-US')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/dashboard/pricing/quotes/${item.id}`)}
                        className="p-1.5 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                        title="View Details"
                      >
                        <Eye size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SwapQuoteList;
