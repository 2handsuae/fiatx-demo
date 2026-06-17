import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

interface OutstandingDetail {
  id: string;
  outstandingNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerType: string;
  ownerNo: string | null;
  direction: string;
  assetCode: string | null;
  asset?: { code?: string | null; decimals?: number | null } | null;
  amount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  swapTransaction?: {
    swapNo: string | null; quoteNo: string | null; status: string;
    fromAmount: string; toAmount: string; exchangeRate: string;
    fromAsset?: { code?: string | null; decimals?: number | null } | null;
    toAsset?: { code?: string | null; decimals?: number | null } | null;
  } | null;
  settlementBatch?: { batchNo: string; settlementType: string | null; status: string } | null;
  settledByTransfer?: { internalTxNo: string; pathLabel: string | null; status: string } | null;
  closedByInternalFund?: { internalFundNo: string; status: string } | null;
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

const Link = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <span className="cursor-pointer font-mono text-[11px] text-adm-blue hover:underline" onClick={onClick}>{label}</span>
);

const SwapOutstandingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OutstandingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load outstanding detail.'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load outstanding detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  const back = () => navigate('/admin/funds/outstandings');

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

  const s = data.swapTransaction;
  const hasLinkage = data.settlementBatch || data.settledByTransfer || data.closedByInternalFund;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-2.5">
        <button onClick={back} className={adminButtonClass('listSecondary')}><ArrowLeft size={13} />Back</button>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-adm-t3">Swap Outstanding</span>
        <span className="font-mono text-[12px] font-semibold text-adm-amber">{data.outstandingNo || '—'}</span>
        <AdminBadge value={data.status} />
        <span className="ml-auto" />
        <button onClick={() => void fetchDetail()} className={adminIconButtonClass()} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex-1 overflow-auto">
        <Section title="Overview">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <Field label="Outstanding No" value={data.outstandingNo || '—'} />
            <Field label="Status" value={<AdminBadge value={data.status} />} />
            <Field label="Direction" value={<AdminBadge value={data.direction} />} />
            <Field label="Owner" value={`${data.ownerType} · ${data.ownerNo || '—'}`} />
            <Field label="Source" value={`${data.sourceType} · ${data.sourceNo || '—'}`} />
            <Field label="Asset" value={data.assetCode || data.asset?.code || '—'} />
            <Field label="Amount" value={formatAssetAmount(data.amount, data.asset?.decimals)} />
            <Field label="Created" value={new Date(data.createdAt).toLocaleString()} />
            <Field label="Updated" value={new Date(data.updatedAt).toLocaleString()} />
          </div>
        </Section>

        <Section title="Linked Swap">
          {s ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
              <Field label="Swap No" value={s.swapNo || '—'} />
              <Field label="Quote No" value={s.quoteNo || '—'} />
              <Field label="Swap Status" value={<AdminBadge value={s.status} />} />
              <Field label="Pair" value={`${s.fromAsset?.code || '-'} → ${s.toAsset?.code || '-'}`} />
              <Field label="Amounts" value={`${formatAssetAmount(s.fromAmount, s.fromAsset?.decimals)} → ${formatAssetAmount(s.toAmount, s.toAsset?.decimals)}`} />
              <Field label="Exchange Rate" value={formatRate8(s.exchangeRate)} />
            </div>
          ) : (<div className="font-mono text-[11px] italic text-adm-t3">No swap linked.</div>)}
        </Section>

        <Section title="Settlement Linkage">
          {hasLinkage ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
              <Field label="Settlement Batch" value={data.settlementBatch ? (
                <Link label={`${data.settlementBatch.batchNo} (${data.settlementBatch.settlementType || '—'} · ${data.settlementBatch.status})`} onClick={() => navigate('/admin/funds/settlements/' + data.settlementBatch!.batchNo)} />
              ) : '—'} />
              <Field label="Settled By Transfer" value={data.settledByTransfer ? (
                <Link label={`${data.settledByTransfer.internalTxNo} (${data.settledByTransfer.pathLabel || '—'} · ${data.settledByTransfer.status})`} onClick={() => navigate('/admin/funds/transfers/' + data.settledByTransfer!.internalTxNo)} />
              ) : '—'} />
              <Field label="Closed By Fund" value={data.closedByInternalFund ? (
                <Link label={`${data.closedByInternalFund.internalFundNo} (${data.closedByInternalFund.status})`} onClick={() => navigate('/admin/funds/internal-funds/' + data.closedByInternalFund!.internalFundNo)} />
              ) : '—'} />
            </div>
          ) : (<div className="font-mono text-[11px] italic text-adm-t3">Not yet settled.</div>)}
        </Section>
      </div>
    </div>
  );
};

export default SwapOutstandingDetail;
