import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  DetailCard,
  DetailPageHeader,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { formatResponseLifecycleLabel } from '../utils/transactionRootDisplay';

type KytReport = {
  id: string;
  sourceType: string;
  sourceId: string;
  screeningStage: string;
  provider?: string | null;
  providerCaseId?: string | null;
  rawPayload?: string | null;
  normalizedPayload?: string | null;
  receivedAt: string;
  createdAt: string;
};

type KytResponseDetail = {
  id: string;
  caseNo: string;
  sourceType: string;
  sourceId: string;
  screeningStage: string;
  status: string;
  provider: string;
  providerCaseId?: string | null;
  riskScore?: number | null;
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
  reports?: KytReport[];
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

const InfoGrid = ({
  items,
}: {
  items: Array<{ label: string; value: string | number | null | undefined }>;
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
    {items.map((item) => (
      <div key={item.label}>
        <span className="text-gray-500 text-xs block">{item.label}</span>
        <span className="text-gray-900">{item.value ?? '-'}</span>
      </div>
    ))}
  </div>
);

const TransactionKytResponseDetailPage = () => {
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [data, setData] = useState<KytResponseDetail | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/tx-kyt-cases/${id}?includeReports=true&includePayload=true&limit=50&offset=0`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load KYT response.'));
      }
      setData((await response.json()) as KytResponseDetail);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setErrorMessage(getErrorMessage(error, 'Failed to load KYT response.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return (
    <div className="space-y-6">
      <DetailPageHeader
        title="KYT Response Detail"
        subtitle={data?.caseNo || id}
        onBack={() => navigate('/dashboard/compliance/tx-kyt-responses')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to KYT Responses"
      />

      {errorMessage && (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {errorMessage}
        </div>
      )}

      {data && (
        <>
          <section className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900 space-y-1">
            <div className="font-semibold">Response Container Only</div>
            <p>
              KYT responses only retain provider payload as evidence for the withdraw flow. Risk
              decisions and transaction progression are still driven by risk execution, alerts,
              and case callbacks, not by manual simulation here.
            </p>
          </section>

          <DetailCard title="Response Summary" columns={1}>
            <InfoGrid
              items={[
                { label: 'Response No', value: data.caseNo },
                { label: 'Source Type', value: data.sourceType },
                { label: 'Source ID', value: data.sourceId },
                { label: 'Screening Stage', value: data.screeningStage },
                {
                  label: 'Lifecycle',
                  value: formatResponseLifecycleLabel(data.status),
                },
                { label: 'Provider', value: data.provider },
                { label: 'Provider Case ID', value: data.providerCaseId },
                { label: 'Risk Score', value: data.riskScore },
                {
                  label: 'Lifecycle Meaning',
                  value: 'CREATED / RECEIVED / FINAL',
                },
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
          </DetailCard>

          <DetailCard title="Source Summary" columns={1}>
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
          </DetailCard>

          <DetailCard title="Latest Payload Snapshot" columns={1}>
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
          </DetailCard>

          <DetailCard title="Provider Reports" columns={1}>
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
                        { label: 'Provider Case ID', value: report.providerCaseId },
                        { label: 'Stage', value: report.screeningStage },
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
          </DetailCard>
        </>
      )}
    </div>
  );
};

export default TransactionKytResponseDetailPage;
