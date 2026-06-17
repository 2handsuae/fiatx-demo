import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface CustomerItem {
  id: string;
  customerNo: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  customerType: string;
  onboardingStatus?: string | null;
  adminStatus?: string | null;
  complianceStatus?: string | null;
  riskRating?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

interface CustomerListResponse {
  total: number;
  data?: CustomerItem[]; // backend legacy shape
  items?: CustomerItem[]; // canonical shape (future-proof)
}

interface FilterState {
  keyword: string;
  onboardingStatus: string;
  customerType: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const displayName = (c: CustomerItem): string => {
  if (c.customerType === 'CORPORATE') {
    return c.companyName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || '—';
  }
  return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.companyName || '—';
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  onboardingStatus: '',
  customerType: '',
};

/* ─────────────────────────────────────────────────────────────── */

const CustomerManagement = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.keyword.trim()) params.set('search', next.keyword.trim());
    if (next.onboardingStatus.trim()) params.set('status', next.onboardingStatus.trim());
    if (next.customerType.trim()) params.set('customerType', next.customerType.trim());
    return params;
  };

  const fetchCustomers = async (page: number, next: FilterState = filters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/customers?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load customers.'));

      const data = (await res.json()) as CustomerListResponse;
      const rows = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.data)
          ? data.data
          : [];
      setItems(rows);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this resource.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load customers.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCustomers(1, DEFAULT_FILTERS);
  }, []);

  /* ── Filter helpers ── */

  const hasFilter =
    !!filters.keyword || !!filters.onboardingStatus || !!filters.customerType;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchCustomers(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchCustomers(1, DEFAULT_FILTERS);
  };

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Customer Management"
        meta={`${total} customer${total === 1 ? '' : 's'} · Customer Center`}
      >
        <button
          onClick={() => void fetchCustomers(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.keyword}
          onChange={(e) => updateFilter('keyword', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Name / email / phone"
          className={`${fi} w-44`}
        />
        <select
          value={filters.onboardingStatus}
          onChange={(e) => updateFilter('onboardingStatus', e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All onboarding</option>
          <option value="NONE">NONE</option>
          <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option>
          <option value="FINAL_APPROVAL">FINAL_APPROVAL</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="WITHDRAWN">WITHDRAWN</option>
        </select>
        <select
          value={filters.customerType}
          onChange={(e) => updateFilter('customerType', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All types</option>
          <option value="INDIVIDUAL">INDIVIDUAL</option>
          <option value="CORPORATE">CORPORATE</option>
        </select>
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
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
                  ['Customer No',  '150px'],
                  ['Name',         '200px'],
                  ['Email',        '240px'],
                  ['Type',         '110px'],
                  ['Onboarding',   '160px'],
                  ['Admin',        '120px'],
                  ['Compliance',   '130px'],
                  ['Risk Rating',  '110px'],
                  ['Created',      'auto'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No customers found.
                </td>
              </tr>
            )}
            {!loading && items.map((customer) => (
              <tr
                key={customer.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/customers/${customer.id}`)}
              >
                {/* Customer No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {customer.customerNo}
                  </span>
                </td>

                {/* Name */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2">
                  {displayName(customer)}
                </td>

                {/* Email */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {customer.email || <span className="text-adm-t3">—</span>}
                </td>

                {/* Type */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                  {customer.customerType || <span className="text-adm-t3">—</span>}
                </td>

                {/* Onboarding */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={customer.onboardingStatus || 'NONE'} />
                </td>

                {/* Admin */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={customer.adminStatus || 'INACTIVE'} />
                </td>

                {/* Compliance */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={customer.complianceStatus || 'CLEAR'} />
                </td>

                {/* Risk Rating */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                  {customer.riskRating || <span className="text-adm-t3">—</span>}
                </td>

                {/* Created */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(customer.createdAt)}
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
              ? `Showing ${items.length} / ${total} customer${total === 1 ? '' : 's'}`
              : 'No customers'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchCustomers(page)}
            />
          )}
        </div>
      </div>

    </div>
  );
};

export default CustomerManagement;
