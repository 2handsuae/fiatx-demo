import { type ReactNode, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface CddResponseItem {
  id: string;
  responseNo: string;
  responseType?: string | null;
  customerId: string;
  subjectKind: string;
  subjectRefId: string;
  status: string;
  workflow?: string | null;
  periodicReviewCycleId?: string | null;
  customer?: {
    customerNo?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    customerType?: string;
    companyName?: string | null;
  };
}

interface CddResponseDetail {
  id: string;
  responseNo: string;
  responseType?: string | null;
  status: string;
  subjectKind: string;
  subjectRefId: string;
  riskScore?: number | null;
  riskLevel?: string | null;
  requiresEdd?: boolean;
  workflow?: string | null;
  periodicReviewCycleId?: string | null;
  pepHit?: boolean;
  sanctionsHit?: boolean;
  inputData?: Record<string, unknown>;
  customerSnapshot?: {
    customerNo?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string | null;
    customerType?: string;
    onboardingStatus?: string;
    operatingStatus?: string;
    restrictionStatus?: string;
  };
  mockDetail?: Record<string, unknown>;
  latestReport?: {
    rawPayload?: Record<string, unknown>;
    normalizedPayload?: Record<string, unknown>;
  };
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const CddResponsesPage = () => {
  const [items, setItems] = useState<CddResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<CddResponseDetail | null>(null);
  const [workflowFilter, setWorkflowFilter] = useState<'ALL' | 'ONBOARDING' | 'PERIODIC_REVIEW'>(
    'ALL',
  );

  const fetchResponses = async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams();
      params.set('take', '200');
      if (workflowFilter !== 'ALL') {
        params.set('workflow', workflowFilter);
      }
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cdd-responses?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load data.'));
      }

      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) {
        return;
      }
      setMessage(getErrorMessage(e, 'Failed to load data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResponses();
  }, [workflowFilter]);

  const openResponseDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cdd-responses/${id}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load data.'));
      }

      setDetail((await response.json()) as CddResponseDetail);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Failed to load detail'));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - CDD Responses</h1>
          <p className="text-sm text-gray-500 mt-1">Review customer/company/UBO CDD responses.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={workflowFilter}
            onChange={(event) =>
              setWorkflowFilter(event.target.value as 'ALL' | 'ONBOARDING' | 'PERIODIC_REVIEW')
            }
            className="rounded-lg border border-admin-border px-3 py-2 text-sm"
          >
            <option value="ALL">All workflows</option>
            <option value="ONBOARDING">Onboarding</option>
            <option value="PERIODIC_REVIEW">Periodic review</option>
          </select>
          <button
            onClick={fetchResponses}
            className="p-2 text-gray-500 hover:text-brand-primary"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {message && (
        <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-admin-content-bg border-b border-admin-border">
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Response</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Customer</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Workflow</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No responses found
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{item.responseNo}</div>
                    <div className="text-xs text-gray-400">{item.id.slice(0, 8)}...</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{item.customer?.customerNo || '-'}</div>
                    <div className="text-xs text-gray-500">{item.customer?.email || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{item.subjectKind}</div>
                    <div className="text-xs text-gray-500">{item.subjectRefId.slice(0, 8)}...</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div>{item.workflow || 'ONBOARDING'}</div>
                    <div className="text-xs text-gray-500">
                      {item.periodicReviewCycleId || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-y-1">
                    <button
                      onClick={() => openResponseDetail(item.id)}
                      className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      View Detail
                    </button>
                    <span className="text-xs text-gray-500">Read-only evidence</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-xl shadow-xl border border-admin-border max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-admin-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  CDD Response Detail - {detail.responseNo}
                </h3>
                <p className="text-xs text-gray-500">{detail.id}</p>
              </div>
              <button onClick={() => setDetail(null)} className="p-2 text-gray-500 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading detail...</div>
            ) : (
              <div className="p-4 space-y-4 text-sm">
                <InfoBlock title="Response">
                  <JsonView
                    data={{
                      workflow: detail.workflow || 'ONBOARDING',
                      periodicReviewCycleId: detail.periodicReviewCycleId,
                      status: detail.status,
                      subjectKind: detail.subjectKind,
                      subjectRefId: detail.subjectRefId,
                      riskScore: detail.riskScore,
                      riskLevel: detail.riskLevel,
                      requiresEdd: detail.requiresEdd,
                      pepHit: detail.pepHit,
                      sanctionsHit: detail.sanctionsHit,
                    }}
                  />
                </InfoBlock>

                <InfoBlock title="Customer Snapshot">
                  <JsonView data={detail.customerSnapshot || {}} />
                </InfoBlock>

                <InfoBlock title="Input Data">
                  <JsonView data={detail.inputData || {}} />
                </InfoBlock>

                <InfoBlock title="Mock Detail">
                  <JsonView data={detail.mockDetail || {}} />
                </InfoBlock>

                <InfoBlock title="Latest Report">
                  <JsonView data={detail.latestReport || {}} />
                </InfoBlock>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const InfoBlock = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="border border-gray-200 rounded-lg overflow-hidden">
    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
      {title}
    </div>
    <div className="p-3">{children}</div>
  </section>
);

const JsonView = ({ data }: { data: Record<string, unknown> }) => (
  <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
    {JSON.stringify(data, null, 2)}
  </pre>
);

export default CddResponsesPage;
