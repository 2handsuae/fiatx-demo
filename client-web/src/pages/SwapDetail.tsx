import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getSwapStatusView } from '../utils/swapStatusView';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import Field from '../components/detail/Field';
import { useGoBack } from '../components/detail/useGoBack';
import { Timeline } from '../components/detail/Timeline';

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
 *
 * 本轮（Task 8）新增五键，同样出自 toCustomerSwapView() 白名单，逐一交代安全边界：
 * quoteNo——报价业务号，规则⑥允许对外的业务键，不是内部 id；
 * feeLines——服务端 toCustomerPricingFacts() 已从 feeBreakdown 拆净的业务费用行
 *   （itemCode/amount/currency），fx 技术字段（endpoint/symbol/bid/ask）在服务端就
 *   被滤掉了，这里只是逐行渲染，不会把技术字段带上桌；
 * marketRate / spreadPercent——报价页下单前就已经给客户看过的同一口径市场价与点差，
 *   详情页只是把它留痕，不是新泄漏面；
 * timeline——buildCustomerTimeline() 的收敛产物，逐条状态已经过 toCustomerSwapStatus()
 *   同一条 tipping-off 防线映射，不是原始 statusHistory。
 */
interface SwapDetailData {
  swapNo: string; status: string;
  fromAmount: string; toAmount: string;
  netToAmount: string | null;
  feeAmount: string | null; feeCurrency: string | null;
  exchangeRate: string | null;
  quoteNo: string | null;
  feeLines: { itemCode: string; amount: string; currency: string }[];
  marketRate: string | null; spreadPercent: number | null;
  createdAt: string; completedAt: string | null;
  timeline: { status: string; at: string }[];
  fromAsset: { code: string; currency: string; network: string | null; decimals: number } | null;
  toAsset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

// Pricing 区块费用行的 itemCode 词化——就地小函数，不建映射表：
// SERVICE_FEE -> Service fee。
const formatFeeLineLabel = (itemCode: string) => {
  const words = itemCode.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const SwapDetail = () => {
  const { swapNo } = useParams();
  const goBack = useGoBack('/swap');
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

  // 只有真正成交的单子才敢用断言句（下方 You sold / Gross receive / Net received）。
  // 判据只读已收敛的 tx.status —— 服务端 toCustomerSwapStatus() 已把制裁冻结单收敛成
  // 与普通「处理中」逐字相同的 COMPLIANCE_PENDING，这里跟着一起走同一个分支，
  // 绝不再按别的字段二次判断（那等于把冻结单在页面上单独分辨出来，破 tipping-off
  // 防线）。未成交的单子上写「You received X」是客户面财务页上的事实性错误：
  // 失败单的钱原路退回、他一分没收到，卖出腿同样没扣；处理中的单子也还没到账。
  // 非 SUCCESS 一律降级成中性名词（对齐列表页那一列中性的 Amount 表头，不断言收付）。
  const settled = tx.status.toUpperCase() === 'SUCCESS';

  // 费用币种在白名单里是独立字段（可能既不是卖出腿也不是买入腿的币种）。
  // 详情页不像 Swap.tsx 那样持有全量资产表，只能拿本单两条腿去对；对不上就
  // 交给 formatAssetAmount 的默认精度，不为此再拉一次资产接口。
  const feeDecimals =
    tx.feeCurrency && tx.feeCurrency === tx.toAsset?.currency
      ? tx.toAsset?.decimals
      : tx.feeCurrency && tx.feeCurrency === tx.fromAsset?.currency
        ? tx.fromAsset?.decimals
        : undefined;

  // Pricing 区块费用行同法推精度——feeLines 里每条的币种同样可能既不是卖出腿
  // 也不是买入腿，就地按 f.currency 对本单两条腿，对不上回落 undefined。
  const feeLineDecimals = (currency: string) =>
    currency === tx.toAsset?.currency
      ? tx.toAsset?.decimals
      : currency === tx.fromAsset?.currency
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
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Amounts</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label={settled ? 'You sold' : 'Sell amount'}
            value={`${formatAssetAmount(tx.fromAmount, tx.fromAsset?.decimals)} ${tx.fromAsset?.currency ?? ''}`.trim()}
          />
          <Field
            label={settled ? 'Gross receive' : 'Quoted gross'}
            value={`${formatAssetAmount(tx.toAmount, tx.toAsset?.decimals)} ${tx.toAsset?.currency ?? ''}`.trim()}
          />
          <Field
            label="Fee"
            value={tx.feeAmount ? `− ${formatAssetAmount(tx.feeAmount, feeDecimals)} ${tx.feeCurrency ?? ''}`.trim() : '—'}
          />
          <Field
            label={settled ? 'Net received' : 'Quoted amount'}
            value={`${formatAssetAmount(tx.netToAmount ?? tx.toAmount, tx.toAsset?.decimals)} ${tx.toAsset?.currency ?? ''}`.trim()}
          />
          <Field
            label="Exchange rate"
            value={
              tx.exchangeRate
                ? `1 ${tx.fromAsset?.currency ?? ''} = ${formatRate8(tx.exchangeRate)} ${tx.toAsset?.currency ?? ''}`.trim()
                : '—'
            }
            mono
          />
          {tx.marketRate && (
            <Field label="Market · Spread" value={`${formatRate8(tx.marketRate)} · ${tx.spreadPercent}%`} />
          )}
          <Field label="Submitted" value={new Date(tx.createdAt).toLocaleString()} />
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
        </dl>
      </section>

      {tx.quoteNo && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fx-sand mb-3">Pricing</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Quote No" value={tx.quoteNo} mono />
            {tx.feeLines.map((f, i) => (
              <Field
                key={`${f.itemCode}-${i}`}
                label={formatFeeLineLabel(f.itemCode)}
                value={`${formatAssetAmount(f.amount, feeLineDecimals(f.currency))} ${f.currency}`.trim()}
              />
            ))}
          </dl>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Timeline</h2>
        <Timeline items={tx.timeline.map((t) => ({ label: getSwapStatusView(t.status).label, at: t.at }))} />
      </section>
    </div>
  );
};

export default SwapDetail;
