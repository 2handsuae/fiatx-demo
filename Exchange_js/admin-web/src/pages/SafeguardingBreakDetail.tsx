import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
} from '../components/compliance/DetailPageComponents';

type SafeguardingBreakDetailData = {
  id: string;
  breakNo: string;
  businessDate: string;
  status: string;
  reasonCode: string;
  withdrawNo?: string | null;
  payoutNo?: string | null;
  assetCode?: string | null;
  expectedNetDelta: string;
  observedNetDelta: string;
  deltaAmount: string;
  detectedAt: string;
  resolvedAt?: string | null;
  reopenedAt?: string | null;
  details?: Record<string, unknown> | null;
  linkedAlert?: { id: string; alertNo: string; status: string; stage?: string | null } | null;
  linkedCase?: { id: string; incidentNo: string; status: string; severity?: string | null } | null;
  withdraw?: { id: string; withdrawNo: string; status: string; netAmount: string; completedAt?: string | null } | null;
  payout?: { id: string; payoutNo: string; status: string; amount: string; completedAt?: string | null } | null;
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-rose-100 text-rose-800',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED_DIFFERENCE: 'bg-blue-100 text-blue-800',
};

const Field = ({ label, value }: { label: string; value: unknown }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
    <span className="break-all text-sm text-gray-900">{value ? String(value) : '-'}</span>
  </div>
);

const SafeguardingBreakDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [data, setData] = useState<SafeguardingBreakDetailData | null>(null);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-breaks/${id}`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load safeguarding break detail.'),
        );
      }
      const result = (await response.json()) as SafeguardingBreakDetailData;
      setData(result);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to load safeguarding break detail.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  const updateStatus = async (status: string) => {
    if (!id) return;
    const note = window.prompt(`Optional note for ${status}`, '') || undefined;
    setUpdating(status);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-breaks/${id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status, note }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to update safeguarding break status.'),
        );
      }
      const result = (await response.json()) as SafeguardingBreakDetailData;
      setData(result);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error
          ? e.message
          : 'Failed to update safeguarding break status.',
      );
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-gray-500">
        <RefreshCw size={26} className="animate-spin text-brand-primary" />
        Loading safeguarding break detail...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/dashboard/reconciliation/safeguarding-breaks')}
          className={adminButtonClass('detailUtility')}
        >
          Back to Safeguarding Breaks
        </button>
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
          Safeguarding break not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <DetailPageHeader
        title="Safeguarding Break"
        subtitle={`${data.breakNo} · ${data.businessDate} · ${data.reasonCode}`}
        onBack={() => navigate('/dashboard/reconciliation/safeguarding-breaks')}
        onRefresh={() => void fetchDetail()}
        backLabel="Back to Safeguarding Breaks"
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
            STATUS_COLORS[data.status] || 'bg-gray-100 text-gray-700'
          }`}
        >
          {data.status}
        </span>
      </DetailPageHeader>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ActionSection
        title="Workflow Actions"
        description="Break resolution actions are separated from the snapshot and linked object context."
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void updateStatus('UNDER_REVIEW')}
            disabled={updating !== null}
            className={adminButtonClass('workflowSecondary')}
          >
            {updating === 'UNDER_REVIEW' ? 'Updating...' : 'Mark Under Review'}
          </button>
          <button
            onClick={() => void updateStatus('RESOLVED')}
            disabled={updating !== null}
            className={adminButtonClass('workflowPrimary')}
          >
            {updating === 'RESOLVED' ? 'Updating...' : 'Resolve'}
          </button>
          <button
            onClick={() => void updateStatus('ACCEPTED_DIFFERENCE')}
            disabled={updating !== null}
            className={adminButtonClass('workflowSecondary')}
          >
            {updating === 'ACCEPTED_DIFFERENCE' ? 'Updating...' : 'Accept Difference'}
          </button>
        </div>
      </ActionSection>

      <DetailCard title="Break Snapshot" columns={1}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Business Date" value={data.businessDate} />
          <Field label="Reason Code" value={data.reasonCode} />
          <Field label="Asset" value={data.assetCode} />
          <Field label="Withdraw No" value={data.withdrawNo} />
          <Field label="Payout No" value={data.payoutNo} />
          <Field label="Detected At" value={new Date(data.detectedAt).toLocaleString()} />
          <Field label="Resolved At" value={data.resolvedAt ? new Date(data.resolvedAt).toLocaleString() : '-'} />
          <Field label="Reopened At" value={data.reopenedAt ? new Date(data.reopenedAt).toLocaleString() : '-'} />
          <Field label="Expected Net Delta" value={data.expectedNetDelta} />
          <Field label="Observed Net Delta" value={data.observedNetDelta} />
          <Field label="Delta Amount" value={data.deltaAmount} />
        </div>
      </DetailCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DetailCard title="Linked Objects" columns={1}>
          <div className="space-y-4">
            <div className="rounded-lg border border-admin-border p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Alert</div>
              <div className="mt-2 text-sm text-gray-900">
                {data.linkedAlert?.alertNo || '-'}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {data.linkedAlert?.status || '-'} / {data.linkedAlert?.stage || '-'}
              </div>
              {data.linkedAlert?.id && (
                <button
                  onClick={() => navigate(`/dashboard/compliance/alerts/${data.linkedAlert?.id}`)}
                  className="mt-3 text-sm font-medium text-brand-primary hover:underline"
                >
                  Open Alert
                </button>
              )}
            </div>
            <div className="rounded-lg border border-admin-border p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Case</div>
              <div className="mt-2 text-sm text-gray-900">
                {data.linkedCase?.incidentNo || '-'}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {data.linkedCase?.status || '-'} / {data.linkedCase?.severity || '-'}
              </div>
              {data.linkedCase?.id && (
                <button
                  onClick={() => navigate(`/dashboard/compliance/cases/${data.linkedCase?.id}`)}
                  className="mt-3 text-sm font-medium text-brand-primary hover:underline"
                >
                  Open Case
                </button>
              )}
            </div>
          </div>
        </DetailCard>

        <DetailCard title="Workflow Snapshot" columns={1}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field label="Withdraw Status" value={data.withdraw?.status} />
            <Field label="Withdraw Net Amount" value={data.withdraw?.netAmount} />
            <Field
              label="Withdraw Completed At"
              value={
                data.withdraw?.completedAt
                  ? new Date(data.withdraw.completedAt).toLocaleString()
                  : '-'
              }
            />
            <Field label="Payout Status" value={data.payout?.status} />
            <Field label="Payout Amount" value={data.payout?.amount} />
            <Field
              label="Payout Completed At"
              value={
                data.payout?.completedAt
                  ? new Date(data.payout.completedAt).toLocaleString()
                  : '-'
              }
            />
          </div>
        </DetailCard>
      </div>

      <DetailCard title="Break Details JSON" columns={1}>
        <pre className="max-h-[420px] overflow-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
          {JSON.stringify(data.details || {}, null, 2)}
        </pre>
      </DetailCard>
    </div>
  );
};

export default SafeguardingBreakDetail;
