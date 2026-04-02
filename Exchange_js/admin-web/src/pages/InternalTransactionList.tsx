import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

type InternalTransactionItem = {
  id: string;
  internalTxNo: string;
  type: string;
  status: string;
  approvalStatus?: string;
  sourceType: string;
  sourceNo?: string | null;
  amount: string;
  feeAmount: string;
  asset?: {
    code: string;
    type: string;
    network?: string | null;
    decimals?: number;
  };
  fromAddress?: string | null;
  fromIban?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  createdAt: string;
};

type AssetItem = {
  id: string;
  code: string;
  type: string;
  network?: string | null;
};

type WalletItem = {
  id: string;
  walletNo?: string | null;
  walletRole: string;
  ownerType: string;
  availableBalance?: string | null;
  asset?: {
    code?: string | null;
  };
  address?: string | null;
  iban?: string | null;
};

type CreateFormState = {
  purpose: string;
  assetId: string;
  fromWalletId: string;
  toWalletId: string;
  amount: string;
  reason: string;
  referenceNo: string;
  requestId: string;
};

const MANUAL_PURPOSE_OPTIONS = [
  {
    value: 'LIQUIDITY_TOPUP',
    assetType: 'CRYPTO',
    fromRole: 'MASTER',
    toRole: 'LIQ',
  },
  {
    value: 'LIQUIDITY_RETURN',
    assetType: 'CRYPTO',
    fromRole: 'LIQ',
    toRole: 'MASTER',
  },
  {
    value: 'PAYOUT_FUNDING',
    assetType: 'CRYPTO',
    fromRole: 'MASTER',
    toRole: 'PAYOUT',
  },
  {
    value: 'PAYOUT_RETURN',
    assetType: 'CRYPTO',
    fromRole: 'PAYOUT',
    toRole: 'MASTER',
  },
  {
    value: 'POOL_REBALANCING',
    assetType: 'FIAT',
    fromRole: 'CUST_BANK',
    toRole: 'LIQ_BANK',
    label: 'POOL_REBALANCING (CUST_BANK -> LIQ_BANK)',
  },
  {
    value: 'POOL_REBALANCING',
    assetType: 'FIAT',
    fromRole: 'LIQ_BANK',
    toRole: 'CUST_BANK',
    label: 'POOL_REBALANCING (LIQ_BANK -> CUST_BANK)',
  },
] as const;

const PURPOSE_ROLE_ROUTE = MANUAL_PURPOSE_OPTIONS.reduce<
  Record<string, { fromRole: string; toRole: string; assetType: 'CRYPTO' | 'FIAT' }>
>((acc, item) => {
  const routeKey = `${item.value}:${item.fromRole}:${item.toRole}`;
  acc[routeKey] = {
    fromRole: item.fromRole,
    toRole: item.toRole,
    assetType: item.assetType,
  };
  return acc;
}, {});

const INITIAL_FORM_STATE: CreateFormState = {
  purpose: `${MANUAL_PURPOSE_OPTIONS[0].value}:${MANUAL_PURPOSE_OPTIONS[0].fromRole}:${MANUAL_PURPOSE_OPTIONS[0].toRole}`,
  assetId: '',
  fromWalletId: '',
  toWalletId: '',
  amount: '',
  reason: '',
  referenceNo: '',
  requestId: '',
};

