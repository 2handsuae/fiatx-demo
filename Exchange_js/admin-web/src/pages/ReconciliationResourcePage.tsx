import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, Upload } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  ActionCard,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  getReconciliationResourceConfig,
  type ReconciliationResourceType,
} from './wave8OpsConfig';

type AssetOption = {
  id: string;
  code: string;
  network?: string | null;
};

type WalletOption = {
  id: string;
  walletNo: string;
  walletRole?: string | null;
  bankName?: string | null;
  asset?: { code?: string | null } | null;
};

type WarningItem = {
  id: string;
  warningNo: string;
  businessDate: string;
  assetCode?: string | null;
  warningType: string;
  poolRole: string;
  status: string;
  observedValue?: string | null;
  thresholdValue?: string | null;
  createdAt: string;
  wallet?: { walletNo?: string | null } | null;
};

type RunItem = {
  id: string;
  runNo: string;
  businessDate: string;
  status: string;
  breakCount: number;
  warningCount: number;
  finishedAt?: string | null;
  createdAt: string;
};

type FiatImportItem = {
  id: string;
  importNo: string;
  businessDate: string;
  status: string;
  fileName?: string | null;
  closingBalance?: string | null;
  createdAt: string;
  asset?: { code?: string | null; network?: string | null } | null;
  wallet?: { walletNo?: string | null } | null;
};

type ListResponse<T> = {
  items: T[];
  total: number;
};

type WarningFilters = {
  businessDate: string;
  status: string;
  warningType: string;
};

type RunFilters = {
  businessDate: string;
};

type FiatFilters = {
  businessDate: string;
  status: string;
};

const PAGE_SIZE = 20;

