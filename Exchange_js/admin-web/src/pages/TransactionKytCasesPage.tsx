import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

type KytCaseItem = {
  id: string;
  caseNo: string;
  sourceType: string;
  sourceId: string;
  screeningStage: string;
  provider: string;
  providerCaseId?: string | null;
  status: string;
  riskScore?: number | null;
  checkedAt?: string | null;
  updatedAt: string;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const statusClass = (current: string) => {
  switch (current) {
    case 'PASS':
      return 'bg-green-100 text-green-800';
    case 'FAIL':
      return 'bg-red-100 text-red-800';
    case 'REVIEW':
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const TransactionKytCasesPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<KytCaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [screeningStage, setScreeningStage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const query = new URLSearchParams();
      if (sourceType) query.set('sourceType', sourceType);
      if (sourceId) query.set('sourceId', sourceId);
      if (status) query.set('status', status);
      if (provider) query.set('provider', provider);
      if (screeningStage) query.set('screeningStage', screeningStage);
      query.set('take', '200');

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/tx-kyt-cases?${query.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load KYT responses'));
      }
      const payload = await response.json();
      setItems((payload?.items || []) as KytCaseItem[]);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setErrorMessage(getErrorMessage(error, 'Failed to load KYT responses.'));
    } finally {
      setLoading(false);
    }
  }, [provider, screeningStage, sourceId, sourceType, status]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const txCount = useMemo(() => {
    const sourceSet = new Set(items.map((item) => `${item.sourceType}:${item.sourceId}`));
    return sourceSet.size;
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KYT Responses</h1>
          <p className="text-sm text-gray-500 mt-1">Read-only KYT provider responses and reports.</p>
        </div>
        <button
          onClick={fetchCases}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white border border-admin-border rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value.toUpperCase())}
            placeholder="Source Type (DEPOSIT/WITHDRAW)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            placeholder="Source ID"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={status}
            onChange={(e) => setStatus(e.target.value.toUpperCase())}
            placeholder="Status"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value.toUpperCase())}
            placeholder="Provider"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={screeningStage}
            onChange={(e) => setScreeningStage(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Stage (All)</option>
            <option value="PRE_TXN">PRE_TXN</option>
            <option value="MAIN">MAIN</option>
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
          <span>Rows: {items.length}</span>
          <span>Transactions: {txCount}</span>
          <button
            onClick={fetchCases}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-700"
          >
            <Search size={12} />
            Search
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {errorMessage}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-admin-content-bg border-b border-admin-border">
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Response</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Source</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Stage</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Provider Ref</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Updated</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No KYT responses found
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{item.caseNo}</div>
                    <div className="text-xs text-gray-400">{item.id}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{item.sourceType}</div>
                    <div className="text-xs text-gray-500">{item.sourceId}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{item.screeningStage}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{item.provider}</div>
                    <div className="text-xs text-gray-500">{item.providerCaseId || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/dashboard/compliance/tx-kyt-responses/${item.id}`)}
                      className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      View Response
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TransactionKytCasesPage;
