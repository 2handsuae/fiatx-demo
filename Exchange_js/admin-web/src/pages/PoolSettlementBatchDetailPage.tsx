import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  FileJson,
  Layers,
  RefreshCw,
  Send,
  Wallet,
} from 'lucide-react';
import {
  ActionCard,
  DetailCard,
  InfoField,
  JsonBlock,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type BatchSummary = {
  scannedSourceCount?: number;
  routableSourceCount?: number;
  skippedSourceCount?: number;
  bucketCount?: number;
  nettableBucketCount?: number;
  itemCount?: number;
  zeroNetSourceCount?: number;
  skippedSourcesByReason?: Record<string, number>;
};

type AssetInfo = {
  id: string;
  code: string;
  type?: string | null;
  network?: string | null;
};

type WalletInfo = {
  id: string;
  walletNo?: string | null;
  walletRole?: string | null;
};

type InternalTransactionInfo = {
  id: string;
  internalTxNo?: string | null;
  status?: string | null;
  batchItemId?: string;
};

type PoolSettlementBatchItem = {
  id: string;
  status: string;
  assetId: string;
  asset?: AssetInfo | null;
  walletPairKey: string;
  walletAId: string;
  walletBId: string;
  walletA?: WalletInfo | null;
  walletB?: WalletInfo | null;
  netDirection: string;
  netAmount: string;
  submittedAmount: string;
  settledAmount: string;
  failedReason?: string | null;
  internalTransactionId?: string | null;
  internalTransaction?: InternalTransactionInfo | null;
};

type PoolSettlementBatchItemSource = {
  id: string;
  batchItemId?: string | null;
  sourceFamily: string;
  sourceId: string;
  assetId: string;
  asset?: AssetInfo | null;
  fromWalletId: string;
  toWalletId: string;
  fromWallet?: WalletInfo | null;
  toWallet?: WalletInfo | null;
  direction: string;
  sourceAmount: string;
  nettedAmount: string;
  settledAmount: string;
  status: string;
  closeReason?: string | null;
  createdAt: string;
};

type PoolSettlementBatchDetail = {
  id: string;
  batchNo: string;
  status: string;
  cutoffAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
  approvalCaseId?: string | null;
  createdByUserId: string;
  autoCreated: boolean;
  summaryJson?: BatchSummary | null;
  metadataJson?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  items: PoolSettlementBatchItem[];
  itemSources: PoolSettlementBatchItemSource[];
  internalTransactions?: InternalTransactionInfo[];
};

const BATCH_STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-amber-100 text-amber-800',
  APPROVAL_PENDING: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  EXECUTING: 'bg-sky-100 text-sky-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  PARTIAL_FAILED: 'bg-orange-100 text-orange-800',
  FAILED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-100 text-slate-800',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  READY: 'bg-amber-100 text-amber-800',
  EXECUTING: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
  NETTED: 'bg-slate-100 text-slate-800',
};

const PoolSettlementBatchDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<PoolSettlementBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canSubmit = hasAnyPermission([PERMISSIONS.POOL_SETTLEMENT_BATCH_SUBMIT]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Pool settlement batch id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pool-settlement-batches/${id}`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load pool settlement batch detail.'),
        );
      }

      const data = (await response.json()) as PoolSettlementBatchDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to load pool settlement batch detail.',
      );
    } finally {
      setLoading(false);
    }
  };

  const submitBatch = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pool-settlement-batches/${id}/submit`,
        {
          method: 'POST',
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to submit pool settlement batch.'),
        );
      }

      setMessage('Pool settlement batch submitted for approval.');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to submit pool settlement batch.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  const skippedEntries = useMemo(() => {
    const skipped = detail?.summaryJson?.skippedSourcesByReason;
    if (!skipped || typeof skipped !== 'object') return [];
    return Object.entries(skipped);
  }, [detail]);

  const nettedWithoutItemSources = useMemo(
    () => (detail?.itemSources || []).filter((itemSource) => !itemSource.batchItemId),
    [detail],
  );

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading pool settlement batch...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/dashboard/treasury/pool-settlement-batches')}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft size={16} />
          Back to Pool Settlement Batches
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Pool settlement batch not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/treasury/pool-settlement-batches')}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Treasury Center - Pool Settlement Batch Detail
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Inspect linked sources, netted rows, and derived treasury execution before approval.
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchDetail()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Batch Summary" icon={<Layers size={18} />} columns={3}>
        <InfoField label="Batch No" value={detail.batchNo} mono />
        <InfoField
          label="Status"
          value={<StatusBadge value={detail.status} colors={BATCH_STATUS_COLORS} />}
        />
        <InfoField label="Auto Created" value={detail.autoCreated ? 'Yes' : 'No'} />
        <InfoField label="Cutoff At" value={formatDateTime(detail.cutoffAt)} />
        <InfoField label="Submitted At" value={formatDateTime(detail.submittedAt)} />
        <InfoField label="Approved At" value={formatDateTime(detail.approvedAt)} />
        <InfoField label="Closed At" value={formatDateTime(detail.closedAt)} />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
        <InfoField label="Created By" value={detail.createdByUserId} />
        <InfoField label="Approval Case Id" value={detail.approvalCaseId} mono />
        <InfoField
          label="Approval Link"
          value={
            detail.approvalCaseId && canViewApproval ? (
              <Link
                to={`/dashboard/control-gates/approvals/${detail.approvalCaseId}`}
                className="text-brand-primary hover:underline"
              >
                View Approval Detail
              </Link>
            ) : (
              '-'
            )
          }
        />
      </DetailCard>

      <DetailCard title="Netted Summary" icon={<ArrowRightLeft size={18} />} columns={3}>
        <InfoField label="Scanned Sources" value={detail.summaryJson?.scannedSourceCount} />
        <InfoField label="Routable Sources" value={detail.summaryJson?.routableSourceCount} />
        <InfoField label="Skipped Sources" value={detail.summaryJson?.skippedSourceCount} />
        <InfoField label="Buckets" value={detail.summaryJson?.bucketCount} />
        <InfoField label="Created Items" value={detail.summaryJson?.itemCount} />
        <InfoField label="Netted Without Item" value={detail.summaryJson?.zeroNetSourceCount} />
      </DetailCard>

      {skippedEntries.length ? (
        <DetailCard title="Skipped Source Summary" icon={<Wallet size={18} />} columns={2}>
          {skippedEntries.map(([reason, count]) => (
            <InfoField key={reason} label={reason} value={count} />
          ))}
        </DetailCard>
      ) : null}

      <DetailCard title="Batch Items" icon={<Layers size={18} />} columns={1}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Item</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Wallet Pair</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Net</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Submission</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Internal Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {detail.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No batch items were generated for this batch.
                  </td>
                </tr>
              ) : (
                detail.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{item.id}</div>
                      {item.failedReason ? (
                        <div className="mt-1 text-xs text-rose-600">{item.failedReason}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={item.status} colors={ITEM_STATUS_COLORS} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.asset?.code || item.assetId}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>{item.walletPairKey}</div>
                      <div className="mt-1">
                        A: {item.walletA?.walletNo || item.walletAId} / B:{' '}
                        {item.walletB?.walletNo || item.walletBId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>{item.netDirection}</div>
                      <div className="mt-1">Net {item.netAmount}</div>
                      <div className="mt-1">Settled {item.settledAmount}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      Submitted {item.submittedAmount}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {item.internalTransactionId ? (
                        <div>
                          <div>{item.internalTransaction?.internalTxNo || item.internalTransactionId}</div>
                          <div className="mt-1">
                            {item.internalTransaction?.status || 'Linked'}
                          </div>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DetailCard>

      <DetailCard title="Item Sources" icon={<Wallet size={18} />} columns={1}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Source</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Linked Item</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Route</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Amounts</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {detail.itemSources.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No item sources found.
                  </td>
                </tr>
              ) : (
                detail.itemSources.map((itemSource) => (
                  <tr key={itemSource.id}>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div className="font-medium text-gray-900">{itemSource.sourceFamily}</div>
                      <div className="mt-1">{itemSource.sourceId}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {itemSource.batchItemId || 'Netted without item'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {itemSource.asset?.code || itemSource.assetId}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>{itemSource.direction}</div>
                      <div className="mt-1">
                        {itemSource.fromWallet?.walletNo || itemSource.fromWalletId} to{' '}
                        {itemSource.toWallet?.walletNo || itemSource.toWalletId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>Source {itemSource.sourceAmount}</div>
                      <div className="mt-1">Netted {itemSource.nettedAmount}</div>
                      <div className="mt-1">Settled {itemSource.settledAmount}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <div>{itemSource.status}</div>
                      <div className="mt-1">{itemSource.closeReason || '-'}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DetailCard>

      {nettedWithoutItemSources.length ? (
        <DetailCard title="Netted Without Item Rows" icon={<ArrowRightLeft size={18} />} columns={1}>
          <div className="space-y-3">
            {nettedWithoutItemSources.map((itemSource) => (
              <div
                key={itemSource.id}
                className="rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-sm text-gray-700"
              >
                <div className="font-medium text-gray-900">
                  {itemSource.sourceFamily} · {itemSource.sourceId}
                </div>
                <div className="mt-1">
                  {itemSource.fromWallet?.walletNo || itemSource.fromWalletId} to{' '}
                  {itemSource.toWallet?.walletNo || itemSource.toWalletId}
                </div>
                <div className="mt-1">
                  Source {itemSource.sourceAmount} / Netted {itemSource.nettedAmount} / Status{' '}
                  {itemSource.status}
                </div>
              </div>
            ))}
          </div>
        </DetailCard>
      ) : null}

      {detail.internalTransactions && detail.internalTransactions.length ? (
        <DetailCard title="Derived Internal Transactions" icon={<Layers size={18} />} columns={1}>
          <div className="space-y-3">
            {detail.internalTransactions.map((internalTx) => (
              <div
                key={internalTx.id}
                className="rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-sm text-gray-700"
              >
                <div className="font-medium text-gray-900">
                  {internalTx.internalTxNo || internalTx.id}
                </div>
                <div className="mt-1">Status: {internalTx.status || '-'}</div>
                <div className="mt-1">Batch Item: {internalTx.batchItemId || '-'}</div>
              </div>
            ))}
          </div>
        </DetailCard>
      ) : null}

      <DetailCard title="Batch JSON" icon={<FileJson size={18} />} columns={1}>
        <JsonBlock title="summaryJson" value={detail.summaryJson || {}} />
        <JsonBlock title="metadataJson" value={detail.metadataJson || {}} />
      </DetailCard>

      {detail.status === 'CREATED' && canSubmit ? (
        <ActionCard
          title="Submit For Approval"
          description="Create the approval case and move this batch into the control-gates workflow."
        >
          <button
            onClick={() => void submitBatch()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send size={16} />
            {submitting ? 'Submitting...' : 'Submit for Approval'}
          </button>
        </ActionCard>
      ) : null}
    </div>
  );
};

export default PoolSettlementBatchDetailPage;
