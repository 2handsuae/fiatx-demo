import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';

type InternalFundItem = {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  feeAmount: string;
  txHash?: string | null;
  confirmations?: number;
  fromAddress?: string | null;
  toAddress?: string | null;
  createdAt: string;
  asset?: {
    code: string;
    type: string;
    network?: string | null;
    decimals?: number;
  };
  internalTransaction?: {
    id: string;
    internalTxNo: string;
    status: string;
    type: string;
  };
};

type ActionItem = {
  action: string;
  label: string;
  color: string;
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-800',
  SIGNING: 'bg-indigo-100 text-indigo-800',
  BROADCASTED: 'bg-blue-100 text-blue-800',
  CONFIRMING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CLEAR: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  TIMEOUT: 'bg-orange-100 text-orange-800',
  RETURNED: 'bg-purple-100 text-purple-800',
  CANCELLED: 'bg-slate-100 text-slate-800',
};

function getActions(item: InternalFundItem): ActionItem[] {
  const status = item.status;
  const isFiat = item.asset?.type === 'FIAT';
  const actions: ActionItem[] = [];

  if (!isFiat) {
    if (status === 'CREATED') {
      actions.push({ action: 'SIGN', label: 'Sign', color: 'bg-blue-600 text-white hover:bg-blue-700' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 text-white hover:bg-slate-700' });
    } else if (status === 'SIGNING') {
      actions.push({ action: 'BROADCAST', label: 'Broadcast', color: 'bg-indigo-600 text-white hover:bg-indigo-700' });
      actions.push({ action: 'SIGN_FAIL', label: 'Sign Fail', color: 'bg-red-600 text-white hover:bg-red-700' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 text-white hover:bg-slate-700' });
    } else if (status === 'BROADCASTED') {
      actions.push({ action: 'SEEN_IN_MEMPOOL', label: 'Seen', color: 'bg-blue-600 text-white hover:bg-blue-700' });
      actions.push({ action: 'DROP', label: 'Drop', color: 'bg-red-600 text-white hover:bg-red-700' });
      actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-orange-600 text-white hover:bg-orange-700' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 text-white hover:bg-slate-700' });
    } else if (status === 'CONFIRMING') {
      actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 text-white hover:bg-green-700' });
      actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 text-white hover:bg-red-700' });
      actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-orange-600 text-white hover:bg-orange-700' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 text-white hover:bg-slate-700' });
    } else if (status === 'CONFIRMED') {
      actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 text-white hover:bg-emerald-700' });
    }

    return actions;
  }

  if (status === 'CREATED') {
    actions.push({ action: 'SUBMIT', label: 'Submit', color: 'bg-blue-600 text-white hover:bg-blue-700' });
    actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 text-white hover:bg-slate-700' });
  } else if (status === 'CONFIRMING') {
    actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 text-white hover:bg-green-700' });
    actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 text-white hover:bg-red-700' });
    actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-orange-600 text-white hover:bg-orange-700' });
    actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 text-white hover:bg-slate-700' });
  } else if (status === 'CONFIRMED') {
    actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 text-white hover:bg-emerald-700' });
    actions.push({ action: 'RETURN', label: 'Return', color: 'bg-purple-600 text-white hover:bg-purple-700' });
  } else if (status === 'CLEAR') {
    actions.push({ action: 'RETURN', label: 'Return', color: 'bg-purple-600 text-white hover:bg-purple-700' });
  }

  return actions;
}

const InternalFundList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [items, setItems] = useState<InternalFundItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchNo, setSearchNo] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchNo) params.append('internalFundNo', searchNo);

      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else if (response.status === 401) {
        localStorage.removeItem('admin_token');
        navigate('/admin/login');
      }
    } catch (error) {
      console.error('Failed to fetch internal funds', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [statusFilter]);

  const handleStatusAction = async (id: string, action: string) => {
    setProcessingId(id);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds/${id}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const err = await response.json();
        alert(`Action failed: ${err.message || 'Unknown error'}`);
      } else {
        await fetchItems();
      }
    } catch (error) {
      console.error('Failed to update internal fund', error);
      alert('Network error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateMock = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds/mock`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const err = await response.json();
        alert(`Create mock failed: ${err.message || 'Unknown error'}`);
      }
      await fetchItems();
    } catch (error) {
      console.error('Failed to create mock internal fund', error);
      alert('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Funds</h1>
          <p className="text-sm text-gray-500 mt-1">Atomic transfer facts with simulation actions</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateMock}
            className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 text-sm"
          >
            Create Mock Internal Fund
          </button>
          <button
            onClick={fetchItems}
            className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
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
                placeholder="Search by Internal Fund No"
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
            <option value="SIGNING">SIGNING</option>
            <option value="BROADCASTED">BROADCASTED</option>
            <option value="CONFIRMING">CONFIRMING</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="CLEAR">CLEAR</option>
            <option value="FAILED">FAILED</option>
            <option value="TIMEOUT">TIMEOUT</option>
            <option value="RETURNED">RETURNED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Internal Fund</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Internal Tx</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">From / To</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={20} />
                    Loading internal funds...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">No internal funds found</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <button
                        className="font-mono text-xs text-brand-primary font-bold hover:text-blue-800"
                        onClick={() => navigate(`/dashboard/treasury/internal-funds/${item.id}`)}
                      >
                        {item.internalFundNo}
                      </button>
                      <div className="text-[10px] text-gray-500 mt-1">{new Date(item.createdAt).toLocaleString()}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{item.txHash || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        className="font-mono text-xs text-brand-primary hover:text-blue-800"
                        onClick={() =>
                          item.internalTransaction?.id &&
                          navigate(`/exchange/internal-transactions/${item.internalTransaction.id}`)
                        }
                      >
                        {item.internalTransaction?.internalTxNo || '-'}
                      </button>
                      <div className="text-xs text-gray-500 mt-1">{item.internalTransaction?.type || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                        {item.asset?.code || '-'}
                      </div>
                      <div className="text-xs text-gray-500">
                        fee: {formatAssetAmount(item.feeAmount, item.asset?.decimals)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-gray-500 truncate max-w-[240px]" title={item.fromAddress || ''}>
                        from: {item.fromAddress || '-'}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-[240px]" title={item.toAddress || ''}>
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
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2 flex-wrap">
                        {getActions(item).map((action) => (
                          <button
                            key={`${item.id}-${action.action}`}
                            disabled={processingId === item.id}
                            onClick={() => handleStatusAction(item.id, action.action)}
                            className={`px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50 ${action.color}`}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
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

export default InternalFundList;