const STATUS_COLORS: Record<string, string> = {
  INTERNAL_FUNDS_PENDING: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-orange-100 text-orange-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

const APPROVAL_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

const InternalTransactionList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InternalTransactionItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [searchNo, setSearchNo] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [fromWallets, setFromWallets] = useState<WalletItem[]>([]);
  const [toWallets, setToWallets] = useState<WalletItem[]>([]);
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM_STATE);
  const [error, setError] = useState('');

  const route = PURPOSE_ROLE_ROUTE[form.purpose];
  const selectedPurpose =
    MANUAL_PURPOSE_OPTIONS.find(
      (item) => `${item.value}:${item.fromRole}:${item.toRole}` === form.purpose,
    )?.value || '';

  const assetOptions = useMemo(
    () =>
      assets.map((asset) => ({
        id: asset.id,
        label: `${asset.code}${asset.network ? `-${asset.network}` : ''}`,
      })),
    [assets],
  );

  const hasFilters = useMemo(
    () => Boolean(statusFilter || approvalFilter || searchNo.trim()),
    [approvalFilter, searchNo, statusFilter],
  );

  const selectedFromWallet = useMemo(
    () => fromWallets.find((wallet) => wallet.id === form.fromWalletId) || null,
    [form.fromWalletId, fromWallets],
  );

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (approvalFilter) params.append('approvalStatus', approvalFilter);
      if (searchNo) params.append('internalTxNo', searchNo);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        return;
      }
      setError(await getApiErrorMessage(response, 'Failed to fetch internal transactions.'));
    } catch (error) {
      console.error('Failed to fetch internal transactions', error);
      setError('Failed to fetch internal transactions.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAssetsByType = async (assetType: 'CRYPTO' | 'FIAT') => {
    setAssetsLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/assets?type=${assetType}&status=ACTIVE&take=200`,
      );

      if (response.ok) {
        const result = await response.json();
        const list = (result.items || []) as AssetItem[];
        setAssets(list);
        if (list.length > 0) {
          setForm((prev) => ({
            ...prev,
            assetId:
              list.find((item) => item.id === prev.assetId)?.id || list[0].id,
          }));
        } else {
          setForm((prev) => ({
            ...prev,
            assetId: '',
          }));
        }
      } else {
        setError(await getApiErrorMessage(response, 'Load assets failed.'));
      }
    } catch (error) {
      console.error(`Failed to fetch ${assetType} assets`, error);
      setError('Load assets failed.');
    } finally {
      setAssetsLoading(false);
    }
  };

  const fetchRoleWallets = async () => {
    if (!form.assetId || !route) {
      setFromWallets([]);
      setToWallets([]);
      return;
    }

    setWalletsLoading(true);
    try {
      const [fromRes, toRes] = await Promise.all([
        adminFetch(
          `${import.meta.env.VITE_API_URL}/wallets?assetId=${form.assetId}&status=ACTIVE&walletRole=${route.fromRole}&take=200`,
        ),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/wallets?assetId=${form.assetId}&status=ACTIVE&walletRole=${route.toRole}&take=200`,
        ),
      ]);

      if (!fromRes.ok || !toRes.ok) {
        const message =
          (!fromRes.ok && (await getApiErrorMessage(fromRes, 'Failed to load wallets.'))) ||
          (!toRes.ok && (await getApiErrorMessage(toRes, 'Failed to load wallets.'))) ||
          'Failed to load wallets.';
        setError(message);
        return;
      }

      const fromData = await fromRes.json();
      const toData = await toRes.json();
      const fromList = (fromData.items || []) as WalletItem[];
      const toList = (toData.items || []) as WalletItem[];

      setFromWallets(fromList);
      setToWallets(toList);
      setForm((prev) => {
        const nextFrom =
          fromList.find((item) => item.id === prev.fromWalletId)?.id ||
          fromList[0]?.id ||
          '';
        const nextTo =
          toList.find((item) => item.id === prev.toWalletId)?.id ||
          toList[0]?.id ||
          '';
        return {
          ...prev,
          fromWalletId: nextFrom,
          toWalletId: nextTo,
        };
      });
    } catch (error) {
      console.error('Failed to fetch route wallets', error);
      setError('Load wallets failed.');
    } finally {
      setWalletsLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (!showCreateModal) return;
    fetchRoleWallets();
  }, [showCreateModal, form.assetId, form.purpose]);

  useEffect(() => {
    if (!showCreateModal || !route) return;
    fetchAssetsByType(route.assetType);
  }, [showCreateModal, form.purpose]);

  const openCreateModal = () => {
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setFromWallets([]);
    setToWallets([]);
    setForm(INITIAL_FORM_STATE);
  };

  const handleCreate = async () => {
    if (
      !form.assetId ||
      !form.fromWalletId ||
      !form.toWalletId ||
      !form.amount ||
      !form.reason
    ) {
      alert('Please fill required fields');
      return;
    }

    setCreateSubmitting(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          purpose: selectedPurpose,
          assetId: form.assetId,
          fromWalletId: form.fromWalletId,
          toWalletId: form.toWalletId,
          amount: form.amount,
          reason: form.reason,
          referenceNo: form.referenceNo || undefined,
          requestId: form.requestId || undefined,
        }),
      });

      if (!response.ok) {
        setError(await getApiErrorMessage(response, 'Create failed.'));
        return;
      }

      const result = await response.json();
      const createdId = result?.internalTransaction?.id;

      closeCreateModal();
      await fetchItems();

      if (createdId) {
        navigate(`/exchange/internal-transactions/${createdId}`);
      }
    } catch (error) {
      console.error('Failed to create internal transaction', error);
      setError('Create failed.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleReset = () => {
    setStatusFilter('');
    setApprovalFilter('');
    setSearchNo('');
    setItems([]);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-transactions`);
        if (response.ok) {
          const result = await response.json();
          setItems(result.items || []);
          return;
        }
        setError(await getApiErrorMessage(response, 'Failed to fetch internal transactions.'));
      } catch (resetError) {
        console.error('Failed to reset internal transaction filters', resetError);
        setError('Failed to fetch internal transactions.');
      } finally {
        setLoading(false);
      }
    })();
  };

  const renderWalletLabel = (wallet: WalletItem) => {
    const endpoint = wallet.address || wallet.iban || '-';
    return `${wallet.walletNo || wallet.id} (${wallet.walletRole}) - ${endpoint}`;
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Internal Transactions</h1>
            <p className="text-sm text-gray-500 mt-1">Internal order layer for treasury transfers</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreateModal}
              className={adminButtonClass('listPrimary')}
            >
              <Plus size={16} />
              Create Internal Transaction
            </button>
            <button
              onClick={fetchItems}
              className={adminIconButtonClass()}
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
                  placeholder="Search by Internal Tx No"
                  className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary transition-all"
                />
              </div>
              <button
                onClick={fetchItems}
                className={adminButtonClass('listPrimary')}
              >
                Search
              </button>
              <button
                onClick={handleReset}
                className={adminButtonClass('listSecondary')}
                disabled={!hasFilters && !error}
              >
                Reset
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm focus:outline-none focus:border-brand-primary"
              >
                <option value="">All Status</option>
                <option value="INTERNAL_FUNDS_PENDING">INTERNAL_FUNDS_PENDING</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILED">FAILED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="REJECTED">REJECTED</option>
              </select>

              <select
                value={approvalFilter}
                onChange={(e) => setApprovalFilter(e.target.value)}
                className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm focus:outline-none focus:border-brand-primary"
              >
                <option value="">All Approval</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </div>
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
                {error ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-rose-600">
                      {error}
                    </td>
                  </tr>
                ) : null}
                {!error && loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={20} />
                      Loading internal transactions...
                    </td>
                  </tr>
                ) : !error && items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">No internal transactions found</td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <button
                          className={adminButtonClass('rowKeyLink')}
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
                          {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                          {item.asset?.code || '-'}
                        </div>
                        <div className="text-xs text-gray-500">fee: {item.feeAmount || '0'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div
                          className="text-xs text-gray-500 truncate max-w-[260px]"
                          title={item.fromAddress || item.fromIban || ''}
                        >
                          from: {item.fromAddress || item.fromIban || '-'}
                        </div>
                        <div
                          className="text-xs text-gray-500 truncate max-w-[260px]"
                          title={item.toAddress || item.toIban || ''}
                        >
                          to: {item.toAddress || item.toIban || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 space-y-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {item.status}
                        </span>
                        <div>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              APPROVAL_COLORS[item.approvalStatus || 'APPROVED'] ||
                              'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {(item.approvalStatus || 'APPROVED') as string}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => navigate(`/exchange/internal-transactions/${item.id}`)}
                          className={adminButtonClass('rowLink')}
                        >
                          View
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

      {showCreateModal ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-lg border border-admin-border">
            <div className="flex items-center justify-between px-5 py-4 border-b border-admin-border">
              <h3 className="text-lg font-semibold text-gray-900">Create Internal Transaction</h3>
              <button
                onClick={closeCreateModal}
                className="p-1 text-gray-500 hover:text-gray-800"
                disabled={createSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Purpose</label>
                  <select
                    value={form.purpose}
                    onChange={(e) => {
                      setAssets([]);
                      setFromWallets([]);
                      setToWallets([]);
                      setForm((prev) => ({
                        ...prev,
                        purpose: e.target.value,
                        assetId: '',
                        fromWalletId: '',
                        toWalletId: '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                  >
                    {MANUAL_PURPOSE_OPTIONS.map((item) => {
                      const routeKey = `${item.value}:${item.fromRole}:${item.toRole}`;
                      return (
                        <option key={routeKey} value={routeKey}>
                          {'label' in item ? item.label : item.value}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Asset</label>
                  <select
                    value={form.assetId}
                    onChange={(e) => setForm((prev) => ({ ...prev, assetId: e.target.value }))}
                    className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                    disabled={assetsLoading}
                  >
                    {assetOptions.length === 0 ? (
                      <option value="">
                        {assetsLoading
                          ? 'Loading assets...'
                          : `No ${route?.assetType || 'CRYPTO'} assets`}
                      </option>
                    ) : (
                      assetOptions.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">From Wallet ({route?.fromRole})</label>
                  <select
                    value={form.fromWalletId}
                    onChange={(e) => setForm((prev) => ({ ...prev, fromWalletId: e.target.value }))}
                    className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                    disabled={walletsLoading}
                  >
                    {fromWallets.length === 0 ? (
                      <option value="">{walletsLoading ? 'Loading wallets...' : 'No wallets'}</option>
                    ) : (
                      fromWallets.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {renderWalletLabel(wallet)}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">To Wallet ({route?.toRole})</label>
                  <select
                    value={form.toWalletId}
                    onChange={(e) => setForm((prev) => ({ ...prev, toWalletId: e.target.value }))}
                    className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                    disabled={walletsLoading}
                  >
                    {toWallets.length === 0 ? (
                      <option value="">{walletsLoading ? 'Loading wallets...' : 'No wallets'}</option>
                    ) : (
                      toWallets.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {renderWalletLabel(wallet)}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {selectedFromWallet ? (
                <div className="rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    From Wallet Balance
                  </div>
                  <div className="mt-2 font-mono text-sm text-gray-900">
                    {selectedFromWallet.walletNo || selectedFromWallet.id}
                  </div>
                  <div className="mt-1">
                    Available Balance:{' '}
                    <span className="font-semibold text-brand-primary">
                      {selectedFromWallet.availableBalance || '0'}{' '}
                      {assets.find((asset) => asset.id === form.assetId)?.code || ''}
                    </span>
                  </div>
                </div>
              ) : null}

              <div>
                <label className="block text-sm text-gray-600 mb-1">Amount</label>
                <input
                  type="text"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="e.g. 1.25"
                  className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Reason</label>
                <input
                  type="text"
                  value={form.reason}
                  onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g. Treasury rebalance before payout window"
                  className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Reference No (optional)</label>
                  <input
                    type="text"
                    value={form.referenceNo}
                    onChange={(e) => setForm((prev) => ({ ...prev, referenceNo: e.target.value }))}
                    className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Request ID (optional)</label>
                  <input
                    type="text"
                    value={form.requestId}
                    onChange={(e) => setForm((prev) => ({ ...prev, requestId: e.target.value }))}
                    className="w-full px-3 py-2 border border-admin-border rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={closeCreateModal}
                disabled={createSubmitting}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={
                  createSubmitting ||
                  assetsLoading ||
                  walletsLoading ||
                  assetOptions.length === 0 ||
                  fromWallets.length === 0 ||
                  toWallets.length === 0
                }
                className={adminButtonClass('modalConfirm')}
              >
                {createSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default InternalTransactionList;
