// admin-web/src/pages/InternalTransferList.tsx
// 平账二期：内部划转单列表（公司 → 客户补款 / 垫款）。入口只在案子上，这里是查与回看；金库 / CFO / 运营 / 内审 / 高管可读。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  INTERNAL_TRANSFER_PURPOSE_LABEL,
  INTERNAL_TRANSFER_STATUSES,
  INTERNAL_TRANSFER_STATUS_LABEL,
} from '../utils/internalTransferStatusMap';

interface Item {
  transferNo: string;
  purpose: string;
  status: string;
  customerNo: string;
  assetCode: string;
  currency: string;
  amount: string;
  sourceCaseNo: string;
  sourceAdjustmentNo: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

const InternalTransferList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [purpose, setPurpose] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchItems = async (nextPage = page, nextStatus = status, nextPurpose = purpose) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        skip: String((nextPage - 1) * PAGE_SIZE),
        take: String(PAGE_SIZE),
      });
      if (nextStatus) params.set('status', nextStatus);
      if (nextPurpose) params.set('purpose', nextPurpose);
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transfers?${params.toString()}`,
      );
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load internal transfers'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(nextPage);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Internal Transfers"
        subtitle="Firm → customer compensation / advance; initiated on the reconciliation case, this page only queries and reviews"
        meta={`${total} transfer(s)`}
      >
        <button
          type="button"
          onClick={() => void fetchItems(page)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            void fetchItems(1, e.target.value, purpose);
          }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All statuses</option>
          {INTERNAL_TRANSFER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INTERNAL_TRANSFER_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value);
            void fetchItems(1, status, e.target.value);
          }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All purposes</option>
          <option value="CLIENT_COMPENSATION">Compensation</option>
          <option value="CLIENT_ADVANCE">Advance</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['No.', 'Purpose', 'Customer', 'Amount', 'Status', 'Source Case', 'Source Adjustment', 'Time'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.transferNo}
                onClick={() =>
                  navigate(`/admin/treasury/internal-transfers/${encodeURIComponent(it.transferNo)}`)
                }
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.transferNo}</td>
                <td className="px-4 py-2">
                  {INTERNAL_TRANSFER_PURPOSE_LABEL[it.purpose] ?? it.purpose}
                </td>
                <td className="px-4 py-2 font-mono">{it.customerNo}</td>
                <td className="px-4 py-2 font-mono">
                  {it.amount} {it.currency}
                </td>
                <td className="px-4 py-2">
                  <StatusPill value={it.status} />
                </td>
                <td className="px-4 py-2 font-mono">{it.sourceCaseNo}</td>
                <td className="px-4 py-2 font-mono">{it.sourceAdjustmentNo ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-adm-t3">
                  {new Date(it.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-adm-t3">
                  No transfers yet — initiate a compensation / advance from a reconciliation case
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalItems={total}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => void fetchItems(p)}
      />
    </div>
  );
};

export default InternalTransferList;
