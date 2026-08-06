import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getDepositStatusView, REAL_OUTCOME_STATUSES } from '../utils/depositStatusView';
import { formatAssetAmount } from '../utils/number-format';

interface ActionRow { seq: number; submittedAt: string | null }
interface DepositDetailData {
  depositNo: string; status: string; amount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  fromAddress: string | null; fromIban: string | null;
  actionSubmittedAt: string | null;
  actions: ActionRow[];
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const DepositDetail = () => {
  const { depositNo } = useParams();
  const navigate = useNavigate();
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

  if (err) return <div className="p-6 text-fx-dust">{err}</div>;
  if (!tx) return <div className="p-6 text-fx-dust">Loading…</div>;

  // 徽章与文案必须与列表页走同一条路径（连 submitted 一起传）——只传 status
  // 的话，已提交的 ACTION_PENDING 在这里显示 ACTION REQUIRED、在列表显示
  // PROCESSING，同一笔单两处说法不一；且该单被冻时这里的标签会变。
  const view = getDepositStatusView(tx.status, { submitted: !!tx.actionSubmittedAt });

  return (
    <div className="p-6 max-w-4xl">
      <button onClick={() => navigate('/deposit')} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
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

      {/* 单子已经有真实结果（SUCCESS/FAILED/RETURNING/RETURNED）时，不再展示这块——
          否则一笔已 SUCCESS 的单，只因子表里还留着一条从未清理的旧 action 行，
          就会一直对客户喊"请提供材料"。判据集合与 depositStatusView.ts 的
          REAL_OUTCOME_STATUSES 共用同一份，禁止在这里另写一份状态清单（两份
          必然漂移）。执法四态（FROZEN/SEIZING/SEIZED/MANUAL_CHECKING）绝不能
          出现在这个集合里，理由见该文件内注释。 */}
      {tx.actions.length > 0 && !REAL_OUTCOME_STATUSES.has(tx.status.toUpperCase()) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fx-sand mb-3">Outstanding verification</h2>
          <div className="space-y-2">
            {tx.actions.map((a) => (
              <div key={a.seq} className="flex items-center gap-3 rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fx-sand">Document request {a.seq}</div>
                  <div className="text-xs text-fx-dust">
                    {a.submittedAt ? 'Received · under review' : 'Awaiting your documents'}
                  </div>
                </div>
                {!a.submittedAt && (
                  <button
                    onClick={() => navigate(`/deposit/${tx.depositNo}/verification/${a.seq}`)}
                    className="rounded-xl border border-fx-brass/40 bg-fx-brass/10 px-4 py-2 text-sm font-semibold text-fx-brass hover:bg-fx-brass/20"
                  >
                    Provide documents
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Submitted" value={new Date(tx.createdAt).toLocaleString()} />
          <Field label="Reference" value={tx.referenceNo || '—'} mono />
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
          {tx.fromAddress && <Field label="From address" value={tx.fromAddress} mono wide />}
          {tx.fromIban && <Field label="From IBAN" value={tx.fromIban} mono wide />}
          {tx.txHash && <Field label="Transaction hash" value={tx.txHash} mono wide />}
        </dl>
      </section>
    </div>
  );
};

const Field = ({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) => (
  <div className={`rounded-xl bg-fx-charcoal/40 px-4 py-3 ${wide ? 'sm:col-span-2' : ''}`}>
    <dt className="text-xs text-fx-dust">{label}</dt>
    <dd className={`text-sm text-fx-sand mt-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
  </div>
);

export default DepositDetail;
