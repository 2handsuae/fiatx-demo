import { AlertTriangle } from 'lucide-react';

/**
 * 「这单卡住了，要人看」的顶部横幅（充值 / 提现 / 兑换三域共用）。
 *
 * 业主定的形态：这面旗只在页顶出现一次，不埋进侧栏 KV（第五批 §6）。
 * 合并前三域三样：充值只有侧栏 KV 没有横幅、提现有横幅无图标、兑换有横幅带图标，
 * 连底色浓度和内边距都不同（bg-adm-red/5 + py-2.5 vs bg-adm-red/10 + py-2）。
 *
 * ⚠️ 文案由各域传入，**不是共用一句** —— 三个域的 needsReview 语义不同：
 *   充值 = 处置资金腿重试三级梯耗尽、单子卡在原地
 *   提现 = 放款已广播后才到的 KYT 裁决，没有合法边可走
 *   兑换 = 成交后才到的 KYT 裁决，订单终态不可逆
 * 共用一句会说错话。
 */
export const NeedsReviewBanner = ({ show, message }: { show: boolean; message: string }) => {
  if (!show) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-adm-border bg-adm-red/10 px-6 py-2.5 font-mono text-[11px] text-adm-red">
      <AlertTriangle size={12} className="shrink-0" />
      {message}
    </div>
  );
};
