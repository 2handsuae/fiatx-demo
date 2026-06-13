import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import Pagination from '../components/common/Pagination';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';

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

const PAGE_SIZE = 20;

const InternalTransactionList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InternalTransactionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
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
        label: asset.code,
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

  const fetchItems = async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (statusFilter) params.append('status', statusFilter);
      if (approvalFilter) params.append('approvalStatus', approvalFilter);
      if (searchNo) params.append('internalTxNo', searchNo);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(typeof result.total === 'number' ? result.total : 0);
        setCurrentPage(page);
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
        const params = new URLSearchParams();
        params.set('skip', '0');
        params.set('take', String(PAGE_SIZE));
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/internal-transactions?${params.toString()}`,
        );
        if (response.ok) {
          const result = await response.json();
          setItems(result.items || []);
          setTotal(typeof result.total === 'number' ? result.total : 0);
          setCurrentPage(1);
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

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        {/* ── Title bar ── */}
        <PageTitleBar
          title="Internal Transactions"
          meta={`${total} transaction${total === 1 ? '' : 's'}`}
        >
          <button
            onClick={openCreateModal}
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={13} />
            Create Internal Transaction
          </button>
          <button
            onClick={() => void fetchItems(currentPage)}
            className={adminIconButtonClass()}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </PageTitleBar>

        {/* ── Filter bar ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
          <input
            value={searchNo}
            onChange={(e) => setSearchNo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchItems(1)}
            placeholder="Internal Tx No"
            className={`${fi} w-48`}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${fi} w-48`}
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
            className={`${fi} w-40`}
          >
            <option value="">All Approval</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <button onClick={() => fetchItems(1)} className={adminButtonClass('listPrimary')}>
            <Search size={13} />
            Search
          </button>
          <button
            onClick={handleReset}
            disabled={!hasFilters && !error}
            className={adminButtonClass('listSecondary')}
          >
            Reset
          </button>
        </div>

        {/* ── Notices ── */}
        {error && (
          <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        )}

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {(
                  [
                    ['Internal Tx',     'left'],
                    ['Type / Source',   'left'],
                    ['Asset / Amount',  'left'],
                    ['From / To',       'left'],
                    ['Status',          'left'],
                    ['Created',         'left'],
                  ] as [string, 'left' | 'right'][]
                ).map(([label, align]) => (
                  <th
                    key={label}
                    className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                    No internal transactions found.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/exchange/internal-transactions/${item.id}`)}
                >
                  {/* Internal Tx */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.internalTxNo}
                    </span>
                  </td>

                  {/* Type / Source */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{item.type}</div>
                    <div className="font-mono text-[10px] text-adm-t3">
                      {item.sourceType} / {item.sourceNo || '-'}
                    </div>
                  </td>

                  {/* Asset / Amount */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">
                      {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                      {item.asset?.code || '-'}
                    </div>
                    <div className="font-mono text-[10px] text-adm-t3">
                      fee: {item.feeAmount || '0'}
                    </div>
                  </td>

                  {/* From / To */}
                  <td className="px-4 py-2.5">
                    <div
                      className="max-w-[260px] truncate font-mono text-[10px] text-adm-t3"
                      title={item.fromAddress || item.fromIban || ''}
                    >
                      from: {item.fromAddress || item.fromIban || '-'}
                    </div>
                    <div
                      className="max-w-[260px] truncate font-mono text-[10px] text-adm-t3"
                      title={item.toAddress || item.toIban || ''}
                    >
                      to: {item.toAddress || item.toIban || '-'}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusPill value={item.status} />
                      <StatusPill value={item.approvalStatus || 'APPROVED'} />
                    </div>
                  </td>

                  {/* Created */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-adm-t3">
              {total > 0
                ? `Showing ${items.length} / ${total} transaction${total === 1 ? '' : 's'}`
                : 'No internal transactions'}
            </span>
            {total > PAGE_SIZE && (
              <Pagination
                currentPage={currentPage}
                totalItems={total}
                pageSize={PAGE_SIZE}
                onPageChange={(page) => void fetchItems(page)}
              />
            )}
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
