import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  CircleDashed,
  Send,
  Inbox,
  CheckCircle2,
  ShieldAlert,
  Ban,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { SimulationRail } from '../components/SimulationRail';
import { useSimulationMode } from '../utils/simulationMode';

type TravelRuleReport = {
  id: string;
  sourceType: string;
  sourceId: string;
  provider?: string | null;
  providerTransferId?: string | null;
  required: boolean;
  status: string;
  counterpartyVasp?: string | null;
  rawPayload?: string | null;
  normalizedPayload?: string | null;
  receivedAt: string;
  createdAt: string;
};

type TravelRuleResponseDetail = {
  id: string;
  caseNo: string;
  sourceType: string;
  sourceId: string;
  required: boolean;
  status: string;
  provider: string;
  providerTransferId?: string | null;
  counterpartyVasp?: string | null;
  checkedAt?: string | null;
  updatedAt: string;
  latestRawPayload?: string | null;
  latestNormalizedPayload?: string | null;
  derivedComplianceStatus: string;
  sourceSummary: {
    sourceType: string;
    sourceId: string;
    sourceNo?: string | null;
    ownerType?: string | null;
    ownerId?: string | null;
    ownerNo?: string | null;
    customerId?: string | null;
    customerNo?: string | null;
    derivedComplianceStatus: string;
  };
  reports?: TravelRuleReport[];
};

const tryParsePayload = (raw?: string | null) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

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

