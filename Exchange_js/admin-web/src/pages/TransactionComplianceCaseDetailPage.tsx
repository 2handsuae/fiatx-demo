import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

type KytReport = {
  id: string;
  provider?: string;
  providerCaseId?: string | null;
  screeningStage?: string;
  receivedAt: string;
  rawPayload?: string;
  normalizedPayload?: string;
};

type TravelReport = {
  id: string;
  provider?: string;
  providerTransferId?: string | null;
  status?: string;
  receivedAt: string;
  rawPayload?: string;
  normalizedPayload?: string;
};

type KytCaseBundle = {
  id: string;
  caseNo: string;
  status: string;
  screeningStage: string;
  provider: string;
  providerCaseId?: string | null;
  riskScore?: number | null;
  checkedAt?: string | null;
  reports?: KytReport[];
};

type TravelCaseBundle = {
  id: string;
  caseNo: string;
  status: string;
  required: boolean;
  provider: string;
  providerTransferId?: string | null;
  counterpartyVasp?: string | null;
  checkedAt?: string | null;
  reports?: TravelReport[];
};

type AggregateResponse = {
  sourceType: string;
  sourceId: string;
  derivedComplianceStatus: string;
  preKytCase?: KytCaseBundle | null;
  mainKytCase?: KytCaseBundle | null;
  travelRuleCase?: TravelCaseBundle | null;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const tryParsePayload = (raw?: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const JsonBlock = ({ title, value }: { title: string; value: unknown }) => (
  <div className="border border-gray-200 rounded-lg overflow-hidden">
    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
      {title}
    </div>
    <pre className="text-xs bg-gray-950 text-gray-100 p-3 overflow-auto">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  </div>
);

const CaseSummaryCard = ({
  title,
  payload,
}: {
  title: string;
  payload: KytCaseBundle | TravelCaseBundle | null | undefined;
}) => {
  if (!payload) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 text-sm text-gray-500">
        {title}: no case
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
          {payload.status}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500 text-xs block">Case No</span>
          <span className="text-gray-900">{payload.caseNo}</span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">Provider</span>
          <span className="text-gray-900">{payload.provider || '-'}</span>
        </div>
      </div>
    </div>
  );
};

const TransactionComplianceCaseDetailPage = () => {
  const navigate = useNavigate();
  const { sourceType = '', sourceId = '' } = useParams<{
    sourceType: string;
    sourceId: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [data, setData] = useState<AggregateResponse | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/tx-cases/${String(sourceType).toUpperCase()}/${sourceId}?includeReports=true&includePayload=true&limit=50&offset=0`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load case bundle.'));
      }
      setData((await response.json()) as AggregateResponse);
    } catch (error) {
      if (error instanceof AdminSessionError) {
        return;
      }
      setErrorMessage(getErrorMessage(error, 'Failed to load case bundle.'));
    } finally {
      setLoading(false);
    }
  }, [sourceId, sourceType]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const reportGroups = useMemo(
    () => [
      {
        label: 'Pre-KYT Reports',
        items: (data?.preKytCase?.reports || []) as Array<KytReport | TravelReport>,
      },
      {
        label: 'KYT Reports',
        items: (data?.mainKytCase?.reports || []) as Array<KytReport | TravelReport>,
      },
      {
        label: 'Travel Rule Reports',
        items: (data?.travelRuleCase?.reports || []) as Array<KytReport | TravelReport>,
      },
    ],
    [data],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/compliance/tx-evidence')}
            className="p-2 border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tx Evidence Bundle</h1>
            <p className="text-sm text-gray-500 mt-1">
              {String(sourceType).toUpperCase()} / {sourceId}
            </p>
          </div>
        </div>
        <button
          onClick={fetchDetail}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {errorMessage && (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {errorMessage}
        </div>
      )}

      {data && (
        <>
          <div className="bg-white border border-admin-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-gray-500 text-xs block">Source Type</span>
              <span className="text-gray-900">{data.sourceType}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Source ID</span>
              <span className="text-gray-900">{data.sourceId}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Derived Compliance</span>
              <span className="text-gray-900">{data.derivedComplianceStatus}</span>
            </div>
            <div>
              <span className="text-gray-500 text-xs block">Approval Policy</span>
              <span className="text-gray-900">Transaction-only approval</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CaseSummaryCard title="Pre-KYT" payload={data.preKytCase} />
            <CaseSummaryCard title="KYT" payload={data.mainKytCase} />
            <CaseSummaryCard title="Travel Rule" payload={data.travelRuleCase} />
          </div>

          <div className="space-y-4">
            {reportGroups.map((group) => (
              <section key={group.label} className="bg-white border border-admin-border rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">{group.label}</h2>
                {group.items.length === 0 ? (
                  <div className="text-sm text-gray-500">No reports</div>
                ) : (
                  <div className="space-y-3">
                    {group.items.map((report) => (
                      <div key={report.id} className="border border-gray-200 rounded-lg p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-600 mb-3">
                          <div>ID: {report.id}</div>
                          <div>
                            Received:{' '}
                            {report.receivedAt
                              ? new Date(report.receivedAt).toLocaleString()
                              : '-'}
                          </div>
                          {'providerCaseId' in report ? (
                            <div>Provider Case ID: {report.providerCaseId || '-'}</div>
                          ) : (
                            <div>
                              Provider Transfer ID:{' '}
                              {(report as TravelReport).providerTransferId || '-'}
                            </div>
                          )}
                          <div>Provider: {report.provider || '-'}</div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <JsonBlock
                            title="Raw Payload"
                            value={tryParsePayload(report.rawPayload)}
                          />
                          <JsonBlock
                            title="Normalized Payload"
                            value={tryParsePayload(report.normalizedPayload)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default TransactionComplianceCaseDetailPage;
