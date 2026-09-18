import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getDepositStatusView } from '../utils/depositStatusView';
import { formatAssetAmount } from '../utils/number-format';
import Field from '../components/detail/Field';
import { useGoBack } from '../components/detail/useGoBack';
import { MaterialRequestSection } from '../components/detail/MaterialRequestSection';
import { Timeline } from '../components/detail/Timeline';

interface DepositDetailData {
  depositNo: string; status: string; amount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  fromAddress: string | null; fromIban: string | null;
  toAddress: string | null; toIban: string | null;
  effectiveDate: string | null;
  timeline: { status: string; at: string }[];
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const DEPOSIT_TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'RETURNED', 'CLAWED_BACK']);

const DepositDetail = () => {
  const { depositNo } = useParams();
  const goBack = useGoBack('/deposit');
  const [tx, setTx] = useState<DepositDetailData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(
          `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}`,
        );
        if (!r.ok) throw new Error('not found');
        const d = await r.json();
        if (alive) setTx(d);
      } catch (error) {
        // customerFetch 自己会在会话过期时跳转登录页；这里只处理"单子真找不到"，
        // 别在跳转前的一瞬间闪出一条误导性的错误文案（与页面内其它拉取一致）。
        if (error instanceof CustomerSessionError) return;
        if (alive) setErr('This deposit is not available.');
      }
    })();
    return () => { alive = false; };
  }, [depositNo]);

  if (err) return <div className="max-w-4xl mx-auto text-fx-dust">{err}</div>;
  if (!tx) return <div className="max-w-4xl mx-auto text-fx-dust">Loading…</div>;

  // 业主定稿（2026-08-06）：徽章纯按 status 查表，不再关心是否已提交
  // 补料——与列表页走同一条单参路径（见 depositStatusView.ts 文件头）。
  const view = getDepositStatusView(tx.status);

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={goBack} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Deposits
      </button>

      <div className="flex items-start justify-between gap-4 pb-6 border-b border-fx-rule">
        <div>
          <div className="text-3xl font-bold text-fx-sand">
            {formatAssetAmount(tx.amount, tx.asset?.decimals)} <span className="text-lg text-fx-dust">{tx.asset?.currency}</span>
          </div>
          <div className="font-mono text-xs text-fx-dust mt-1">
            {tx.depositNo}{tx.asset?.network ? ` · ${tx.asset.network}` : ''}
          </div>
        </div>
        <span className="rounded-xl px-3 py-1 text-xs font-semibold border border-fx-rule text-fx-sand">
          {view.label}
        </span>
      </div>

      <MaterialRequestSection
        domain="DEPOSIT"
        orderRef={depositNo!}
        orderIsTerminal={DEPOSIT_TERMINAL_STATUSES.has(tx.status.toUpperCase())}
      />

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Amounts</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Submitted" value={new Date(tx.createdAt).toLocaleString()} />
          {/* effectiveDate 是 YYYY-MM-DD 纯业务日字符串，没有时刻；走 Date 解析
              会按本地时区折算出一个"9/15/2026, 4:00:00 AM"式的伪时刻，直接显示
              原串即可。 */}
          {tx.effectiveDate && <Field label="Value date" value={tx.effectiveDate} />}
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Route</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Reference" value={tx.referenceNo || '—'} mono />
          {tx.fromAddress && <Field label="From address" value={tx.fromAddress} mono wide />}
          {tx.fromIban && <Field label="From IBAN" value={tx.fromIban} mono wide />}
          {tx.toAddress && <Field label="Received at" value={tx.toAddress} mono wide />}
          {tx.toIban && <Field label="Received at (IBAN)" value={tx.toIban} mono wide />}
          {tx.txHash && <Field label="Transaction hash" value={tx.txHash} mono wide />}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Timeline</h2>
        <Timeline items={tx.timeline.map((t) => ({ label: getDepositStatusView(t.status).label, at: t.at }))} />
      </section>
    </div>
  );
};

export default DepositDetail;
