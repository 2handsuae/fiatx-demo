import { type ReactNode, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

interface EddCaseItem {
  id: string;
  caseNo: string;
  customerId: string;
  subjectKind: string;
  subjectRefId: string;
  status: string;
  providerStatus?: string;
  customer?: {
    customerNo?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    customerType?: string;
  };
}

interface EddCaseDetail {
  id: string;
  caseNo: string;
  status: string;
  subjectKind: string;
  subjectRefId: string;
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
    onboardingStage?: string;
  };
  mockDetail?: Record<string, unknown>;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const EddCasesPage = () => {
  const [items, setItems] = useState<EddCaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<EddCaseDetail | null>(null);

  const token = localStorage.getItem('admin_token');

  const fetchCases = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/edd-cases?take=200`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        throw new Error('Failed to fetch EDD cases');
      }

      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      setMessage(getErrorMessage(e, 'Load failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const reviewMlro = async (id: string, decision: 'APPROVE' | 'REJECT' | 'NEED_INFO') => {
    const reason =
      decision === 'REJECT' || decision === 'NEED_INFO'
        ? window.prompt('Please input MLRO reason', '') || ''
        : undefined;

    if ((decision === 'REJECT' || decision === 'NEED_INFO') && !reason) {
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/edd-cases/${id}/mlro-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ decision, reason }),
        },
      );

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || 'MLRO review failed');
      }

      setMessage(`EDD MLRO ${decision} completed.`);
      fetchCases();
    } catch (e: unknown) {
      alert(getErrorMessage(e, 'MLRO review failed'));
    }
  };

  const reviewSenior = async (id: string, decision: 'APPROVE' | 'REJECT' | 'NEED_INFO') => {
    const reason =
      decision === 'REJECT' || decision === 'NEED_INFO'
        ? window.prompt('Please input senior reason', '') || ''
        : undefined;

    if ((decision === 'REJECT' || decision === 'NEED_INFO') && !reason) {
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/edd-cases/${id}/senior-review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ decision, reason }),
        },
      );

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || 'Senior review failed');
      }

      setMessage(`EDD Senior ${decision} completed.`);
      fetchCases();
    } catch (e: unknown) {
      alert(getErrorMessage(e, 'Senior review failed'));
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/edd-cases/${id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || 'Failed to load detail');
      }

      setDetail((await response.json()) as EddCaseDetail);
    } catch (e: unknown) {
      alert(getErrorMessage(e, 'Failed to load detail'));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - EDD Cases</h1>
          <p className="text-sm text-gray-500 mt-1">MLRO and Senior approvals for escalated risk cases.</p>
        </div>
        <button onClick={fetchCases} className="p-2 text-gray-500 hover:text-brand-primary" title="Refresh">
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
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Provider</th>
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
                    <span className="px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-800">
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{item.providerStatus || 'NOT_STARTED'}</td>
                  <td className="px-4 py-3 space-y-1">
                    <button
                      onClick={() => openDetail(item.id)}
                      className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      View Detail
                    </button>

                    {['SUBMITTED', 'NEED_INFO'].includes(item.status) && (
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => reviewMlro(item.id, 'APPROVE')}
                          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100"
                        >
                          MLRO Approve
                        </button>
                        <button
                          onClick={() => reviewMlro(item.id, 'NEED_INFO')}
                          className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-100"
                        >
                          Need Info
                        </button>
                        <button
                          onClick={() => reviewMlro(item.id, 'REJECT')}
                          className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {['MLRO_APPROVED', 'NEED_INFO'].includes(item.status) && (
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => reviewSenior(item.id, 'APPROVE')}
                          className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100"
                        >
                          Senior Approve
                        </button>
                        <button
                          onClick={() => reviewSenior(item.id, 'NEED_INFO')}
                          className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-100"
                        >
                          Need Info
                        </button>
                        <button
                          onClick={() => reviewSenior(item.id, 'REJECT')}
                          className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {!['SUBMITTED', 'NEED_INFO', 'MLRO_APPROVED'].includes(item.status) && (
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
                <h3 className="text-lg font-bold text-gray-900">EDD Detail - {detail.caseNo}</h3>
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
                  <JsonView
                    data={{
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

export default EddCasesPage;
