import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, PlayCircle, RefreshCw, Search } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type SafeguardingBreakListItem = {
  id: string;
  breakNo: string;
  businessDate: string;
  status: string;
  withdrawNo?: string | null;
  payoutNo?: string | null;
  assetCode?: string | null;
  expectedNetDelta: string;
  observedNetDelta: string;
  deltaAmount: string;
  reasonCode: string;
  linkedAlert?: { id: string; alertNo: string; status: string } | null;
  linkedCase?: { id: string; incidentNo: string; status: string } | null;
  detectedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-rose-100 text-rose-800',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED_DIFFERENCE: 'bg-blue-100 text-blue-800',
};

const SafeguardingBreakList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SafeguardingBreakListItem[]>([]);
  const [status, setStatus] = useState('');
  const [businessDate, setBusinessDate] = useState('');
  const [withdrawNo, setWithdrawNo] = useState('');
  const [runBusinessDate, setRunBusinessDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (businessDate.trim()) params.set('businessDate', businessDate.trim());
      if (withdrawNo.trim()) params.set('withdrawNo', withdrawNo.trim());

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-breaks?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load safeguarding breaks.'),
        );
      }

      const result = await response.json();
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load safeguarding breaks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const handleRunDailyDiff = async () => {
    setRunning(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-breaks/generate-daily-diff`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ businessDate: runBusinessDate }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to run daily diff.'),
        );
      }

      const result = await response.json();
      setMessage(
        `Daily diff completed for ${result.businessDate}. ${result.breakCount} break(s) detected from ${result.candidateCount} candidate root(s).`,
      );
      await fetchItems();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to run daily diff.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Safeguarding Breaks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Minimum Wave 7 daily reconciliation for withdraw-driven outbound delta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={runBusinessDate}
            onChange={(e) => setRunBusinessDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => void handleRunDailyDiff()}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-60"
          >
            <PlayCircle size={16} />
            {running ? 'Running...' : 'Run Daily Diff'}
          </button>
          <button
            onClick={() => void fetchItems()}
            className="p-2 text-gray-500 hover:text-brand-primary"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={withdrawNo}
            onChange={(e) => setWithdrawNo(e.target.value)}
            placeholder="Withdraw No"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            <option value="OPEN">OPEN</option>
            <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="ACCEPTED_DIFFERENCE">ACCEPTED_DIFFERENCE</option>
          </select>
          <button
            onClick={() => void fetchItems()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
          >
            <Search size={16} />
            Search
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Business Date</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Break</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Withdraw / Payout</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Asset</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Expected / Observed / Delta</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Linked Alert / Case</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Detected At</th>
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
                    No safeguarding breaks found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.businessDate}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-brand-primary">{item.breakNo}</div>
                      <div className="mt-1 text-xs text-gray-500">{item.reasonCode}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-700'}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <div>{item.withdrawNo || '-'}</div>
                      <div className="mt-1 text-gray-500">{item.payoutNo || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{item.assetCode || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <div>Expected: {item.expectedNetDelta}</div>
                      <div>Observed: {item.observedNetDelta}</div>
                      <div className="text-rose-700">Delta: {item.deltaAmount}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      <div>{item.linkedAlert?.alertNo || '-'}</div>
                      <div className="mt-1 text-gray-500">{item.linkedCase?.incidentNo || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {new Date(item.detectedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/reconciliation/safeguarding-breaks/${item.id}`)}
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
      </div>
    </div>
  );
};

export default SafeguardingBreakList;
