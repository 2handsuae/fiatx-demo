import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { adminFetch } from '../utils/adminFetch';
import Pagination from '../components/common/Pagination';

const STATUS_OPTIONS = ['ALL', 'PENDING_ACTIVATION', 'ACTIVE', 'CANCELLED', 'SUSPENDED'];
const TYPE_OPTIONS = ['ALL', 'VASP', 'SELF_CUSTODY'];

const STATUS_COLORS: Record<string, string> = {
  PENDING_ACTIVATION: 'bg-amber-500/10 text-amber-400',
  ACTIVE: 'bg-emerald-500/10 text-emerald-400',
  CANCELLED: 'bg-slate-500/10 text-slate-400',
  SUSPENDED: 'bg-red-500/10 text-red-400',
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  VASP: { label: 'VASP', color: 'bg-blue-500/10 text-blue-400' },
  SELF_CUSTODY: { label: 'Self-Custody', color: 'bg-purple-500/10 text-purple-400' },
};

interface WithdrawalAddr {
  id: string;
  addressNo: string;
  customerId: string;
  customerNo: string;
  address: string;
  addressType: string;
  network: string;
  status: string;
  createdAt: string;
  asset: { code: string };
}

export default function WithdrawalAddressList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithdrawalAddr[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const take = 20;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ take: String(take), skip: String(page * take) });
        if (statusFilter !== 'ALL') params.set('status', statusFilter);
        if (typeFilter !== 'ALL') params.set('addressType', typeFilter);
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses?${params}`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
        }
      } catch { /* session error handled globally */ }
      setLoading(false);
    };
    void fetchData();
  }, [statusFilter, typeFilter, page]);

  const truncateAddr = (a: string) => a.length > 14 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-adm-t1">Withdrawal Addresses</h1>
      </div>

      <div className="mb-4 flex gap-3">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded border border-adm-border bg-adm-bg px-2 py-1 text-xs text-adm-t1">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="rounded border border-adm-border bg-adm-bg px-2 py-1 text-xs text-adm-t1">
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t === 'ALL' ? 'All Types' : t}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-adm-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-adm-panel text-adm-t3">
            <tr>
              <th className="px-3 py-2">Address No</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Asset</th>
              <th className="px-3 py-2">Network</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Registered</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-adm-border">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-adm-t3">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-adm-t3">No withdrawal addresses found.</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} onClick={() => navigate(`/withdrawal-addresses/${item.addressNo}`)}
                className="cursor-pointer hover:bg-adm-hover transition-colors">
                <td className="px-3 py-2 font-mono text-adm-amber">{item.addressNo}</td>
                <td className="px-3 py-2 text-adm-blue">{item.customerNo}</td>
                <td className="px-3 py-2 text-adm-t1">{item.asset?.code}</td>
                <td className="px-3 py-2 text-adm-t2">{item.network}</td>
                <td className="px-3 py-2 font-mono text-adm-t2">{truncateAddr(item.address)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_LABELS[item.addressType]?.color ?? 'text-adm-t3'}`}>
                    {TYPE_LABELS[item.addressType]?.label ?? item.addressType}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[item.status] ?? 'text-adm-t3'}`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-adm-t3">{new Date(item.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-adm-t3"><ChevronRight size={14} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > take && <Pagination total={total} take={take} page={page} onPageChange={setPage} />}
    </div>
  );
}
