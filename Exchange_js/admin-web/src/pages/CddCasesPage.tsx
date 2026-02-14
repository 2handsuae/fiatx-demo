import { type ReactNode, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface CddCaseItem {
  id: string;
  caseNo: string;
  customerId: string;
  subjectKind: string;
  subjectRefId: string;
  status: string;
  customer?: {
    customerNo?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    customerType?: string;
    companyName?: string | null;
  };
}

interface CddCaseDetail {
  id: string;
  caseNo: string;
  status: string;
  subjectKind: string;
  subjectRefId: string;
  riskScore?: number | null;
  riskLevel?: string | null;
  requiresEdd?: boolean;
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
    cddStatus?: string;
    eddStatus?: string;
    complianceStatus?: string;
  };
  mockDetail?: Record<string, unknown>;
  latestReport?: {
    rawPayload?: Record<string, unknown>;
    normalizedPayload?: Record<string, unknown>;
  };
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const CddCasesPage = () => {
  const [items, setItems] = useState<CddCaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<CddCaseDetail | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cdd-cases?take=200`,
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
    fetchCases();
  }, []);

  const reviewCase = async (
    id: string,
    decision: 'APPROVE' | 'REJECT' | 'UPGRADE_EDD',
    requiresEdd?: boolean,
  ) => {
    const reason = decision === 'REJECT' ? window.prompt('Please input reason', '') || '' : undefined;

    if (decision === 'REJECT' && !reason) {
      return;
    }

    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cdd-cases/${id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            decision,
            reason,
            requiresEdd,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Review failed'));
      }

      setMessage(`CDD ${decision} completed.`);
      fetchCases();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) {
        return;
      }
      alert(getErrorMessage(e, 'Review failed'));
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cdd-cases/${id}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load data.'));
      }

      setDetail((await response.json()) as CddCaseDetail);
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
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - CDD Cases</h1>
          <p className="text-sm text-gray-500 mt-1">Review customer/company/UBO CDD cases.</p>
        </div>
        <button
          onClick={fetchCases}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
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
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Case</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Customer</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No cases found
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{item.caseNo}</div>
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
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-y-1">
                    <button
                      onClick={() => openDetail(item.id)}
                      className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      View Detail
                    </button>
                    {['SUBMITTED'].includes(item.status) ? (
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => reviewCase(item.id, 'APPROVE', false)}
                          className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => reviewCase(item.id, 'UPGRADE_EDD', true)}
                          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                        >
                          Upgrade EDD
                        </button>
                        <button
                          onClick={() => reviewCase(item.id, 'REJECT')}
                          className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">No action</span>
                    )}
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
                <h3 className="text-lg font-bold text-gray-900">CDD Detail - {detail.caseNo}</h3>
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
                <InfoBlock title="Case">
                  <JsonView data={{
                    status: detail.status,
                    subjectKind: detail.subjectKind,
                    subjectRefId: detail.subjectRefId,
                    riskScore: detail.riskScore,
                    riskLevel: detail.riskLevel,
                    requiresEdd: detail.requiresEdd,
                    pepHit: detail.pepHit,
                    sanctionsHit: detail.sanctionsHit,
                  }} />
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

export default CddCasesPage;
