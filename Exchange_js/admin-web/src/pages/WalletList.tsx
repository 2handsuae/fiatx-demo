import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Plus } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';

interface WalletItem {
  id: string;
  walletNo: string | null;
  walletRole?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  asset: { code: string; type: string; network?: string | null; decimals?: number };
  availableBalance?: string;
  restrictedBalance?: string;
  totalBalance?: string;
  status: string;
  updatedAt: string;
  balanceUpdatedAt?: string | null;
}

const WalletList = () => {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [ownerTypeFilter, setOwnerTypeFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerIdSearch, setOwnerIdSearch] = useState('');

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';

    const pad = (num: number) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds(),
    )}`;
  };

  const formatBalance = (value: string | undefined, decimals?: number) =>
    formatAssetAmount(value ?? '0', decimals);

  const getStatusActionLabel = (status: string) => {
    if (status === 'ACTIVE') return '停用';
    if (status === 'DISABLED') return '启用';
    return null;
  };

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (ownerTypeFilter) params.append('ownerType', ownerTypeFilter);
      if (typeFilter) params.append('type', typeFilter);
      if (statusFilter) params.append('status', statusFilter);
      if (ownerIdSearch) params.append('ownerId', ownerIdSearch);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (response.ok) {
        const result = await response.json();
        setWallets(result.items || []);
      } else if (response.status === 401) {
        localStorage.removeItem('admin_token');
        navigate('/admin/login');
      }
    } catch (error) {
      console.error('Failed to fetch wallets', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, [ownerTypeFilter, typeFilter, statusFilter]);

  const handleStatusChange = async (id: string, currentStatus: string) => {
    if (currentStatus === 'FROZEN') return;

    const newStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (
      !window.confirm(
        `Are you sure you want to ${newStatus === 'DISABLED' ? 'disable' : 'enable'} this wallet?`,
      )
    ) {
      return;
    }

    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/wallets/${id}/status`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: newStatus }),
        },
      );

      if (response.ok) {
        fetchWallets();
      } else {
        alert('Failed to update status');
      }
    } catch (error) {
      console.error('Failed to update status', error);
    }
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ACTIVE: 'bg-green-100 text-green-800',
      FROZEN: 'bg-yellow-100 text-yellow-800',
      DISABLED: 'bg-red-100 text-red-800',
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}
      >
        {status}
      </span>
    );
  };

  const renderRoleBadge = (role?: string) => {
    const colors: Record<string, string> = {
      DEPOSIT: 'bg-blue-100 text-blue-700',
      MASTER: 'bg-indigo-100 text-indigo-700',
      PAYOUT: 'bg-purple-100 text-purple-700',
      LIQ: 'bg-orange-100 text-orange-700',
      CUST_BANK: 'bg-teal-100 text-teal-700',
      LIQ_BANK: 'bg-amber-100 text-amber-700',
      GENERAL: 'bg-gray-100 text-gray-700',
    };
    const label = role || 'GENERAL';
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${colors[label] || 'bg-gray-100 text-gray-700'}`}
      >
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Wallet / Account Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            列表展示关键运营信息，详情页查看完整字段
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchWallets}
            className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/dashboard/treasury/wallets/create')}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors shadow-sm"
          >
            <Plus size={20} /> New Wallet
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
                value={ownerIdSearch}
                onChange={(e) => setOwnerIdSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchWallets()}
                placeholder="Search by Owner ID..."
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
              />
            </div>
            <button
              onClick={fetchWallets}
              className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
            >
              Search
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={ownerTypeFilter}
              onChange={(e) => setOwnerTypeFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Owners</option>
              <option value="PLATFORM">Platform</option>
              <option value="CUSTOMER">Customer</option>
              <option value="LIQUIDITY_PROVIDER">LP</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Types</option>
              <option value="CRYPTO_ADDRESS">Crypto Address</option>
              <option value="FIAT_BANK">Fiat Bank</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="FROZEN">Frozen</option>
              <option value="DISABLED">Disabled</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  WalletNo
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Owner
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Asset/Network
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Available
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Restricted
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Updated
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && wallets.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw
                        className="animate-spin mb-2 text-brand-primary"
                        size={24}
                      />
                      Loading wallets...
                    </div>
                  </td>
                </tr>
              ) : wallets.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    No wallets found
                  </td>
                </tr>
              ) : (
                wallets.map((wallet) => {
                  const statusActionLabel = getStatusActionLabel(wallet.status);
                  const ownerLabel =
                    wallet.ownerName || wallet.ownerNo || wallet.ownerId || '-';
                  const updatedAt = wallet.balanceUpdatedAt || wallet.updatedAt;

                  return (
                    <tr
                      key={wallet.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs text-brand-primary font-bold">
                          {wallet.walletNo || '-'}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">
                          {wallet.type}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {renderRoleBadge(wallet.walletRole)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900 font-medium">
                          {ownerLabel}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {wallet.ownerType}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900 font-medium">
                          {wallet.asset?.code || '-'}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {wallet.asset?.network || 'NA'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {renderStatusBadge(wallet.status)}
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-900">
                        {formatBalance(wallet.availableBalance, wallet.asset?.decimals)}{' '}
                        <span className="text-xs text-gray-500">
                          {wallet.asset?.code || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-900">
                        {formatBalance(wallet.restrictedBalance, wallet.asset?.decimals)}{' '}
                        <span className="text-xs text-gray-500">
                          {wallet.asset?.code || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-900">
                        {formatBalance(wallet.totalBalance, wallet.asset?.decimals)}{' '}
                        <span className="text-xs text-gray-500">
                          {wallet.asset?.code || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {formatDateTime(updatedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-sm">
                          {statusActionLabel ? (
                            <>
                              <button
                                onClick={() =>
                                  handleStatusChange(wallet.id, wallet.status)
                                }
                                className="text-brand-primary hover:underline"
                              >
                                {statusActionLabel}
                              </button>
                              <span className="text-gray-300">|</span>
                            </>
                          ) : null}
                          <button
                            onClick={() =>
                              navigate(
                                `/dashboard/treasury/wallets/${wallet.id}`,
                              )
                            }
                            className="text-brand-primary hover:underline"
                          >
                            查看
                          </button>
                        </div>
                      </td>
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

export default WalletList;
