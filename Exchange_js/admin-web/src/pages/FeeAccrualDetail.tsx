import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';

interface FeeAccrualDetailData {
  id: string;
  feeAccrualNo: string | null;
  sourceType: string;
  sourceId: string;
  sourceNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  feeKind: 'SERVICE_FEE' | 'SPREAD';
  category: 'SWAP_FEE' | 'WITHDRAW_FEE';
  assetCode: string | null;
  amount: string;
  status: 'ACCRUED' | 'LOCKED' | 'SETTLED';
  lockedAt: string | null;
  closedAt: string | null;
  closedByInternalFundId: string | null;
  createdAt: string;
  updatedAt: string;
  originTraceId: string | null;
  settlementBatch: { id: string; batchNo: string | null } | null;
  settledByTransfer: { id: string; internalTxNo: string | null } | null;
  closedByInternalFund: { id: string; internalFundNo: string | null } | null;
  siblings: Array<{
    id: string;
    feeAccrualNo: string | null;
    feeKind: 'SERVICE_FEE' | 'SPREAD';
    amount: string;
    assetCode: string | null;
    status: 'ACCRUED' | 'LOCKED' | 'SETTLED';
    createdAt: string;
  }>;
}

const Field = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">{label}</span>
    <span className="font-mono text-[11px] text-adm-t1 break-all">{value}</span>
  </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="px-6 py-5 border-b border-adm-border">
    <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">{title}</h3>
    {children}
  </div>
);

const LinkButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <span className="cursor-pointer font-mono text-[11px] text-adm-blue hover:underline" onClick={onClick}>{label}</span>
);

const fmtDate = (v: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const FeeAccrualDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FeeAccrualDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/fee-accruals/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load fee accrual.'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load fee accrual.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  const back = () => navigate('/admin/funds/fee-accruals');

  const handleCopy = async () => {
    if (!data?.originTraceId) return;
    await navigator.clipboard.writeText(data.originTraceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading && !data) return <div className="flex min-h-[400px] items-center justify-center font-mono text-[11px] text-adm-t3">Loading…</div>;
  if (error && !data) return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2.5">
        <button onClick={back} className={adminButtonClass('listSecondary')}><ArrowLeft size={13} />Back</button>
        <button onClick={() => void fetchDetail()} className={adminIconButtonClass()}><RefreshCw size={14} /></button>
      </div>
      <div className="m-5 border border-adm-red/20 bg-adm-red/6 px-4 py-3 font-mono text-[11px] text-adm-red">{error}</div>
    </div>
  );
  if (!data) return null;

  const title = data.feeAccrualNo || data.id;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-2.5">
        <button onClick={back} className={adminButtonClass('listSecondary')}><ArrowLeft size={13} />Back</button>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-adm-t3">Accrual</span>
        <span className="font-mono text-[12px] font-semibold text-adm-amber">{title}</span>
        <AdminBadge value={data.status} />
        <span className="ml-auto" />
        <button onClick={() => void fetchDetail()} className={adminIconButtonClass()} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex-1 overflow-auto">
        <Section title="Identity">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <Field label="Accrual No" value={data.feeAccrualNo || '—'} />
            <Field label="Category" value={<AdminBadge value={data.category} />} />
            <Field label="Fee Kind" value={<AdminBadge value={data.feeKind} />} />
            <Field label="Amount" value={`${formatAssetAmount(data.amount, undefined)} ${data.assetCode || ''}`.trim() || '—'} />
            <Field label="Owner" value={`${data.ownerType} · ${data.ownerNo || '—'}`} />
            <Field label="Source" value={`${data.sourceType} · ${data.sourceNo || '—'}`} />
          </div>
        </Section>

        <Section title="Settlement Linkage">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <Field label="Status" value={<AdminBadge value={data.status} />} />
            <Field label="Locked At" value={fmtDate(data.lockedAt)} />
            <Field label="Closed At" value={fmtDate(data.closedAt)} />
            <Field
              label="Settlement Batch"
              value={data.settlementBatch?.batchNo ? (
                <LinkButton label={data.settlementBatch.batchNo} onClick={() => navigate('/admin/funds/settlements/' + data.settlementBatch!.batchNo)} />
              ) : '—'}
            />
            <Field
              label="Settled By Transfer"
              value={data.settledByTransfer?.internalTxNo ? (
                <LinkButton label={data.settledByTransfer.internalTxNo} onClick={() => navigate('/admin/funds/transfers/' + data.settledByTransfer!.internalTxNo)} />
              ) : '—'}
            />
            <Field
              label="Closed By Fund"
              value={data.closedByInternalFund?.internalFundNo ? (
                <LinkButton label={data.closedByInternalFund.internalFundNo} onClick={() => navigate('/admin/funds/internal-funds/' + data.closedByInternalFund!.internalFundNo)} />
              ) : '—'}
            />
          </div>
        </Section>

        <Section title="Traceability">
          <div className="flex items-start gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">Origin Trace ID</span>
              {data.originTraceId ? (
                <code className="font-mono text-[11px] text-adm-t1 break-all">{data.originTraceId}</code>
              ) : (
                <span className="font-mono text-[11px] text-adm-t3">—</span>
              )}
            </div>
            {data.originTraceId && (
              <button
                onClick={() => void handleCopy()}
                className={adminIconButtonClass()}
                title={copied ? 'Copied' : 'Copy trace id'}
              >
                <Copy size={14} />
              </button>
            )}
          </div>
        </Section>

        <Section title={`Sibling Accruals (${data.siblings.length})`}>
          {data.siblings.length === 0 ? (
            <div className="font-mono text-[11px] text-adm-t3">No other accruals from this source.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-adm-border">
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">Accrual No</th>
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">Fee Kind</th>
                    <th className="px-3 py-2 text-right text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">Amount</th>
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">Status</th>
                    <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.siblings.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/admin/funds/fee-accruals/${s.id}`)}
                      className="cursor-pointer border-b border-adm-border hover:bg-adm-panel"
                    >
                      <td className="px-3 py-2 text-adm-t1">{s.feeAccrualNo || '—'}</td>
                      <td className="px-3 py-2"><AdminBadge value={s.feeKind} /></td>
                      <td className="px-3 py-2 text-right text-adm-t1">{`${formatAssetAmount(s.amount, undefined)} ${s.assetCode || ''}`.trim() || '—'}</td>
                      <td className="px-3 py-2"><AdminBadge value={s.status} /></td>
                      <td className="px-3 py-2 text-adm-t2">{fmtDate(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};

export default FeeAccrualDetail;
