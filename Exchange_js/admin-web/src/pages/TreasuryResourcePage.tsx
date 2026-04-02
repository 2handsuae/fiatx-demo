import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  ActionCard,
  JsonBlock,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import {
  formatDateTime,
} from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  getTreasuryResourceConfig,
  type TreasuryResourceType,
} from './wave8OpsConfig';

type AssetOption = {
  id: string;
  code: string;
  type: string;
  network?: string | null;
};

type FeeOccurrenceItem = {
  id: string;
  feeNo: string;
  feeType: string;
  status: string;
  amount: string;
  poolRole?: string | null;
  reimbursementImpact?: string | null;
  createdAt: string;
  asset?: AssetOption | null;
  reimbursementObligation?: { id: string; obligationNo: string; status: string } | null;
};

type ReimbursementObligationItem = {
  id: string;
  obligationNo: string;
  status: string;
  amount: string;
  poolRole?: string | null;
  createdAt: string;
  asset?: AssetOption | null;
  feeOccurrence?: { id: string; feeNo: string; feeType: string; status: string } | null;
};

type TreasuryListResponse<T> = {
  items: T[];
  total: number;
};

type FeeFilters = {
  status: string;
  feeType: string;
};

type ObligationFilters = {
  status: string;
  poolRole: string;
};

const PAGE_SIZE = 20;

const FEE_TYPE_OPTIONS = [
  '',
  'NETWORK_GAS',
  'BANK_TRANSFER_FEE',
  'INTERNAL_TRANSFER_GAS',
  'INTERNAL_BANK_FEE',
  'CUSTODY_FEE',
  'BANK_MONTHLY_FEE',
  'RECONCILIATION_ADJUSTMENT_FEE',
] as const;

const FEE_STATUS_OPTIONS = ['', 'RECORDED', 'CANCELLED'] as const;
const OBLIGATION_STATUS_OPTIONS = ['', 'OPEN', 'REIMBURSED', 'CANCELLED'] as const;
const POOL_ROLE_OPTIONS = ['', 'DEPOSIT', 'MASTER', 'PAYOUT', 'CUST_BANK'] as const;

const DEFAULT_FEE_FILTERS: FeeFilters = {
  status: '',
  feeType: '',
};

const DEFAULT_OBLIGATION_FILTERS: ObligationFilters = {
  status: '',
  poolRole: '',
};

const emptyCreateState = {
  feeType: 'BANK_MONTHLY_FEE',
  assetId: '',
  amount: '',
  sourceEntityType: '',
  sourceEntityId: '',
  sourceEntityNo: '',
  sourceWalletId: '',
  sourceAccountRef: '',
  relatedEntityType: '',
  relatedEntityId: '',
  relatedEntityNo: '',
  poolRole: '',
  evidenceRef: '',
  traceId: '',
  metadataJson: '{}',
};

const parseMetadataJson = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return {};
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Metadata JSON must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
};

