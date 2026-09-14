import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getSwapStatusView } from '../utils/swapStatusView';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

/**
 * 客户面兑换详情页（第四批新增 —— 此前三域里唯一没有详情页的域：成交价、
 * 汇率、费用只在下单弹窗闪一次，提交后不可回溯）。
 *
 * 字段来源严格是 `toCustomerSwapView()` 白名单（swap-transactions.service.ts）：
 * 成交前后金额、费用、汇率、时间。凡是调查性字段——Sumsub 交易号、拒绝理由、
 * 复核标记、合规裁决、状态流水——一个都**不在**这里渲染，客户面每多一个键就
 * 多一分泄漏面。改这个页面时不要"顺手"从别处补字段；那几个键名连出现在本文件
 * 的注释里都不行，白名单守卫是一条机械 grep。
 *
 * status 已在服务端经 `toCustomerSwapStatus()` 收敛（FROZEN → COMPLIANCE_PENDING，
 * 与普通「处理中」逐字相同，这是 tipping-off 防线），这里拿到的就是可以直接显示的值，
 * 前端不做二次判断。徽章与 DepositDetail/WithdrawDetail 一样走中性配色，不按
 * tone 上色——详情页上让不同状态在视觉上一致，是同一条防线的延续。
 */
interface SwapDetailData {
  swapNo: string; status: string;
  fromAmount: string; toAmount: string;
  netToAmount: string | null;
  feeAmount: string | null; feeCurrency: string | null;
  exchangeRate: string | null;
  createdAt: string; completedAt: string | null;
  fromAsset: { code: string; currency: string; network: string | null; decimals: number } | null;
  toAsset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const SwapDetail = () => {
  const { swapNo } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // 返回「从哪来回哪去」——镜像 DepositDetail/WithdrawDetail 同一条判据：
  // react-router 在本次会话的第一个历史条目上把 location.key 置为 'default'
  // （直接输 URL/刷新/外部链接进来都是这种），此时 navigate(-1) 会把人送出本站，
  // 只有这种情况才退回列表兜底。
  const goBack = () =>
    location.key === 'default' ? navigate('/swap') : navigate(-1);
  const [tx, setTx] = useState<SwapDetailData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(
          `${import.meta.env.VITE_API_URL}/swap-transactions/my/${swapNo}`,
        );
        if (!r.ok) throw new Error('not found');
        const d = await r.json();
        if (alive) setTx(d);
      } catch (error) {
        // customerFetch 自己会在会话过期时跳转登录页；这里只处理"单子真找不到"，
        // 别在跳转前的一瞬间闪出一条误导性的错误文案（与充值/提现详情页一致）。
        if (error instanceof CustomerSessionError) return;
        if (alive) setErr('This swap is not available.');
      }
    })();
    return () => { alive = false; };
  }, [swapNo]);

  if (err) return <div className="max-w-4xl mx-auto text-fx-dust">{err}</div>;
  if (!tx) return <div className="max-w-4xl mx-auto text-fx-dust">Loading…</div>;

  // 徽章纯按 status 查表（单参纯查表）——同 DepositDetail/WithdrawDetail。
  const view = getSwapStatusView(tx.status);

  // 只有真正成交的单子才敢用断言句（下方 You sold / You received）。判据只读
  // 已收敛的 tx.status —— 服务端 toCustomerSwapStatus() 已把制裁冻结单收敛成
  // 与普通「处理中」逐字相同的 COMPLIANCE_PENDING，这里跟着一起走同一个分支，
  // 绝不再按别的字段二次判断（那等于把冻结单在页面上单独分辨出来，破 tipping-off
  // 防线）。
  const settled = tx.status === 'SUCCESS';

  // 费用币种在白名单里是独立字段（可能既不是卖出腿也不是买入腿的币种）。
  // 详情页不像 Swap.tsx 那样持有全量资产表，只能拿本单两条腿去对；对不上就
  // 交给 formatAssetAmount 的默认精度，不为此再拉一次资产接口。
  const feeDecimals =
    tx.feeCurrency && tx.feeCurrency === tx.toAsset?.currency
      ? tx.toAsset?.decimals
      : tx.feeCurrency && tx.feeCurrency === tx.fromAsset?.currency
        ? tx.fromAsset?.decimals
        : undefined;

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={goBack} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Swaps
      </button>

      <div className="flex items-start justify-between gap-4 pb-6 border-b border-fx-rule">
        <div>
          <div className="text-3xl font-bold text-fx-sand">
            {formatAssetAmount(tx.netToAmount ?? tx.toAmount, tx.toAsset?.decimals)} <span className="text-lg text-fx-dust">{tx.toAsset?.currency}</span>
          </div>
          <div className="font-mono text-xs text-fx-dust mt-1">
            {tx.swapNo}
            {tx.fromAsset && tx.toAsset ? ` · ${tx.fromAsset.code} → ${tx.toAsset.code}` : ''}
          </div>
        </div>
        <span className="rounded-xl px-3 py-1 text-xs font-semibold border border-fx-rule text-fx-sand">
          {view.label}
        </span>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Submitted" value={new Date(tx.createdAt).toLocaleString()} />
          <Field
            label="Exchange rate"
            value={
              tx.exchangeRate
                ? `1 ${tx.fromAsset?.currency ?? ''} = ${formatRate8(tx.exchangeRate)} ${tx.toAsset?.currency ?? ''}`.trim()
                : '—'
            }
            mono
          />
          {/* 未成交的单子上写「You received X」是客户面财务页上的事实性错误：
              失败单的钱原路退回、他一分没收到，卖出腿同样没扣；处理中的单子
              也还没到账。非 SUCCESS 一律降级成中性名词（对齐列表页那一列
              中性的 Amount 表头，不断言收付）。 */}
          <Field
            label={settled ? 'You sold' : 'Sell amount'}
            value={`${formatAssetAmount(tx.fromAmount, tx.fromAsset?.decimals)} ${tx.fromAsset?.currency ?? ''}`.trim()}
          />
          <Field
            label={settled ? 'You received' : 'Quoted amount'}
            value={`${formatAssetAmount(tx.netToAmount ?? tx.toAmount, tx.toAsset?.decimals)} ${tx.toAsset?.currency ?? ''}`.trim()}
          />
          <Field
            label="Fee"
            value={tx.feeAmount ? `${formatAssetAmount(tx.feeAmount, feeDecimals)} ${tx.feeCurrency ?? ''}`.trim() : '—'}
          />
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
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

export default SwapDetail;
