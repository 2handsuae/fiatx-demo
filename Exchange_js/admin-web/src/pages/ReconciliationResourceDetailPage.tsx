import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import {
  ActionCard,
  DetailCard,
  InfoField,
  JsonBlock,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  getReconciliationResourceConfig,
  type ReconciliationResourceType,
} from './wave8OpsConfig';

type WarningDetail = {
  id: string;
  warningNo: string;
  businessDate: string;
  assetCode?: string | null;
  warningType: string;
  poolRole: string;
  status: string;
  observedValue?: string | null;
  thresholdValue?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  run?: { id: string; runNo: string; status: string } | null;
  wallet?: { id: string; walletNo?: string | null; walletRole?: string | null } | null;
};

type RunDetail = {
  id: string;
  runNo: string;
  businessDate: string;
  status: string;
  breakCount: number;
  warningCount: number;
  traceId?: string | null;
  summary?: Record<string, unknown> | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  liabilities?: unknown[];
  pools?: unknown[];
  warnings?: unknown[];
  breaks?: unknown[];
  statements?: unknown[];
};

type FiatStatementImportDetail = {
  id: string;
  importNo: string;
  businessDate: string;
  status: string;
  fileName?: string | null;
  closingBalance?: string | null;
  details?: Record<string, unknown> | null;
  asset?: { code?: string | null; network?: string | null } | null;
  wallet?: { walletNo?: string | null; bankName?: string | null } | null;
  entries?: Array<{
    id: string;
    lineNo: number;
    direction?: string | null;
    amount?: string | null;
    balanceAfter?: string | null;
    referenceNo?: string | null;
    valueDate?: string | null;
    narrative?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

const ReconciliationResourceDetailPage = ({
  resourceType,
}: {
  resourceType: ReconciliationResourceType;
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const config = useMemo(
    () => getReconciliationResourceConfig(resourceType),
    [resourceType],
  );
  const [detail, setDetail] = useState<
    WarningDetail | RunDetail | FiatStatementImportDetail | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [warningStatusForm, setWarningStatusForm] = useState({
    status: 'ACKNOWLEDGED',
    note: '',
  });

  const canUpdateWarning = hasAnyPermission([
    PERMISSIONS.SAFEGUARDING_WARNINGS_WRITE,
  ]);
  const canExportRun = hasAnyPermission([PERMISSIONS.SAFEGUARDING_RUNS_EXPORT]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Detail id is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}${config.endpoint}/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to load ${config.detailTitle}.`));
      }
      const result = (await response.json()) as
        | WarningDetail
        | RunDetail
        | FiatStatementImportDetail;
      setDetail(result);
      if (resourceType === 'warnings') {
        const next = result as WarningDetail;
        setWarningStatusForm({
          status: next.status === 'OPEN' ? 'ACKNOWLEDGED' : next.status,
          note: '',
        });
      }
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to load ${config.detailTitle}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, resourceType]);

  const submitWarningStatus = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-warnings/${id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(warningStatusForm),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to update safeguarding warning.'));
      }
      setMessage('Safeguarding warning updated successfully.');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to update safeguarding warning.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const exportRunEvidence = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/safeguarding-runs/${id}/export-evidence-package`,
        { method: 'POST' },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to export evidence package.'));
      }
      const result = (await response.json()) as { packageNo?: string; id?: string; status?: string };
      setMessage(
        `Evidence export created${result.packageNo ? `: ${result.packageNo}` : ''}.`,
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to export evidence package.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading detail...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error || 'Detail not found.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(config.listPath)}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{config.detailTitle}</h1>
            <p className="mt-1 text-sm text-gray-500">{config.description}</p>
          </div>
        </div>
        <button
          onClick={() => void fetchDetail()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {resourceType === 'warnings' ? (
        <>
          {(() => {
            const item = detail as WarningDetail;
            return (
              <>
                <DetailCard title="Warning">
                  <InfoField label="Warning No" value={item.warningNo} mono />
                  <InfoField label="Status" value={<StatusBadge value={item.status} />} />
                  <InfoField label="Business Date" value={item.businessDate} />
                  <InfoField label="Asset Code" value={item.assetCode} />
                  <InfoField label="Warning Type" value={item.warningType} />
                  <InfoField label="Pool Role" value={item.poolRole} />
                  <InfoField label="Wallet" value={item.wallet?.walletNo || '-'} />
                  <InfoField label="Observed Value" value={item.observedValue} />
                  <InfoField label="Threshold Value" value={item.thresholdValue} />
                  <InfoField label="Run" value={item.run?.runNo || '-'} />
                  <InfoField label="Created At" value={formatDateTime(item.createdAt)} />
                  <InfoField label="Updated At" value={formatDateTime(item.updatedAt)} />
                </DetailCard>
                <DetailCard title="Details" columns={1}>
                  <JsonBlock title="Warning Details" value={item.details || {}} />
                </DetailCard>
                {canUpdateWarning && item.status === 'OPEN' ? (
                  <ActionCard
                    title="Update Warning Status"
                    description="Warnings stay operational; use this when acknowledging or resolving placement issues."
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <select
                        value={warningStatusForm.status}
                        onChange={(event) =>
                          setWarningStatusForm((prev) => ({
                            ...prev,
                            status: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                        <option value="RESOLVED">RESOLVED</option>
                        <option value="ACCEPTED">ACCEPTED</option>
                      </select>
                      <input
                        value={warningStatusForm.note}
                        onChange={(event) =>
                          setWarningStatusForm((prev) => ({
                            ...prev,
                            note: event.target.value,
                          }))
                        }
                        placeholder="Note"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void submitWarningStatus()}
                        disabled={submitting}
                        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
                      >
                        {submitting ? 'Updating...' : 'Update Warning'}
                      </button>
                    </div>
                  </ActionCard>
                ) : null}
              </>
            );
          })()}
        </>
      ) : resourceType === 'runs' ? (
        <>
          {(() => {
            const item = detail as RunDetail;
            return (
              <>
                <DetailCard title="Run">
                  <InfoField label="Run No" value={item.runNo} mono />
                  <InfoField label="Status" value={<StatusBadge value={item.status} />} />
                  <InfoField label="Business Date" value={item.businessDate} />
                  <InfoField label="Break Count" value={String(item.breakCount)} />
                  <InfoField label="Warning Count" value={String(item.warningCount)} />
                  <InfoField label="Trace Id" value={item.traceId} mono />
                  <InfoField label="Started At" value={formatDateTime(item.startedAt)} />
                  <InfoField label="Finished At" value={formatDateTime(item.finishedAt)} />
                </DetailCard>
                <DetailCard title="Summary" columns={1}>
                  <JsonBlock title="Run Summary" value={item.summary || {}} />
                </DetailCard>
                <DetailCard title="Snapshots & Linked Records">
                  <InfoField label="Liabilities" value={String(item.liabilities?.length || 0)} />
                  <InfoField label="Pools" value={String(item.pools?.length || 0)} />
                  <InfoField label="Warnings" value={String(item.warnings?.length || 0)} />
                  <InfoField label="Breaks" value={String(item.breaks?.length || 0)} />
                  <InfoField label="Statements" value={String(item.statements?.length || 0)} />
                </DetailCard>
                {canExportRun ? (
                  <ActionCard
                    title="Export Evidence Package"
                    description="Generate an evidence package for this safeguarding run using the existing backend export flow."
                  >
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void exportRunEvidence()}
                        disabled={submitting}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
                      >
                        {submitting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                        {submitting ? 'Exporting...' : 'Export Evidence Package'}
                      </button>
                    </div>
                  </ActionCard>
                ) : null}
              </>
            );
          })()}
        </>
      ) : (
        <>
          {(() => {
            const item = detail as FiatStatementImportDetail;
            return (
              <>
                <DetailCard title="Fiat Statement Import">
                  <InfoField label="Import No" value={item.importNo} mono />
                  <InfoField label="Status" value={<StatusBadge value={item.status} />} />
                  <InfoField label="Business Date" value={item.businessDate} />
                  <InfoField
                    label="Asset"
                    value={
                      item.asset
                        ? `${item.asset.code}${item.asset.network ? ` · ${item.asset.network}` : ''}`
                        : '-'
                    }
                  />
                  <InfoField label="Wallet" value={item.wallet?.walletNo || '-'} />
                  <InfoField label="Bank" value={item.wallet?.bankName || '-'} />
                  <InfoField label="File Name" value={item.fileName} />
                  <InfoField label="Closing Balance" value={item.closingBalance} />
                  <InfoField label="Created At" value={formatDateTime(item.createdAt)} />
                  <InfoField label="Updated At" value={formatDateTime(item.updatedAt)} />
                </DetailCard>
                <DetailCard title="Details" columns={1}>
                  <JsonBlock title="Import Details" value={item.details || {}} />
                </DetailCard>
                <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
                  <div className="border-b border-admin-border px-4 py-3 text-sm font-semibold text-gray-900">
                    Statement Entries
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-admin-border bg-admin-content-bg">
                        <tr>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Line</th>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Direction</th>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Amount</th>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Balance After</th>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Reference</th>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Value Date</th>
                          <th className="px-4 py-3 text-xs uppercase text-gray-500">Narrative</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-admin-border">
                        {(item.entries || []).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                              No statement entries found.
                            </td>
                          </tr>
                        ) : (
                          (item.entries || []).map((entry) => (
                            <tr key={entry.id}>
                              <td className="px-4 py-3 text-gray-700">{entry.lineNo}</td>
                              <td className="px-4 py-3 text-gray-700">{entry.direction || '-'}</td>
                              <td className="px-4 py-3 text-gray-700">{entry.amount || '-'}</td>
                              <td className="px-4 py-3 text-gray-700">{entry.balanceAfter || '-'}</td>
                              <td className="px-4 py-3 text-gray-700">{entry.referenceNo || '-'}</td>
                              <td className="px-4 py-3 text-gray-700">{formatDateTime(entry.valueDate)}</td>
                              <td className="px-4 py-3 text-gray-700">{entry.narrative || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default ReconciliationResourceDetailPage;
