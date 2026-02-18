import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, RefreshCw, Search } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';

interface SwapOutstandingListItem {
  id: string;
  outstandingNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerType: string;
  ownerNo: string | null;
  direction: 'IN' | 'OUT';
  assetCode: string | null;
  asset?: { code?: string | null; decimals?: number | null } | null;
  amount: string;
  status: string;
  createdAt: string;
}

const SwapOutstandingList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<SwapOutstandingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [outstandingNo, setOutstandingNo] = useState('');
  const [ownerNo, setOwnerNo] = useState('');
  const [sourceNo, setSourceNo] = useState('');
  const [assetId, setAssetId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      params.set('sourceType', 'SWAP');
      if (status) params.set('status', status);
      if (direction) params.set('direction', direction);
      if (outstandingNo) params.set('outstandingNo', outstandingNo);
      if (ownerNo) params.set('ownerNo', ownerNo);
      if (sourceNo) params.set('sourceNo', sourceNo);
      if (assetId) params.set('assetId', assetId);
      if (startDate) params.set('startDate', new Date(startDate).toISOString());
      if (endDate) params.set('endDate', new Date(endDate).toISOString());

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings?${params.toString()}`,
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
      console.error('Failed to fetch swap outstandings', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [status, direction]);

  const renderDirection = (value: string) => {
    const classNameMap: Record<string, string> = {
      IN: 'bg-green-100 text-green-800',
      OUT: 'bg-red-100 text-red-800',
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
          <h1 className="text-2xl font-bold text-gray-900">Swap Outstandings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reconciliation records generated from successful swaps
          </p>
        </div>
        <button
          onClick={fetchItems}
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
              <option value="OPEN">OPEN</option>
            </select>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Direction</option>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
            <input
              value={outstandingNo}
              onChange={(e) => setOutstandingNo(e.target.value)}
              placeholder="Outstanding No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={ownerNo}
              onChange={(e) => setOwnerNo(e.target.value)}
              placeholder="Owner No"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={sourceNo}
              onChange={(e) => setSourceNo(e.target.value)}
              placeholder="Source No (Swap No)"
              className="px-3 py-2 border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary"
            />
            <input
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="Asset ID"
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
              onClick={fetchItems}
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Outstanding No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Direction</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Source No (Swap)</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={22} />
                    Loading outstandings...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    No outstandings found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.outstandingNo || 'N/A'}</td>
                    <td className="px-6 py-4">{renderDirection(item.direction)}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ownerNo || 'N/A'}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.sourceNo || 'N/A'}</td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-gray-800">{item.assetCode || item.asset?.code || 'N/A'}</div>
                      <div className="text-xs text-gray-500">
                        {formatAssetAmount(item.amount, item.asset?.decimals)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {new Date(item.createdAt).toLocaleString('en-US')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/dashboard/reconciliation/outstandings/${item.id}`)}
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

export default SwapOutstandingList;