const WARNING_STATUS_OPTIONS = ['', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACCEPTED'] as const;
const WARNING_TYPE_OPTIONS = [
  '',
  'DEPOSIT_COLLECTION_OVER_AMOUNT',
  'DEPOSIT_COLLECTION_OVER_AGE',
  'PAYOUT_TARGET_BELOW_MIN',
  'PAYOUT_TARGET_ABOVE_MAX',
] as const;
const FIAT_IMPORT_STATUS_OPTIONS = ['', 'PENDING', 'READY', 'FAILED'] as const;

const ReconciliationResourcePage = ({
  resourceType,
}: {
  resourceType: ReconciliationResourceType;
}) => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const config = useMemo(
    () => getReconciliationResourceConfig(resourceType),
    [resourceType],
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [total, setTotal] = useState(0);
  const [warningFilters, setWarningFilters] = useState<WarningFilters>({
    businessDate: '',
    status: '',
    warningType: '',
  });
  const [runFilters, setRunFilters] = useState<RunFilters>({ businessDate: '' });
  const [fiatFilters, setFiatFilters] = useState<FiatFilters>({
    businessDate: '',
    status: '',
  });
  const [warningItems, setWarningItems] = useState<WarningItem[]>([]);
  const [runItems, setRunItems] = useState<RunItem[]>([]);
  const [fiatItems, setFiatItems] = useState<FiatImportItem[]>([]);
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    businessDate: '',
    assetId: '',
    walletId: '',
    file: null as File | null,
  });

  const canUploadFiatStatement = hasAnyPermission([
    PERMISSIONS.SAFEGUARDING_FIAT_IMPORTS_WRITE,
  ]);

  const buildParams = (page: number) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (resourceType === 'warnings') {
      if (warningFilters.businessDate.trim()) {
        params.set('businessDate', warningFilters.businessDate.trim());
      }
      if (warningFilters.status.trim()) params.set('status', warningFilters.status.trim());
      if (warningFilters.warningType.trim()) {
        params.set('warningType', warningFilters.warningType.trim());
      }
    } else if (resourceType === 'runs') {
      if (runFilters.businessDate.trim()) {
        params.set('businessDate', runFilters.businessDate.trim());
      }
    } else {
      if (fiatFilters.businessDate.trim()) {
        params.set('businessDate', fiatFilters.businessDate.trim());
      }
      if (fiatFilters.status.trim()) params.set('status', fiatFilters.status.trim());
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
      const result = (await response.json()) as ListResponse<
        WarningItem | RunItem | FiatImportItem
      >;
      if (resourceType === 'warnings') {
        setWarningItems(Array.isArray(result.items) ? (result.items as WarningItem[]) : []);
      } else if (resourceType === 'runs') {
        setRunItems(Array.isArray(result.items) ? (result.items as RunItem[]) : []);
      } else {
        setFiatItems(Array.isArray(result.items) ? (result.items as FiatImportItem[]) : []);
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

  const fetchUploadOptions = async () => {
    if (resourceType !== 'fiat-statements') return;
    try {
      const [assetResponse, walletResponse] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=200&type=FIAT`),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/wallets?take=200&walletRole=CUST_BANK`,
        ),
      ]);
      if (!assetResponse.ok) {
        throw new Error(await getApiErrorMessage(assetResponse, 'Failed to load fiat assets.'));
      }
      if (!walletResponse.ok) {
        throw new Error(await getApiErrorMessage(walletResponse, 'Failed to load CUST_BANK wallets.'));
      }
      const assets = (await assetResponse.json()) as ListResponse<AssetOption>;
      const wallets = (await walletResponse.json()) as ListResponse<WalletOption>;
      setAssetOptions(Array.isArray(assets.items) ? assets.items : []);
      setWalletOptions(Array.isArray(wallets.items) ? wallets.items : []);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load statement upload options.');
    }
  };

  useEffect(() => {
    void fetchItems(1);
    void fetchUploadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType]);

  const submitImport = async () => {
    setUploading(true);
    setError('');
    setMessage('');
    try {
      if (!uploadForm.businessDate.trim()) {
        throw new Error('Business date is required.');
      }
      if (!uploadForm.assetId.trim()) {
        throw new Error('Asset is required.');
      }
      if (!uploadForm.walletId.trim()) {
        throw new Error('Wallet is required.');
      }
      if (!uploadForm.file) {
        throw new Error('CSV file is required.');
      }
      const body = new FormData();
      body.append('businessDate', uploadForm.businessDate.trim());
      body.append('assetId', uploadForm.assetId.trim());
      body.append('walletId', uploadForm.walletId.trim());
      body.append('file', uploadForm.file);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-fiat-statements/imports`,
        {
          method: 'POST',
          body,
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to import fiat statement.'));
      }
      const created = (await response.json()) as { id: string };
      setMessage('Fiat statement imported successfully.');
      setUploadForm({
        businessDate: '',
        assetId: '',
        walletId: '',
        file: null,
      });
      await fetchItems(1);
      navigate(config.detailPath(created.id));
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to import fiat statement.');
    } finally {
      setUploading(false);
    }
  };

  const renderFilters = () => {
    if (resourceType === 'warnings') {
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            value={warningFilters.businessDate}
            onChange={(event) =>
              setWarningFilters((prev) => ({
                ...prev,
                businessDate: event.target.value,
              }))
            }
            placeholder="YYYY-MM-DD"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={warningFilters.status}
            onChange={(event) =>
              setWarningFilters((prev) => ({ ...prev, status: event.target.value }))
            }
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {WARNING_STATUS_OPTIONS.map((status) => (
              <option key={status || 'ALL'} value={status}>
                {status || 'All Statuses'}
              </option>
            ))}
          </select>
          <select
            value={warningFilters.warningType}
            onChange={(event) =>
              setWarningFilters((prev) => ({
                ...prev,
                warningType: event.target.value,
              }))
            }
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {WARNING_TYPE_OPTIONS.map((warningType) => (
              <option key={warningType || 'ALL'} value={warningType}>
                {warningType || 'All Warning Types'}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (resourceType === 'runs') {
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-1">
          <input
            value={runFilters.businessDate}
            onChange={(event) =>
              setRunFilters({ businessDate: event.target.value })
            }
            placeholder="YYYY-MM-DD"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <input
          value={fiatFilters.businessDate}
          onChange={(event) =>
            setFiatFilters((prev) => ({
              ...prev,
              businessDate: event.target.value,
            }))
          }
          placeholder="YYYY-MM-DD"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <select
          value={fiatFilters.status}
          onChange={(event) =>
            setFiatFilters((prev) => ({ ...prev, status: event.target.value }))
          }
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          {FIAT_IMPORT_STATUS_OPTIONS.map((status) => (
            <option key={status || 'ALL'} value={status}>
              {status || 'All Statuses'}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const renderTable = () => {
    if (resourceType === 'warnings') {
      return (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-admin-border bg-admin-content-bg">
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Warning No</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Business Date</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Warning Type</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Pool</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {warningItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  No safeguarding warnings found.
                </td>
              </tr>
            ) : (
              warningItems.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => navigate(config.detailPath(item.id))}
                >
                  <td className="px-4 py-3 font-mono text-xs text-brand-primary">{item.warningNo}</td>
                  <td className="px-4 py-3 text-gray-700">{item.businessDate}</td>
                  <td className="px-4 py-3 text-gray-700">{item.assetCode || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{item.warningType}</td>
                  <td className="px-4 py-3 text-gray-700">{item.poolRole}</td>
                  <td className="px-4 py-3"><StatusBadge value={item.status} /></td>
                  <td className="px-4 py-3 text-gray-700">{formatDateTime(item.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }

    if (resourceType === 'runs') {
      return (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-admin-border bg-admin-content-bg">
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Run No</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Business Date</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Breaks</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Warnings</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Finished At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {runItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  No safeguarding runs found.
                </td>
              </tr>
            ) : (
              runItems.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => navigate(config.detailPath(item.id))}
                >
                  <td className="px-4 py-3 font-mono text-xs text-brand-primary">{item.runNo}</td>
                  <td className="px-4 py-3 text-gray-700">{item.businessDate}</td>
                  <td className="px-4 py-3"><StatusBadge value={item.status} /></td>
                  <td className="px-4 py-3 text-gray-700">{item.breakCount}</td>
                  <td className="px-4 py-3 text-gray-700">{item.warningCount}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDateTime(item.finishedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    }

    return (
      <table className="w-full text-left text-sm">
        <thead className="border-b border-admin-border bg-admin-content-bg">
          <tr>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Import No</th>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Business Date</th>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Wallet</th>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Closing Balance</th>
            <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-admin-border">
          {fiatItems.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                No fiat statement imports found.
              </td>
            </tr>
          ) : (
            fiatItems.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => navigate(config.detailPath(item.id))}
              >
                <td className="px-4 py-3 font-mono text-xs text-brand-primary">{item.importNo}</td>
                <td className="px-4 py-3 text-gray-700">{item.businessDate}</td>
                <td className="px-4 py-3 text-gray-700">
                  {item.asset?.code}
                  {item.asset?.network ? ` · ${item.asset.network}` : ''}
                </td>
                <td className="px-4 py-3 text-gray-700">{item.wallet?.walletNo || '-'}</td>
                <td className="px-4 py-3"><StatusBadge value={item.status} /></td>
                <td className="px-4 py-3 text-gray-700">{item.closingBalance || '-'}</td>
                <td className="px-4 py-3 text-gray-700">{formatDateTime(item.createdAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
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

      {resourceType === 'fiat-statements' && canUploadFiatStatement ? (
        <ActionCard
          title="Upload Fiat Statement"
          description="Use the current safeguarding import endpoint to register Layer 3 fiat evidence."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={uploadForm.businessDate}
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  businessDate: event.target.value,
                }))
              }
              placeholder="YYYY-MM-DD"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <select
              value={uploadForm.assetId}
              onChange={(event) =>
                setUploadForm((prev) => ({ ...prev, assetId: event.target.value }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Select Fiat Asset</option>
              {assetOptions.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.code}
                  {asset.network ? ` · ${asset.network}` : ''}
                </option>
              ))}
            </select>
            <select
              value={uploadForm.walletId}
              onChange={(event) =>
                setUploadForm((prev) => ({ ...prev, walletId: event.target.value }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Select CUST_BANK Wallet</option>
              {walletOptions.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.walletNo}
                  {wallet.asset?.code ? ` · ${wallet.asset.code}` : ''}
                  {wallet.bankName ? ` · ${wallet.bankName}` : ''}
                </option>
              ))}
            </select>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                setUploadForm((prev) => ({
                  ...prev,
                  file: event.target.files?.[0] || null,
                }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submitImport()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
            >
              {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? 'Uploading...' : 'Upload Statement'}
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
              if (resourceType === 'warnings') {
                setWarningFilters({ businessDate: '', status: '', warningType: '' });
              } else if (resourceType === 'runs') {
                setRunFilters({ businessDate: '' });
              } else {
                setFiatFilters({ businessDate: '', status: '' });
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
        <div className="overflow-x-auto">{renderTable()}</div>
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

export default ReconciliationResourcePage;
