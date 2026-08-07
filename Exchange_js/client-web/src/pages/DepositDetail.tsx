import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getDepositStatusView } from '../utils/depositStatusView';
import { formatAssetAmount } from '../utils/number-format';

interface ActionRow { seq: number; submittedAt: string | null }
interface DepositDetailData {
  depositNo: string; status: string; amount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  fromAddress: string | null; fromIban: string | null;
  actions: ActionRow[];
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const DepositDetail = () => {
  const { depositNo } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * 返回「从哪来回哪去」。
   *
   * 不能写死 navigate('/deposit')——这个页面可以从充值列表、也可以从认证页
   * （提交后）到达，将来还可能从别处深链进来，写死会把人送到一个他没来过的地方。
   *
   * react-router 在本次会话的**第一个**历史条目上会把 location.key 置为
   * 'default'（直接输 URL、刷新、外部链接进来都是这种）——此时栈里没有站内
   * 上一页，navigate(-1) 会把人送出本站，所以退回列表兜底。
   */
  const goBack = () =>
    location.key === 'default' ? navigate('/deposit') : navigate(-1);
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

      {/* 业主定稿（2026-08-06，减法）：区块显示条件只看"ACTION_PENDING 且有
          action 行"，不再要求"有未提交项"——状态就是状态，按钮归按钮。

          · 限定 ACTION_PENDING —— 单子已经有别的结局时不该再对客户喊"请提供材料"。
            approveDeposit 接受 ACTION_PENDING 直推 SUCCESS 且从不清理已提交的
            action 行，若只看 actions.length，一笔已成功的单会一直挂着这块区域。

          · 不再要求"有未提交项"：此前这条是为了让"全部交齐"的客户在区块层面也
            零变化——但那套判据正是本轮要拆的机制的一部分，且有反效果：全部交齐
            时区块整个消失，徽章却仍是 ACTION REQUIRED，一张卡都没有反而更让人
            糊涂。新口径下每张卡自己决定按钮是否可点（见下方），区块本身只要
            "这单确实挂过 action" 就一直显示，交没交齐不影响区块存在与否。 */}
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
                {/* 业主原话："根据 applicant action 的状态来改变跳转按钮是否
                    生效"——按钮恒渲染，只按这一条自己的 submittedAt 禁用，
                    不再整条从 DOM 里消失。 */}
                <button
                  onClick={() => navigate(`/deposit/${tx.depositNo}/verification/${a.seq}`)}
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