const TreasuryResourcePage = ({
  resourceType,
}: {
  resourceType: TreasuryResourceType;
}) => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const config = useMemo(() => getTreasuryResourceConfig(resourceType), [resourceType]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [total, setTotal] = useState(0);
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [createState, setCreateState] = useState(emptyCreateState);
  const [creating, setCreating] = useState(false);
  const [feeFilters, setFeeFilters] = useState(DEFAULT_FEE_FILTERS);
  const [obligationFilters, setObligationFilters] = useState(DEFAULT_OBLIGATION_FILTERS);
  const [feeItems, setFeeItems] = useState<FeeOccurrenceItem[]>([]);
  const [obligationItems, setObligationItems] = useState<ReimbursementObligationItem[]>([]);

  const canCreateFee = hasAnyPermission([PERMISSIONS.FEE_OCCURRENCES_WRITE]);

  const fetchAssetOptions = async () => {
    if (resourceType !== 'fee-occurrences') return;
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/assets?take=200`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load assets.'));
      }
      const result = (await response.json()) as TreasuryListResponse<AssetOption>;
      setAssetOptions(Array.isArray(result.items) ? result.items : []);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load assets.');
    }
  };

  const buildParams = (page: number) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (resourceType === 'fee-occurrences') {
      if (feeFilters.status) params.set('status', feeFilters.status);
      if (feeFilters.feeType) params.set('feeType', feeFilters.feeType);
    } else {
      if (obligationFilters.status) params.set('status', obligationFilters.status);
      if (obligationFilters.poolRole) params.set('poolRole', obligationFilters.poolRole);
    }
    return params;
  };

  const fetchItems = async (page: number) => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}${config.endpoint}?${buildParams(page).toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to load ${config.title}.`));
      }
      const result = (await response.json()) as TreasuryListResponse<
        FeeOccurrenceItem | ReimbursementObligationItem
      >;
      if (resourceType === 'fee-occurrences') {
        setFeeItems(Array.isArray(result.items) ? (result.items as FeeOccurrenceItem[]) : []);
      } else {
        setObligationItems(
          Array.isArray(result.items)
            ? (result.items as ReimbursementObligationItem[])
            : [],
        );
      }
      setTotal(typeof result.total === 'number' ? result.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to load ${config.title}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1);
    void fetchAssetOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType]);

  const submitCreate = async () => {
    setCreating(true);
    setError('');
    setMessage('');
    try {
      if (!createState.assetId.trim()) {
        throw new Error('Asset is required.');
      }
      if (!createState.amount.trim()) {
        throw new Error('Amount is required.');
      }
      const payload: Record<string, unknown> = {
        feeType: createState.feeType,
        assetId: createState.assetId,
        amount: createState.amount,
        metadata: parseMetadataJson(createState.metadataJson),
      };
      if (createState.sourceEntityType.trim()) {
        payload.sourceEntityType = createState.sourceEntityType.trim();
      }
      if (createState.sourceEntityId.trim()) {
        payload.sourceEntityId = createState.sourceEntityId.trim();
      }
      if (createState.sourceEntityNo.trim()) {
        payload.sourceEntityNo = createState.sourceEntityNo.trim();
      }
      if (createState.sourceWalletId.trim()) {
        payload.sourceWalletId = createState.sourceWalletId.trim();
      }
      if (createState.sourceAccountRef.trim()) {
        payload.sourceAccountRef = createState.sourceAccountRef.trim();
      }
      if (createState.relatedEntityType.trim()) {
        payload.relatedEntityType = createState.relatedEntityType.trim();
      }
      if (createState.relatedEntityId.trim()) {
        payload.relatedEntityId = createState.relatedEntityId.trim();
      }
      if (createState.relatedEntityNo.trim()) {
        payload.relatedEntityNo = createState.relatedEntityNo.trim();
      }
      if (createState.poolRole.trim()) payload.poolRole = createState.poolRole.trim();
      if (createState.evidenceRef.trim()) payload.evidenceRef = createState.evidenceRef.trim();
      if (createState.traceId.trim()) payload.traceId = createState.traceId.trim();

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/fee-occurrences`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to create fee occurrence.'),
        );
      }
      const created = (await response.json()) as { id: string };
      setCreateState(emptyCreateState);
      setMessage('Fee occurrence created successfully.');
      await fetchItems(1);
      navigate(config.detailPath(created.id));
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create fee occurrence.');
    } finally {
      setCreating(false);
    }
  };

  const renderFeeTable = () => (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-admin-border bg-admin-content-bg">
        <tr>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Fee No</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Fee Type</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Amount</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Pool</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Reimbursement</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-admin-border">
        {feeItems.length === 0 ? (
          <tr>
            <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
              No fee occurrences found.
            </td>
          </tr>
        ) : (
          feeItems.map((item) => (
            <tr
              key={item.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => navigate(config.detailPath(item.id))}
            >
              <td className="px-4 py-3 font-mono text-xs text-brand-primary">{item.feeNo}</td>
              <td className="px-4 py-3 text-gray-700">{item.feeType}</td>
              <td className="px-4 py-3 text-gray-700">
                {item.asset ? `${item.asset.code}${item.asset.network ? ` · ${item.asset.network}` : ''}` : '-'}
              </td>
              <td className="px-4 py-3 text-gray-700">{item.amount}</td>
              <td className="px-4 py-3 text-gray-700">{item.poolRole || '-'}</td>
              <td className="px-4 py-3 text-gray-700">
                {item.reimbursementObligation ? item.reimbursementObligation.obligationNo : '-'}
              </td>
              <td className="px-4 py-3"><StatusBadge value={item.status} /></td>
              <td className="px-4 py-3 text-gray-700">{formatDateTime(item.createdAt)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  const renderObligationTable = () => (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-admin-border bg-admin-content-bg">
        <tr>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Obligation No</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Amount</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Pool Role</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Fee Occurrence</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
          <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-admin-border">
        {obligationItems.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
              No reimbursement obligations found.
            </td>
          </tr>
        ) : (
          obligationItems.map((item) => (
            <tr
              key={item.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => navigate(config.detailPath(item.id))}
            >
              <td className="px-4 py-3 font-mono text-xs text-brand-primary">{item.obligationNo}</td>
              <td className="px-4 py-3 text-gray-700">
                {item.asset ? `${item.asset.code}${item.asset.network ? ` · ${item.asset.network}` : ''}` : '-'}
              </td>
              <td className="px-4 py-3 text-gray-700">{item.amount}</td>
              <td className="px-4 py-3 text-gray-700">{item.poolRole || '-'}</td>
              <td className="px-4 py-3 text-gray-700">{item.feeOccurrence?.feeNo || '-'}</td>
              <td className="px-4 py-3"><StatusBadge value={item.status} /></td>
              <td className="px-4 py-3 text-gray-700">{formatDateTime(item.createdAt)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  const renderFilters = () => {
    if (resourceType === 'fee-occurrences') {
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select
            value={feeFilters.status}
            onChange={(event) =>
              setFeeFilters((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {FEE_STATUS_OPTIONS.map((status) => (
              <option key={status || 'ALL'} value={status}>
                {status || 'All Statuses'}
              </option>
            ))}
          </select>
          <select
            value={feeFilters.feeType}
            onChange={(event) =>
              setFeeFilters((prev) => ({ ...prev, feeType: event.target.value }))
            }
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {FEE_TYPE_OPTIONS.map((feeType) => (
              <option key={feeType || 'ALL'} value={feeType}>
                {feeType || 'All Fee Types'}
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <select
          value={obligationFilters.status}
          onChange={(event) =>
            setObligationFilters((prev) => ({
              ...prev,
              status: event.target.value,
            }))
          }
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          {OBLIGATION_STATUS_OPTIONS.map((status) => (
            <option key={status || 'ALL'} value={status}>
              {status || 'All Statuses'}
            </option>
          ))}
        </select>
        <select
          value={obligationFilters.poolRole}
          onChange={(event) =>
            setObligationFilters((prev) => ({
              ...prev,
              poolRole: event.target.value,
            }))
          }
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          {POOL_ROLE_OPTIONS.map((role) => (
            <option key={role || 'ALL'} value={role}>
              {role || 'All Pool Roles'}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{config.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{config.description}</p>
        </div>
        <button
          onClick={() => void fetchItems(currentPage)}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
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

      {resourceType === 'fee-occurrences' && canCreateFee ? (
        <ActionCard
          title="Record Manual Fee Occurrence"
          description="Use WF-19 v1 manual recording for platform-borne costs that are not captured automatically."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              value={createState.feeType}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, feeType: event.target.value }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {FEE_TYPE_OPTIONS.filter(Boolean).map((feeType) => (
                <option key={feeType} value={feeType}>
                  {feeType}
                </option>
              ))}
            </select>
            <select
              value={createState.assetId}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, assetId: event.target.value }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Select Asset</option>
              {assetOptions.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.code}
                  {asset.network ? ` · ${asset.network}` : ''}
                </option>
              ))}
            </select>
            <input
              value={createState.amount}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, amount: event.target.value }))
              }
              placeholder="Amount"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={createState.sourceWalletId}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  sourceWalletId: event.target.value,
                }))
              }
              placeholder="Source Wallet Id"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={createState.sourceAccountRef}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  sourceAccountRef: event.target.value,
                }))
              }
              placeholder="Source Account Ref"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={createState.relatedEntityType}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  relatedEntityType: event.target.value,
                }))
              }
              placeholder="Related Entity Type"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={createState.relatedEntityId}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  relatedEntityId: event.target.value,
                }))
              }
              placeholder="Related Entity Id"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={createState.relatedEntityNo}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  relatedEntityNo: event.target.value,
                }))
              }
              placeholder="Related Entity No"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <select
              value={createState.poolRole}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, poolRole: event.target.value }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {POOL_ROLE_OPTIONS.map((role) => (
                <option key={role || 'EMPTY'} value={role}>
                  {role || 'No Pool Role'}
                </option>
              ))}
            </select>
            <input
              value={createState.evidenceRef}
              onChange={(event) =>
                setCreateState((prev) => ({
                  ...prev,
                  evidenceRef: event.target.value,
                }))
              }
              placeholder="Evidence Ref"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              value={createState.traceId}
              onChange={(event) =>
                setCreateState((prev) => ({ ...prev, traceId: event.target.value }))
              }
              placeholder="Trace Id"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <textarea
            value={createState.metadataJson}
            onChange={(event) =>
              setCreateState((prev) => ({
                ...prev,
                metadataJson: event.target.value,
              }))
            }
            rows={5}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
          />
          <JsonBlock title="Metadata Preview" value={createState.metadataJson} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submitCreate()}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
            >
              <Plus size={16} />
              {creating ? 'Creating...' : 'Create Fee Occurrence'}
            </button>
          </div>
        </ActionCard>
      ) : null}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        {renderFilters()}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void fetchItems(1)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
          >
            <Search size={16} />
            Search
          </button>
          <button
            onClick={() => {
              if (resourceType === 'fee-occurrences') {
                setFeeFilters(DEFAULT_FEE_FILTERS);
              } else {
                setObligationFilters(DEFAULT_OBLIGATION_FILTERS);
              }
              void fetchItems(1);
            }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          {resourceType === 'fee-occurrences'
            ? renderFeeTable()
            : renderObligationTable()}
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchItems(page)}
        />
      </div>
    </div>
  );
};

export default TreasuryResourcePage;
