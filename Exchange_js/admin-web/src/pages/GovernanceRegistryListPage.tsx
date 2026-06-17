import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { StatusBadge } from '../components/governance/GovernanceUi';
import { formatDate, formatDateTime, formatValue } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { getRegistryCreatePath } from './governanceRegistryConfig';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { getRegistryConfig, type RegistryType } from './governanceRegistryConfig';

type RegistryListItem = Record<string, unknown> & {
  id: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type RegistryListResponse = {
  items: RegistryListItem[];
  total: number;
};

type FilterState = {
  keyword: string;
  status: string;
};

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  status: '',
};

const renderRegistrySpecificCells = (registryType: RegistryType, item: RegistryListItem) => {
  switch (registryType) {
    case 'shareholding-versions':
      return (
        <>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.versionLabel)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">
            {Array.isArray(item.participants) ? item.participants.length : 0}
          </td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDate(item.effectiveFrom as string | null)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDate(item.effectiveTo as string | null)}</td>
        </>
      );
    case 'appointments':
      return (
        <>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.roleType)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.personName)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.regulatedFlag)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">
            {formatDateTime(item.proposedEffectiveAt as string | null)}
          </td>
        </>
      );
    case 'trainings':
      return (
        <>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.assignee)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.trainingType)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDateTime(item.dueAt as string | null)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">
            {formatDateTime(item.completedAt as string | null)}
          </td>
        </>
      );
    case 'conflicts':
      return (
        <>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.disclosureType)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.disclosedByName)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDateTime(item.disclosedAt as string | null)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDateTime(item.reviewDueAt as string | null)}</td>
        </>
      );
    case 'wind-down-materials':
      return (
        <>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.materialType)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatValue(item.versionLabel)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDateTime(item.effectiveAt as string | null)}</td>
          <td className="px-4 py-3 text-sm text-gray-700">{formatDateTime(item.reviewDueAt as string | null)}</td>
        </>
      );
    default:
      return null;
  }
};

const getRegistryHeaders = (registryType: RegistryType) => {
  switch (registryType) {
    case 'shareholding-versions':
      return ['Version Label', 'Participants', 'Effective From', 'Effective To'];
    case 'appointments':
      return ['Role', 'Person', 'Regulated', 'Proposed Effective'];
    case 'trainings':
      return ['Assignee', 'Training Type', 'Due At', 'Completed At'];
    case 'conflicts':
      return ['Disclosure Type', 'Disclosed By', 'Disclosed At', 'Review Due'];
    case 'wind-down-materials':
      return ['Material Type', 'Version Label', 'Effective At', 'Review Due'];
    default:
      return [];
  }
};

const GovernanceRegistryListPage = ({ registryType }: { registryType: RegistryType }) => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const config = useMemo(() => getRegistryConfig(registryType), [registryType]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<RegistryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = useMemo(() => getRegistryHeaders(registryType), [registryType]);
  const canCreate = hasAnyPermission([config.createPermission]);

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (nextFilters.keyword.trim()) params.set('keyword', nextFilters.keyword.trim());
    if (nextFilters.status.trim()) params.set('status', nextFilters.status.trim());
    return params;
  };

  const fetchItems = async (page: number, nextFilters: FilterState = filters) => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/registries/${config.endpoint}?${buildParams(page, nextFilters).toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to load ${config.listTitle}.`));
      }

      const result = (await response.json()) as RegistryListResponse;
      setItems(Array.isArray(result.items) ? result.items : []);
      setTotal(typeof result.total === 'number' ? result.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to load ${config.listTitle}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryType]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{config.listTitle}</h1>
          <p className="mt-1 text-sm text-gray-500">{config.description}</p>
        </div>
        <div className="flex items-center gap-3">
          {canCreate ? (
            <button
              onClick={() => navigate(getRegistryCreatePath(registryType))}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
            >
              <Plus size={16} />
              Create
            </button>
          ) : null}
          <button
            onClick={() => void fetchItems(currentPage)}
            className="p-2 text-gray-500 hover:text-brand-primary"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
            placeholder="Keyword"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            {config.statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
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
                setFilters(DEFAULT_FILTERS);
                void fetchItems(1, DEFAULT_FILTERS);
              }}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">{config.numberLabel}</th>
                {headers.map((header) => (
                  <th key={header} className="px-4 py-3 text-xs uppercase text-gray-500">
                    {header}
                  </th>
                ))}
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Updated At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={headers.length + 4} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + 4} className="px-4 py-8 text-center text-gray-500">
                    {config.noResultsText}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const numberValue = item[config.numberField];
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            navigate(`/admin/registries/${config.endpoint}/${item.id}`)
                          }
                          className="font-mono text-xs text-brand-primary hover:underline"
                        >
                          {formatValue(numberValue)}
                        </button>
                      </td>
                      {renderRegistrySpecificCells(registryType, item)}
                      <td className="px-4 py-3">
                        <StatusBadge value={String(item.status || '')} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {formatDateTime(item.updatedAt as string | null)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            navigate(`/admin/registries/${config.endpoint}/${item.id}`)
                          }
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-primary hover:underline"
                        >
                          <Eye size={14} />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

export default GovernanceRegistryListPage;
