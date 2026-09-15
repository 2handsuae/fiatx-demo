import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getWithdrawStatusView } from '../utils/withdrawStatusView';
import { formatAssetAmount } from '../utils/number-format';
import Field from '../components/detail/Field';
import { useGoBack } from '../components/detail/useGoBack';
import { MaterialRequestSection } from '../components/detail/MaterialRequestSection';
import { Timeline } from '../components/detail/Timeline';

interface WithdrawDetailData {
  withdrawNo: string; status: string; amount: string;
  feeAmount: string; netAmount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  toAddress: string | null; toIban: string | null;
  addressLabel: string | null;
  quote: { quoteNo: string; feeLevelCode: string | null; tierName: string } | null;
  timeline: { status: string; at: string }[];
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const WITHDRAW_TERMINAL_STATUSES = new Set(['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED']);

const WithdrawDetail = () => {
  const { withdrawNo } = useParams();
  const goBack = useGoBack('/withdraw');
  const [tx, setTx] = useState<WithdrawDetailData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/withdraw-transactions/my/${withdrawNo}`,
        );
        if (!r.ok) throw new Error('not found');
        const d = await r.json();
        if (alive) setTx(d);
      } catch (error) {
        // customerFetch 自己会在会话过期时跳转登录页；这里只处理"单子真找不到"，
        // 别在跳转前的一瞬间闪出一条误导性的错误文案（与页面内其它拉取一致）。
        if (error instanceof CustomerSessionError) return;
        if (alive) setErr('This withdrawal is not available.');
      }
    })();
    return () => { alive = false; };
  }, [withdrawNo]);

  if (err) return <div className="max-w-4xl mx-auto text-fx-dust">{err}</div>;
  if (!tx) return <div className="max-w-4xl mx-auto text-fx-dust">Loading…</div>;

  // 徽章纯按 status 查表（单参纯查表），不引入任何 submitted 短路——同 DepositDetail。
  const view = getWithdrawStatusView(tx.status);

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={goBack} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Withdrawals
      </button>

      <div className="flex items-start justify-between gap-4 pb-6 border-b border-fx-rule">
        <div>
          <div className="text-3xl font-bold text-fx-sand">
            {formatAssetAmount(tx.amount, tx.asset?.decimals)} <span className="text-lg text-fx-dust">{tx.asset?.currency}</span>
          </div>
          <div className="font-mono text-xs text-fx-dust mt-1">
            {tx.withdrawNo}{tx.asset?.network ? ` · ${tx.asset.network}` : ''}
          </div>
        </div>
        <span className="rounded-xl px-3 py-1 text-xs font-semibold border border-fx-rule text-fx-sand">
          {view.label}
        </span>
      </div>

      <MaterialRequestSection
        domain="WITHDRAW"
        orderRef={withdrawNo!}
        orderIsTerminal={WITHDRAW_TERMINAL_STATUSES.has(tx.status.toUpperCase())}
      />

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Amounts</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Submitted" value={new Date(tx.createdAt).toLocaleString()} />
          <Field label="Fee" value={`${formatAssetAmount(tx.feeAmount, tx.asset?.decimals)} ${tx.asset?.currency ?? ''}`.trim()} />
          <Field label="Net amount" value={`${formatAssetAmount(tx.netAmount, tx.asset?.decimals)} ${tx.asset?.currency ?? ''}`.trim()} />
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Route</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tx.toAddress && <Field label="Destination address" value={tx.toAddress} mono wide />}
          {tx.toIban && <Field label="Destination IBAN" value={tx.toIban} mono wide />}
          {tx.addressLabel && <Field label="Address label" value={tx.addressLabel} />}
          <Field label="Reference" value={tx.referenceNo || '—'} mono />
          {tx.txHash && <Field label="Transaction hash" value={tx.txHash} mono wide />}
        </dl>
      </section>

      {tx.quote && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fx-sand mb-3">Pricing</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Quote No" value={tx.quote.quoteNo} mono />
            <Field
              label="Fee level"
              value={tx.quote.feeLevelCode ? `${tx.quote.feeLevelCode} · ${tx.quote.tierName}` : tx.quote.tierName}
            />
          </dl>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Timeline</h2>
        <Timeline items={tx.timeline.map((t) => ({ label: getWithdrawStatusView(t.status).label, at: t.at }))} />
      </section>
    </div>
  );
};

export default WithdrawDetail;