const InfoGrid = ({
  items,
}: {
  items: Array<{ label: string; value: string | number | boolean | null | undefined }>;
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
    {items.map((item) => (
      <div key={item.label}>
        <span className="text-gray-500 text-xs block">{item.label}</span>
        <span className="text-gray-900">
          {typeof item.value === 'boolean' ? (item.value ? 'Yes' : 'No') : item.value ?? '-'}
        </span>
      </div>
    ))}
  </div>
);

const TransactionTravelRuleResponseDetailPage = () => {
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [data, setData] = useState<TravelRuleResponseDetail | null>(null);
  const { enabled: simulationModeEnabled } = useSimulationMode();

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/tx-travel-rule-cases/${id}?includeReports=true&includePayload=true&limit=50&offset=0`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load Travel Rule response.'),
        );
      }
      setData((await response.json()) as TravelRuleResponseDetail);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setErrorMessage(getErrorMessage(error, 'Failed to load Travel Rule response.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleMockComplete = useCallback(
    async (status: string) => {
      if (!data) return;
      setSubmitting(true);
      setErrorMessage('');
      try {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/tx-travel-rule-cases/mock-complete`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sourceType: data.sourceType,
              sourceId: data.sourceId,
              required: data.required,
              status,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(
              response,
              'Failed to mock-complete Travel Rule response.',
            ),
          );
        }
        await fetchDetail();
      } catch (error) {
        if (error instanceof AdminSessionError) return;
        setErrorMessage(
          getErrorMessage(error, 'Failed to mock-complete Travel Rule response.'),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [data, fetchDetail],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/compliance/tx-travel-rule-responses')}
            className="p-2 border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Travel Rule Response Detail</h1>
            <p className="text-sm text-gray-500 mt-1">{id}</p>
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
          {simulationModeEnabled ? (
            <SimulationRail
              title="Travel Rule Simulation Rail"
              description="Travel Rule 也是自动判断节点，这里通过 icon rail 推进 provider 返回。"
              items={[
                {
                  id: 'pending',
                  label: 'Pending',
                  icon: <CircleDashed size={14} />,
                  state:
                    data.status === 'PENDING'
                      ? 'current'
                      : ['SENT', 'RECEIVED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_REQUIRED'].includes(
                            data.status,
                          )
                        ? 'completed'
                        : 'readonly',
                  helperText: '等待 Travel Rule 结果',
                },
                {
                  id: 'sent',
                  label: 'Sent',
                  icon: <Send size={14} />,
                  state: data.status === 'PENDING' ? 'available' : data.status === 'SENT' ? 'current' : 'readonly',
                  onClick: ['PENDING', 'RECEIVED'].includes(data.status) ? () => handleMockComplete('SENT') : undefined,
                  disabled: submitting,
                  helperText: '已发送给对手方',
                },
                {
                  id: 'received',
                  label: 'Received',
                  icon: <Inbox size={14} />,
                  state: data.status === 'RECEIVED' ? 'current' : ['PENDING', 'SENT'].includes(data.status) ? 'available' : 'readonly',
                  onClick: ['PENDING', 'SENT'].includes(data.status) ? () => handleMockComplete('RECEIVED') : undefined,
                  disabled: submitting,
                  helperText: '收到对手方资料',
                },
                {
                  id: 'accepted',
                  label: 'Accepted',
                  icon: <CheckCircle2 size={14} />,
                  state:
                    data.status === 'ACCEPTED'
                      ? 'current'
                      : ['PENDING', 'SENT', 'RECEIVED'].includes(data.status)
                        ? 'available'
                        : 'readonly',
                  tone: 'success',
                  onClick:
                    ['PENDING', 'SENT', 'RECEIVED'].includes(data.status)
                      ? () => handleMockComplete('ACCEPTED')
                      : undefined,
                  disabled: submitting,
                  helperText: 'Travel Rule 放行',
                },
                {
                  id: 'rejected',
                  label: 'Rejected',
                  icon: <ShieldAlert size={14} />,
                  state:
                    data.status === 'REJECTED'
                      ? 'current'
                      : ['PENDING', 'SENT', 'RECEIVED'].includes(data.status)
                        ? 'available'
                        : 'readonly',
                  tone: 'danger',
                  onClick:
                    ['PENDING', 'SENT', 'RECEIVED'].includes(data.status)
                      ? () => handleMockComplete('REJECTED')
                      : undefined,
                  disabled: submitting,
                  helperText: 'Travel Rule 拒绝',
                },
                {
                  id: 'expired',
                  label: 'Expired',
                  icon: <Ban size={14} />,
                  state:
                    data.status === 'EXPIRED'
                      ? 'current'
                      : ['PENDING', 'SENT', 'RECEIVED'].includes(data.status)
                        ? 'available'
                        : 'readonly',
                  tone: 'warning',
                  onClick:
                    ['PENDING', 'SENT', 'RECEIVED'].includes(data.status)
                      ? () => handleMockComplete('EXPIRED')
                      : undefined,
                  disabled: submitting,
                  helperText: '超时未完成',
                },
                {
                  id: 'not-required',
                  label: 'Not Required',
                  icon: <CheckCircle2 size={14} />,
                  state:
                    data.status === 'NOT_REQUIRED'
                      ? 'current'
                      : data.status === 'PENDING'
                        ? 'available'
                        : 'readonly',
                  tone: 'success',
                  onClick: data.status === 'PENDING' ? () => handleMockComplete('NOT_REQUIRED') : undefined,
                  disabled: submitting,
                  helperText: '该笔无需 Travel Rule',
                },
              ]}
            />
          ) : null}

          <section className="bg-white border border-admin-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Response Summary</h2>
            <InfoGrid
              items={[
                { label: 'Response No', value: data.caseNo },
                { label: 'Source Type', value: data.sourceType },
                { label: 'Source ID', value: data.sourceId },
                { label: 'Required', value: data.required },
                { label: 'Status', value: data.status },
                { label: 'Provider', value: data.provider },
                { label: 'Provider Transfer ID', value: data.providerTransferId },
                { label: 'Counterparty VASP', value: data.counterpartyVasp },
                {
                  label: 'Checked At',
                  value: data.checkedAt ? new Date(data.checkedAt).toLocaleString() : '-',
                },
                {
                  label: 'Updated At',
                  value: data.updatedAt ? new Date(data.updatedAt).toLocaleString() : '-',
                },
              ]}
            />
          </section>

          <section className="bg-white border border-admin-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Source Summary</h2>
            <InfoGrid
              items={[
                { label: 'Transaction No', value: data.sourceSummary.sourceNo },
                { label: 'Owner Type', value: data.sourceSummary.ownerType },
                { label: 'Owner ID', value: data.sourceSummary.ownerId },
                { label: 'Owner No', value: data.sourceSummary.ownerNo },
                { label: 'Customer ID', value: data.sourceSummary.customerId },
                { label: 'Customer No', value: data.sourceSummary.customerNo },
                {
                  label: 'Derived Compliance',
                  value: data.sourceSummary.derivedComplianceStatus,
                },
              ]}
            />
          </section>

          <section className="bg-white border border-admin-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Latest Payload Snapshot</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <JsonBlock
                title="Latest Raw Payload"
                value={tryParsePayload(data.latestRawPayload)}
              />
              <JsonBlock
                title="Latest Normalized Payload"
                value={tryParsePayload(data.latestNormalizedPayload)}
              />
            </div>
          </section>

          <section className="bg-white border border-admin-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Provider Reports</h2>
            {(data.reports || []).length === 0 ? (
              <div className="text-sm text-gray-500">No reports</div>
            ) : (
              <div className="space-y-4">
                {(data.reports || []).map((report) => (
                  <div key={report.id} className="border border-gray-200 rounded-lg p-4 space-y-4">
                    <InfoGrid
                      items={[
                        { label: 'Report ID', value: report.id },
                        { label: 'Provider', value: report.provider },
                        { label: 'Provider Transfer ID', value: report.providerTransferId },
                        { label: 'Required', value: report.required },
                        { label: 'Status', value: report.status },
                        { label: 'Counterparty VASP', value: report.counterpartyVasp },
                        {
                          label: 'Received At',
                          value: report.receivedAt
                            ? new Date(report.receivedAt).toLocaleString()
                            : '-',
                        },
                        {
                          label: 'Created At',
                          value: report.createdAt
                            ? new Date(report.createdAt).toLocaleString()
                            : '-',
                        },
                      ]}
                    />
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
        </>
      )}
    </div>
  );
};

export default TransactionTravelRuleResponseDetailPage;
