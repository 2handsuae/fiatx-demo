import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getWithdrawStatusView } from '../utils/withdrawStatusView';
import { formatAssetAmount } from '../utils/number-format';

interface ActionRow { seq: number; submittedAt: string | null }
interface WithdrawDetailData {
  withdrawNo: string; status: string; amount: string;
  feeAmount: string; netAmount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  toAddress: string | null; toIban: string | null;
  actions: ActionRow[];
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const WithdrawDetail = () => {
  const { withdrawNo } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // 返回「从哪来回哪去」——镜像 DepositDetail 同一条理由：这个页面可以从提现
  // 历史列表、也可能将来从别处深链进来，写死 navigate('/withdraw') 会把人送到
  // 一个他没来过的地方。只有本次会话第一个历史条目（location.key==='default'，
  // 直接输 URL/刷新/外部链接进来）时才兜底回列表。
  const goBack = () =>
    location.key === 'default' ? navigate('/withdraw') : navigate(-1);
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

      {/* 镜像 DepositDetail 2026-08-06 定稿：区块显示条件只看"ACTION_PENDING 且有
          action 行"，交没交齐不影响区块存在与否；每张卡自己按 submittedAt 决定
          按钮是否可点（见下）。 */}
      {tx.status.toUpperCase() === 'ACTION_PENDING' && tx.actions.length > 0 && (
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
                {/* 按钮恒渲染，只按这一条自己的 submittedAt 禁用，不整条从 DOM 里消失。 */}
                <button
                  onClick={() => navigate(`/withdraw/${tx.withdrawNo}/verification/${a.seq}`)}
                  disabled={!!a.submittedAt}
                  className="rounded-xl border border-fx-brass/40 bg-fx-brass/10 px-4 py-2 text-sm font-semibold text-fx-brass hover:bg-fx-brass/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fx-brass/10"
                >
                  Provide documents
                </button>
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
          <Field label="Fee" value={`${formatAssetAmount(tx.feeAmount, tx.asset?.decimals)} ${tx.asset?.currency ?? ''}`.trim()} />
          <Field label="Net amount" value={`${formatAssetAmount(tx.netAmount, tx.asset?.decimals)} ${tx.asset?.currency ?? ''}`.trim()} />
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
          {tx.toAddress && <Field label="Destination address" value={tx.toAddress} mono wide />}
          {tx.toIban && <Field label="Destination IBAN" value={tx.toIban} mono wide />}
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

export default WithdrawDetail;
