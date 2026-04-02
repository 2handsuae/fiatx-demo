import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Repeat, ShieldCheck } from 'lucide-react';
import { JsonBlock } from '../components/governance/GovernanceUi';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

type CollectionWalletItem = {
  walletId: string;
  walletNo: string | null;
  assetId: string;
  assetCode: string;
  assetNetwork: string | null;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName: string | null;
  availableBalance: string;
  collectionAmountThreshold: string | null;
  collectionMaxAgeMinutes: number | null;
  earliestEligibleDepositAt: string | null;
  eligibleDepositAgeMinutes: number | null;
  shouldCollect: boolean;
  latestCollectionSummary: {
    internalTransactionId: string;
    internalTxNo: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
  } | null;
};

type CollectionWalletPage = {
  items: CollectionWalletItem[];
  total: number;
};

type CollectionActionResult = {
  walletId?: string;
  walletNo?: string | null;
  action?: string;
  reason?: string;
  internalTransactionId?: string;
  internalFundId?: string;
  existingPendingAmount?: string;
  expectedCollectionAmount?: string;
  availableBalance?: string;
  shouldCollect?: boolean;
  collectionAmountThreshold?: string | null;
  collectionMaxAgeMinutes?: number | null;
};

const InternalCollectionsPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [processingWalletId, setProcessingWalletId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionWalletItem[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CollectionActionResult | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions/collection-wallets?take=100`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load deposit wallet monitor.'),
        );
      }
      const payload = (await response.json()) as CollectionWalletPage;
      setItems(payload.items || []);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load deposit wallet monitor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const runAction = async (walletId: string, dryRun: boolean) => {
    setProcessingWalletId(walletId);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions/collection-wallets/${walletId}/reconcile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dryRun }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to run wallet-driven collection.'),
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      setResult(payload);
      await fetchItems();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to run wallet-driven collection.');
    } finally {
      setProcessingWalletId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Treasury Center - Deposit Wallet Monitor
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor DEPOSIT wallets by balance and age thresholds, then dry-run or create
            wallet-driven full-balance collections.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchItems()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-amber-900">
                Last Action Result: {result.action || 'UNKNOWN'}
              </div>
              <div className="text-sm text-amber-900">
                {result.reason || 'Collection request completed.'}
              </div>
              {result.expectedCollectionAmount ? (
                <div className="text-xs text-amber-800">
                  Expected amount: {result.expectedCollectionAmount}
                </div>
              ) : null}
              {result.existingPendingAmount ? (
                <div className="text-xs text-amber-800">
                  Existing pending amount: {result.existingPendingAmount}
                </div>
              ) : null}
            </div>
            {result.internalTransactionId ? (
              <button
                type="button"
                onClick={() => navigate(`/exchange/internal-transactions/${result.internalTransactionId}`)}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                <LinkIcon />
                View Internal Transaction
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Deposit Wallet
                </th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Owner / Asset
                </th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Available
                </th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Thresholds
                </th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Eligibility
                </th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Latest Collection
                </th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <RefreshCw className="mx-auto mb-2 animate-spin text-brand-primary" size={20} />
                    Loading deposit wallets...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No deposit wallets found
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const processing = processingWalletId === item.walletId;
                  return (
                    <tr key={item.walletId} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs font-bold text-brand-primary">
                          {item.walletNo || item.walletId}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">{item.walletId}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">
                          {item.ownerName || item.ownerNo || item.ownerId || '-'}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {item.assetCode}
                          {item.assetNetwork ? ` / ${item.assetNetwork}` : ''}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-gray-900">
                          {item.availableBalance} {item.assetCode}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        <div>
                          amount ≥ {item.collectionAmountThreshold || '-'} {item.assetCode}
                        </div>
                        <div className="mt-1">
                          age ≥{' '}
                          {item.collectionMaxAgeMinutes != null
                            ? `${item.collectionMaxAgeMinutes} min`
                            : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            item.shouldCollect
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.shouldCollect ? 'READY_TO_COLLECT' : 'WAITING'}
                        </span>
                        <div className="mt-2 text-xs text-gray-500">
                          Earliest deposit:{' '}
                          {item.earliestEligibleDepositAt
                            ? new Date(item.earliestEligibleDepositAt).toLocaleString()
                            : '-'}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Age:{' '}
                          {item.eligibleDepositAgeMinutes != null
                            ? `${item.eligibleDepositAgeMinutes} min`
                            : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        {item.latestCollectionSummary ? (
                          <>
                            <div className="font-medium text-gray-900">
                              {item.latestCollectionSummary.internalTxNo}
                            </div>
                            <div className="mt-1">{item.latestCollectionSummary.status}</div>
                          </>
                        ) : (
                          'No previous collection'
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void runAction(item.walletId, true)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-admin-border bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <ShieldCheck size={14} />
                            {processing ? 'Running...' : 'Dry Run Collection'}
                          </button>
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void runAction(item.walletId, false)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-xs font-medium text-white hover:bg-brand-primary/90 disabled:opacity-50"
                          >
                            <Repeat size={14} />
                            {processing ? 'Creating...' : 'Create Collection'}
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

      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <JsonBlock
          title="Last Action Result"
          value={result || { message: 'Run a dry-run or create a wallet-driven collection.' }}
        />
      </div>
    </div>
  );
};

const LinkIcon = () => <Repeat size={14} />;

export default InternalCollectionsPage;
