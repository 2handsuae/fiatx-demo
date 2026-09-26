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
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import type { AdminRestrictionRow } from '../utils/restrictionCauseMeta';

/* ── Interfaces ──────────────────────────────────────────────── */

interface CustomerItem {
  id: string;
  customerNo: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  customerType: string;
  lifecycle: string;
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
  lifecycle: string;
  customerType: string;
  /** 客户端筛选：'' 全部 / HAS 有限制 / NONE 无限制 / SANCTION 仅制裁 */
  restriction: '' | 'HAS' | 'NONE' | 'SANCTION';
}

interface RestrictionSummary {
  open: number;
  sanction: boolean;
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
  lifecycle: '',
  customerType: '',
  restriction: '',
};

const LIFECYCLES = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

/* ── RestrictionCell ─────────────────────────────────────────── */

const RestrictionCell = ({ summary }: { summary?: RestrictionSummary }) => {
  if (!summary || summary.open === 0) {
    return <span className="font-mono text-[10px] text-adm-t3">—</span>;
  }
  return (
    <span
      className={[
        'inline-flex items-center rounded border px-1.5 py-px font-mono text-[10px] font-semibold',
        summary.sanction
          ? 'border-adm-red/25 bg-adm-red/10 text-adm-red'
          : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
      ].join(' ')}
    >
      {summary.open} OPEN
    </span>
  );
};

/* ─────────────────────────────────────────────────────────────── */

const CustomerManagement = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canReadRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_READ);
  const [summaries, setSummaries] = useState<Record<string, RestrictionSummary>>({});

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
    if (next.lifecycle.trim()) params.set('status', next.lifecycle.trim());
    if (next.customerType.trim()) params.set('customerType', next.customerType.trim());
    return params;
  };

  /* 无批量端点：当页 20 行各拉一次 GET /admin/customers/:customerNo/restrictions。
     take=20 固定，量可控；失败按 0 计，不让摘要拖垮主列表。 */
  const loadRestrictionSummaries = async (rows: CustomerItem[]) => {
    if (!canReadRestrictions || rows.length === 0) {
      setSummaries({});
      return;
    }
    const entries = await Promise.all(
      rows.map(async (row): Promise<[string, RestrictionSummary]> => {
        try {
          const res = await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/customers/${row.customerNo}/restrictions`,
          );
          if (!res.ok) return [row.customerNo, { open: 0, sanction: false }];
          const data = (await res.json()) as AdminRestrictionRow[];
          const openRows = Array.isArray(data) ? data.filter((r) => r.status === 'OPEN') : [];
          return [
            row.customerNo,
            {
              open: openRows.length,
              // 战役甲波三 T4修（评审黄4）：CONFIRMED 出口把 SILENT 的 SANCTION 便签解列、
              // 换开 DISCLOSED 的 SANCTION_CONFIRMED 便签（同为 customerLevel 制裁语义，
              // 见 restriction-cause.constant.ts）——只认 cause==='SANCTION' 会让确认过的
              // 客户从这里的 Sanction 视图消失、只剩下面板普通的琥珀 "N OPEN"，看不出
              // 这仍是一起制裁案。两个 cause 都算进「制裁」这个客户端徽章判据。
              sanction: openRows.some((r) => r.cause === 'SANCTION' || r.cause === 'SANCTION_CONFIRMED'),
            },
          ];
        } catch {
          return [row.customerNo, { open: 0, sanction: false }];
        }
      }),
    );
    setSummaries(Object.fromEntries(entries));
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
      void loadRestrictionSummaries(rows);
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
    !!filters.keyword ||
    !!filters.lifecycle ||
    !!filters.customerType ||
    !!filters.restriction;

  /* Restrictions 是客户端筛选（服务端列表没有聚合字段），只作用于当前页。 */
  const visibleItems = items.filter((c) => {
    if (!filters.restriction) return true;
    const summary = summaries[c.customerNo];
    const open = summary?.open ?? 0;
    if (filters.restriction === 'HAS') return open > 0;
    if (filters.restriction === 'NONE') return open === 0;
    return !!summary?.sanction;
  });

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
          value={filters.lifecycle}
          onChange={(e) => updateFilter('lifecycle', e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All lifecycle</option>
          {LIFECYCLES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
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
        {canReadRestrictions && (
          <select
            value={filters.restriction}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                restriction: e.target.value as FilterState['restriction'],
              }))
            }
            className={`${fi} w-40`}
            title="Filters the rows loaded on this page"
          >
            <option value="">All restrictions</option>
            <option value="HAS">Restricted</option>
            <option value="NONE">Unrestricted</option>
            <option value="SANCTION">Sanction only</option>
          </select>
        )}
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
                  ['Lifecycle',    '160px'],
                  ['Restrictions', '130px'],
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
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visibleItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No customers found.
                </td>
              </tr>
            )}
            {!loading && visibleItems.map((customer) => (
              <tr
                key={customer.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/customers/${customer.customerNo}`)}
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

                {/* Lifecycle */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={customer.lifecycle} />
                </td>

                {/* Restrictions */}
                <td className="px-4 py-2.5">
                  <RestrictionCell summary={summaries[customer.customerNo]} />
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
              ? `Showing ${visibleItems.length} / ${total} customer${total === 1 ? '' : 's'}${
                  filters.restriction ? ' (restriction filter applies to this page)' : ''
                }`
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
