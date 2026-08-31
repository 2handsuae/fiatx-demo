// admin-web/src/pages/SumsubEventsPage.tsx
import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

// ── Types ──────────────────────────────────────────────────────────────────

type EventStatus = 'PENDING' | 'PROCESSED' | 'FAILED' | 'DEAD';

interface SumsubEventItem {
  id: string;
  eventNo: string;
  eventType: string;
  applicantId: string;
  externalUserId: string;
  context: string;
  status: EventStatus;
  retryCount: number;
  isSimulated: boolean;
  receivedAt: string;
  processedAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

interface ListResponse {
  total: number;
  skip: number;
  take: number;
  items: SumsubEventItem[];
}

interface FilterState {
  status: string;
  eventType: string;
  externalUserId: string;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  eventType: '',
  externalUserId: '',
};

const STATUS_BADGE_MAP: Record<EventStatus, string> = {
  PROCESSED: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'REJECTED',
  DEAD: 'FAILED',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function SumsubEventsPage() {
  const [items, setItems] = useState<SumsubEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simulation modal state





  const fetchEvents = async (page: number, f: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.status) params.set('status', f.status);
      if (f.eventType) params.set('eventType', f.eventType);
      if (f.externalUserId) params.set('externalUserId', f.externalUserId);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub-events?${params}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load events.'));
      }
      const res: ListResponse = await response.json();
      setItems(res.items);
      setTotal(res.total);
      setCurrentPage(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvents(1, filters);
  }, []);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchEvents(1, DEFAULT_FILTERS);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Title bar */}
      <PageTitleBar
        title="Sumsub Events"
        meta={`${total} events · Unified webhook log`}
      >
        <button
          onClick={() => void fetchEvents(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED</option>
          <option value="DEAD">DEAD</option>
        </select>
        <select
          value={filters.eventType}
          onChange={(e) => setFilters((p) => ({ ...p, eventType: e.target.value }))}
          className={`${fi} w-52`}
        >
          <option value="">All Event Types</option>
          <option value="applicantPending">applicantPending</option>
          <option value="applicantOnHold">applicantOnHold</option>
          <option value="applicantReviewed">applicantReviewed</option>
          <option value="applicantLevelChanged">applicantLevelChanged</option>
          <option value="applicantWorkflowCompleted">applicantWorkflowCompleted</option>
          <option value="applicantWorkflowFailed">applicantWorkflowFailed</option>
        </select>
        <input
          value={filters.externalUserId}
          onChange={(e) => setFilters((p) => ({ ...p, externalUserId: e.target.value }))}
          placeholder="Customer No / ID"
          className={`${fi} w-40`}
        />
        <button
          onClick={() => void fetchEvents(1, filters)}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button onClick={handleReset} className={adminButtonClass('listSecondary')}>
          Reset
        </button>
      </div>

      {/* Banners */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(['Event No', 'Received', 'Type', 'Customer', 'Context', 'Status', 'Retries'] as string[]).map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-adm-border bg-adm-panel px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No events found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-adm-border transition-colors hover:bg-adm-hover"
                >
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.eventNo}
                    </span>
                    {item.isSimulated && (
                      <span className="ml-2 rounded border border-adm-blue/25 bg-adm-blue/8 px-1 font-mono text-[9px] text-adm-blue">
                        SIM
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                    {new Date(item.receivedAt).toLocaleDateString()}
                    <br />
                    {new Date(item.receivedAt).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                    {item.eventType}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                    {item.externalUserId}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t3">
                    {item.context}
                  </td>
                  <td className="px-3 py-2.5">
                    <AdminBadge value={STATUS_BADGE_MAP[item.status] ?? item.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t3">
                    {item.retryCount}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchEvents(page, filters)}
        />
      </div>

      {/* Simulation Modal */}
    </div>
  );
}
