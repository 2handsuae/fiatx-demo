import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface EddResponseItem {
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
  };
}

interface EddResponseDetail {
  id: string;
  responseNo: string;
  responseType?: string | null;
  status: string;
  subjectKind: string;
  subjectRefId: string;
  workflow?: string | null;
  periodicReviewCycleId?: string | null;
  sourceOfFunds?: string | null;
  sourceOfWealth?: string | null;
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

const EddResponsesPage = () => {
  const [items, setItems] = useState<EddResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<EddResponseDetail | null>(null);
  const [workflowFilter, setWorkflowFilter] = useState<'ALL' | 'ONBOARDING' | 'PERIODIC_REVIEW'>(
    'ALL',
  );
  const hasFilters = useMemo(() => workflowFilter !== 'ALL', [workflowFilter]);

  const fetchResponses = async (workflowOverride?: 'ALL' | 'ONBOARDING' | 'PERIODIC_REVIEW') => {
    setLoading(true);
    setMessage('');
    try {
      const nextWorkflowFilter = workflowOverride ?? workflowFilter;
      const params = new URLSearchParams();
      params.set('take', '200');
      if (nextWorkflowFilter !== 'ALL') {
        params.set('workflow', nextWorkflowFilter);
      }
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/edd-responses?${params.toString()}`,
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
    void fetchResponses('ALL');
  }, []);

  const openResponseDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/edd-responses/${id}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load data.'));
      }

      setDetail((await response.json()) as EddResponseDetail);
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
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - EDD Responses</h1>
          <p className="text-sm text-gray-500 mt-1">MLRO review queue for escalated risk responses.</p>
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
            onClick={() => void fetchResponses()}
            className={adminButtonClass('listPrimary')}
          >
            Search
          </button>
          <button
            onClick={() => {
              setWorkflowFilter('ALL');
              void fetchResponses('ALL');
            }}
            disabled={!hasFilters}
            className={adminButtonClass('listSecondary')}
          >
            Reset
          </button>
          <button
            onClick={() => void fetchResponses()}
            className={adminIconButtonClass()}
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
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
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
                    <button
                      onClick={() => openResponseDetail(item.id)}
                      className={adminButtonClass('rowKeyLink')}
                    >
                      {item.responseNo}
                    </button>
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
                    <span className="px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-800">
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openResponseDetail(item.id)}
                      className={adminButtonClass('rowLink')}
                    >
                      View
                    </button>
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
                  EDD Response Detail - {detail.responseNo}
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
                      sourceOfFunds: detail.sourceOfFunds,
                      sourceOfWealth: detail.sourceOfWealth,
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

export default EddResponsesPage;
