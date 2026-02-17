import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';

type InternalTransactionItem = {
  id: string;
  internalTxNo: string;
  type: string;
  status: string;
  sourceType: string;
  sourceNo?: string | null;
  amount: string;
  feeAmount: string;
  asset?: {
    code: string;
    type: string;
    network?: string | null;
  };
  fromAddress?: string | null;
  toAddress?: string | null;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-orange-100 text-orange-800',
};

const InternalTransactionList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InternalTransactionItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchNo, setSearchNo] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchNo) params.append('internalTxNo', searchNo);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions?${params.toString()}`,
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
      console.error('Failed to fetch internal transactions', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Internal order layer for treasury transfers</p>
        </div>
        <button
          onClick={fetchItems}
          className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
          <div className="relative flex-1 max-w-md flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={searchNo}
                onChange={(e) => setSearchNo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchItems()}
                placeholder="Search by Internal Tx No"
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary transition-all"
              />
            </div>
            <button
              onClick={fetchItems}
              className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
            >
              Search
            </button>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm focus:outline-none focus:border-brand-primary"
          >
            <option value="">All Status</option>
            <option value="CREATED">CREATED</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Internal Tx</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Type / Source</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">From / To</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={20} />
                    Loading internal transactions...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">No internal transactions found</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <button
                        className="font-mono text-xs text-brand-primary font-bold hover:text-blue-800"
                        onClick={() => navigate(`/exchange/internal-transactions/${item.id}`)}
                      >
                        {item.internalTxNo}
                      </button>
                      <div className="text-[10px] text-gray-500 mt-1">
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs font-semibold text-gray-900">{item.type}</div>
                      <div className="text-xs text-gray-500">
                        {item.sourceType} / {item.sourceNo || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {Number(item.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 8,
                        })}{' '}
                        {item.asset?.code || '-'}
                      </div>
                      <div className="text-xs text-gray-500">fee: {item.feeAmount || '0'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-gray-500 truncate max-w-[260px]" title={item.fromAddress || ''}>
                        from: {item.fromAddress || '-'}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-[260px]" title={item.toAddress || ''}>
                        to: {item.toAddress || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {item.status}
                      </span>
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

export default InternalTransactionList;
