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
  status: string;
  updatedAt: string;
};

type TravelRuleCaseItem = {
  id: string;
  caseNo: string;
  sourceType: string;
  sourceId: string;
  provider: string;
  required: boolean;
  status: string;
  updatedAt: string;
};

type BundleRow = {
  sourceType: string;
  sourceId: string;
  providers: Set<string>;
  preKytStatus: string;
  mainKytStatus: string;
  travelRuleStatus: string;
  hasPre: boolean;
  hasMain: boolean;
  hasTravel: boolean;
  updatedAt: string;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const statusClass = (current: string) => {
  switch (current) {
    case 'PASS':
    case 'ACCEPTED':
    case 'NOT_REQUIRED':
      return 'bg-green-100 text-green-800';
    case 'FAIL':
    case 'REJECTED':
      return 'bg-red-100 text-red-800';
    case 'REVIEW':
    case 'PENDING':
    case 'SENT':
    case 'RECEIVED':
    case 'EXPIRED':
    case 'MISSING':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const maxIso = (a: string, b: string) => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
};

const TransactionComplianceCasesPage = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BundleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchBundles = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const kytQuery = new URLSearchParams();
      const travelQuery = new URLSearchParams();
      const appendSharedFilters = (query: URLSearchParams) => {
        if (sourceType) query.set('sourceType', sourceType);
        if (sourceId) query.set('sourceId', sourceId);
        if (status) query.set('status', status);
        if (provider) query.set('provider', provider);
        query.set('take', '500');
      };

      appendSharedFilters(kytQuery);
      appendSharedFilters(travelQuery);

      const [kytRes, travelRes] = await Promise.all([
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/tx-kyt-cases?${kytQuery.toString()}`,
        ),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/tx-travel-rule-cases?${travelQuery.toString()}`,
        ),
      ]);

      if (!kytRes.ok) {
        throw new Error(await getApiErrorMessage(kytRes, 'Failed to load KYT cases'));
      }
      if (!travelRes.ok) {
        throw new Error(
          await getApiErrorMessage(travelRes, 'Failed to load Travel Rule cases'),
        );
      }

      const [kytPayload, travelPayload] = await Promise.all([
        kytRes.json(),
        travelRes.json(),
      ]);
      const kytItems = (kytPayload?.items || []) as KytCaseItem[];
      const travelItems = (travelPayload?.items || []) as TravelRuleCaseItem[];

      const bundles = new Map<string, BundleRow>();
      const ensureRow = (sType: string, sId: string) => {
        const key = `${sType}:${sId}`;
        if (!bundles.has(key)) {
          bundles.set(key, {
            sourceType: sType,
            sourceId: sId,
            providers: new Set<string>(),
            preKytStatus: 'MISSING',
            mainKytStatus: 'MISSING',
            travelRuleStatus: 'MISSING',
            hasPre: false,
            hasMain: false,
            hasTravel: false,
            updatedAt: '',
          });
        }
        return bundles.get(key)!;
      };

      for (const item of kytItems) {
        const row = ensureRow(item.sourceType, item.sourceId);
        row.providers.add(item.provider);
        if (item.screeningStage === 'PRE_TXN') {
          row.preKytStatus = item.status;
          row.hasPre = true;
        } else {
          row.mainKytStatus = item.status;
          row.hasMain = true;
        }
        row.updatedAt = maxIso(row.updatedAt, item.updatedAt);
      }

      for (const item of travelItems) {
        const row = ensureRow(item.sourceType, item.sourceId);
        row.providers.add(item.provider);
        row.travelRuleStatus = item.status;
        row.hasTravel = true;
        row.updatedAt = maxIso(row.updatedAt, item.updatedAt);
      }

      const normalizedRows = Array.from(bundles.values())
        .sort(
          (a, b) =>
            new Date(b.updatedAt || 0).getTime() -
            new Date(a.updatedAt || 0).getTime(),
        );

      setRows(normalizedRows);
    } catch (error) {
      if (error instanceof AdminSessionError) {
        return;
      }
      setErrorMessage(getErrorMessage(error, 'Failed to load tx evidence bundles.'));
    } finally {
      setLoading(false);
    }
  }, [provider, sourceId, sourceType, status]);

  useEffect(() => {
    fetchBundles();
  }, [fetchBundles]);

  const coverage = useMemo(() => {
    const full = rows.filter((row) => row.hasMain && row.hasTravel).length;
    return {
      total: rows.length,
      full,
      partial: rows.length - full,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tx Evidence Bundles</h1>
          <p className="text-sm text-gray-500 mt-1">
            One bundle per transaction source (`sourceType + sourceId`).
          </p>
        </div>
        <button
          onClick={fetchBundles}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white border border-admin-border rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
          <span>Bundles: {coverage.total}</span>
          <span>Full (main+travel): {coverage.full}</span>
          <span>Partial: {coverage.partial}</span>
          <button
            onClick={fetchBundles}
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
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Source</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Pre-KYT</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">KYT</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Travel Rule</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Providers</th>
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
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No bundles found
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr key={`${item.sourceType}:${item.sourceId}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">
                    <div>{item.sourceType}</div>
                    <div className="text-xs text-gray-500">{item.sourceId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass(item.preKytStatus)}`}>
                      {item.preKytStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass(item.mainKytStatus)}`}>
                      {item.mainKytStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClass(item.travelRuleStatus)}`}>
                      {item.travelRuleStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{Array.from(item.providers).join(', ') || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        navigate(`/dashboard/compliance/tx-evidence/${item.sourceType}/${item.sourceId}`)
                      }
                      className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      View Bundle
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

export default TransactionComplianceCasesPage;
