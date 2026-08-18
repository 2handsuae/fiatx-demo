import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getWithdrawStatusView } from '../utils/withdrawStatusView';
import { formatAssetAmount } from '../utils/number-format';

interface WithdrawDetailData {
  withdrawNo: string; status: string; amount: string;
  feeAmount: string; netAmount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  toAddress: string | null; toIban: string | null;
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

/**
 * 2026-08-18 材料请求账：本页曾经开的 `actions`（提现单专属子表逐条 action）
 * 口子已被 Task 12 随子表一起物理删除。改成独立打
 * `/client/me/material-requests`，按 `orderDomain==='WITHDRAW' &&
 * orderRef===withdrawNo` 过滤（G6：绑了单的行只在它绑定的订单页露）。
 * "本单非终态"闸门理由见 DepositDetail.tsx 同址注释——订单终态解绑监听器
 * 目前只有 SWAP 域端到端走得通。
 */
interface MaterialRequestEntry {
  requestNo: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
}

const WITHDRAW_TERMINAL_STATUSES = new Set(['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED']);

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
  const [materials, setMaterials] = useState<MaterialRequestEntry[]>([]);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/material-requests`);
        if (!r.ok) return;
        const rows = (await r.json()) as MaterialRequestEntry[];
        if (alive && Array.isArray(rows)) {
          setMaterials(rows.filter((m) => m.orderDomain === 'WITHDRAW' && m.orderRef === withdrawNo));
        }
      } catch (error) {
        if (error instanceof CustomerSessionError) return;
        // 拉不到就当没有——这块区域本来就是"有就显示"，静默降级比崩页面安全。
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

      {/* 镜像 DepositDetail 2026-08-18 更新：区块显示条件改成"这单有绑定的活
          材料请求 且本单非终态"（数据源换成材料账，理由见文件头注释）；交没
          交齐不影响区块存在与否，每张卡自己按 status 决定按钮是否可点。 */}
      {materials.length > 0 && !WITHDRAW_TERMINAL_STATUSES.has(tx.status.toUpperCase()) && (
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
