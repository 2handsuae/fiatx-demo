import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { StatusBadge } from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type RegulatoryGateItem = {
  id: string;
  gateNo: string;
  gateType: string;
  authority: string;
  subjectType: string;
  subjectId: string;
  subjectNo: string;
  scopeSummary?: string | null;
  filingStatus: string;
  receiptStatus: string;
  effectivenessStatus: string;
  gateResult: string;
  updatedAt: string;
  shareholdingRegistryVersion?: { id: string; registryNo: string; status: string } | null;
  appointmentRecord?: { id: string; appointmentNo: string; status: string; regulatedFlag: boolean } | null;
  wallet?: { id: string; walletNo: string; walletRole?: string | null } | null;
};

type RegulatoryGateListResponse = {
  items: RegulatoryGateItem[];
  total: number;
};

type FilterState = {
  keyword: string;
  gateType: string;
  subjectType: string;
  subjectNo: string;
  gateResult: string;
  filingStatus: string;
  receiptStatus: string;
  effectivenessStatus: string;
};

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  gateType: '',
  subjectType: '',
  subjectNo: '',
  gateResult: '',
  filingStatus: '',
  receiptStatus: '',
  effectivenessStatus: '',
};

const RegulatoryGateListPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<RegulatoryGateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canCreate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_CREATE]);

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (nextFilters.keyword.trim()) params.set('keyword', nextFilters.keyword.trim());
    if (nextFilters.gateType.trim()) params.set('gateType', nextFilters.gateType.trim());
    if (nextFilters.subjectType.trim()) params.set('subjectType', nextFilters.subjectType.trim());
    if (nextFilters.subjectNo.trim()) params.set('subjectNo', nextFilters.subjectNo.trim());
    if (nextFilters.gateResult.trim()) params.set('gateResult', nextFilters.gateResult.trim());
    if (nextFilters.filingStatus.trim()) params.set('filingStatus', nextFilters.filingStatus.trim());
    if (nextFilters.receiptStatus.trim()) params.set('receiptStatus', nextFilters.receiptStatus.trim());
    if (nextFilters.effectivenessStatus.trim()) params.set('effectivenessStatus', nextFilters.effectivenessStatus.trim());
    return params;
  };

  const fetchItems = async (page: number, nextFilters: FilterState = filters) => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/regulatory-gates?${buildParams(page, nextFilters).toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load regulatory gates.'));
      }

      const result = (await response.json()) as RegulatoryGateListResponse;
      setItems(Array.isArray(result.items) ? result.items : []);
      setTotal(typeof result.total === 'number' ? result.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load regulatory gates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Governance Center - Regulatory Gates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review regulatory filing, receipt, and effectiveness gates for control changes and regulated appointments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canCreate ? (
            <button
              onClick={() => navigate('/admin/registries/regulatory-gates/create')}
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
            placeholder="Keyword"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={filters.gateType}
            onChange={(e) => setFilters((prev) => ({ ...prev, gateType: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Gate Types</option>
            <option value="CONTROL_CHANGE">CONTROL_CHANGE</option>
            <option value="REGULATED_APPOINTMENT_CHANGE">REGULATED_APPOINTMENT_CHANGE</option>
            <option value="CLIENT_BANK_ACCOUNT_ENABLEMENT">CLIENT_BANK_ACCOUNT_ENABLEMENT</option>
          </select>
          <select
            value={filters.subjectType}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectType: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Subject Types</option>
            <option value="SHAREHOLDING_REGISTRY_VERSION">SHAREHOLDING_REGISTRY_VERSION</option>
            <option value="APPOINTMENT_RECORD">APPOINTMENT_RECORD</option>
            <option value="WALLET">WALLET</option>
          </select>
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectNo: e.target.value }))}
            placeholder="Subject No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={filters.gateResult}
            onChange={(e) => setFilters((prev) => ({ ...prev, gateResult: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Gate Results</option>
            <option value="BLOCKED">BLOCKED</option>
            <option value="READY">READY</option>
            <option value="EFFECTIVE">EFFECTIVE</option>
            <option value="REVOKED">REVOKED</option>
          </select>
          <select
            value={filters.filingStatus}
            onChange={(e) => setFilters((prev) => ({ ...prev, filingStatus: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Filing Statuses</option>
            <option value="REQUIRED">REQUIRED</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="ACCEPTED">ACCEPTED</option>
            <option value="RETURNED">RETURNED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <select
            value={filters.receiptStatus}
            onChange={(e) => setFilters((prev) => ({ ...prev, receiptStatus: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Receipt Statuses</option>
            <option value="PENDING">PENDING</option>
            <option value="BOUND">BOUND</option>
            <option value="REPLACED">REPLACED</option>
          </select>
          <select
            value={filters.effectivenessStatus}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, effectivenessStatus: e.target.value }))
            }
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Effectiveness Statuses</option>
            <option value="BLOCKED">BLOCKED</option>
            <option value="READY">READY</option>
            <option value="EFFECTIVE">EFFECTIVE</option>
            <option value="REVOKED">REVOKED</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Gate No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Gate Type</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Gate Result</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Filing</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Receipt</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Effective</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Updated At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No regulatory gates found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/registries/regulatory-gates/${item.id}`)}
                        className="font-mono text-xs text-brand-primary hover:underline"
                      >
                        {item.gateNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div>{item.gateType}</div>
                      <div className="mt-1 text-xs text-gray-500">{item.authority}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="font-mono text-xs">{item.subjectNo}</div>
                      <div className="mt-1 text-xs text-gray-500">{item.subjectType}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={item.gateResult} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={item.filingStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={item.receiptStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={item.effectivenessStatus} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatDateTime(item.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/registries/regulatory-gates/${item.id}`)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-primary hover:underline"
                      >
                        <Eye size={14} />
                        View
                      </button>
                    </td>
                  </tr>
                ))
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

export default RegulatoryGateListPage;
