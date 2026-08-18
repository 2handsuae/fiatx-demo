import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getDepositStatusView } from '../utils/depositStatusView';
import { formatAssetAmount } from '../utils/number-format';

interface DepositDetailData {
  depositNo: string; status: string; amount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  fromAddress: string | null; fromIban: string | null;
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

/**
 * 2026-08-18 材料请求账：本页曾经开的 `actions`（充值单专属子表逐条 action）
 * 口子已被 Task 12 随子表一起物理删除——那个字段现在客户端拿到的是
 * `undefined`，`tx.actions.length` 会直接抛错。改成独立打
 * `/client/me/material-requests`，按 `orderDomain==='DEPOSIT' &&
 * orderRef===depositNo` 过滤（G6：绑了单的行只在它绑定的订单页露）。
 *
 * `本单非终态` 这道闸门是必须的，不是多余的防御：订单进终态后自动解绑
 * 材料请求的监听器（`material-request-order-cancel.listener.ts`）目前只有
 * SWAP 域端到端走得通，DEPOSIT/WITHDRAW 域接的事件在真实链路上从未被
 * emit 过（见该 commit 说明）——一条未挂限制的材料请求可能在单子已经
 * SUCCESS/FAILED/RETURNED 之后仍然"活"在账上，客户端必须自己兜底不显示。
 */
interface MaterialRequestEntry {
  requestNo: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
}

const DEPOSIT_TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'RETURNED']);

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
  const [materials, setMaterials] = useState<MaterialRequestEntry[]>([]);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/material-requests`);
        if (!r.ok) return;
        const rows = (await r.json()) as MaterialRequestEntry[];
        if (alive && Array.isArray(rows)) {
          setMaterials(rows.filter((m) => m.orderDomain === 'DEPOSIT' && m.orderRef === depositNo));
        }
      } catch (error) {
        if (error instanceof CustomerSessionError) return;
        // 拉不到就当没有——这块区域本来就是"有就显示"，静默降级比崩页面安全。
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

      {/* 2026-08-18 材料请求账：区块显示条件从"ACTION_PENDING 且有 action 行"
          改成"这单有绑定的活材料请求 且本单非终态"——数据源换了（见文件头
          注释），但"状态就是状态、按钮归按钮"这条业主原则不变：区块是否
          出现只看有没有材料请求，交没交齐由每张卡自己的 status 决定按钮
          是否可点，不再整条从 DOM 里消失。 */}
      {materials.length > 0 && !DEPOSIT_TERMINAL_STATUSES.has(tx.status.toUpperCase()) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fx-sand mb-3">Outstanding verification</h2>
          <div className="space-y-2">
            {materials.map((m) => (
              <div key={m.requestNo} className="flex items-center gap-3 rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fx-sand">{m.materialLabel}</div>
                  <div className="text-xs text-fx-dust">
                    {m.status === 'SUBMITTED' ? 'Received · under review' : 'Awaiting your documents'}
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/verification/${m.requestNo}?from=${encodeURIComponent(location.pathname)}`)}
                  disabled={m.status === 'SUBMITTED'}
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
