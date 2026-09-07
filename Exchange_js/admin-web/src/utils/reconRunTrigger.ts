// admin-web/src/utils/reconRunTrigger.ts
//
// Shared "一键重新对账 / Re-reconcile" action for the cockpit detail pages
// (Case detail + Run detail).
//
// ⚠ 2026-08-29 修正：此前发的是 `cutoff: new Date()`（"现在"）。对账引擎按截止日
// **精确匹配**取当天的外部对账单（wallet-recon-run.service.ts：
// `externalBalance.findMany({ where: { cutoffDate } })`），而 D 日的对账单要 D+1
// 才到——夜间任务跑 yesterday 正是这个道理。于是"今天"的对账单基本永远不存在：
// 按钮每次都拿一份不存在的对账单去对账，一个钱包都查不到。叠上当时自愈只判
// "不在破口集合里"，这个按钮的实际效果是**一键把所有案件关掉**
// （实测 RUN20260829-1：MANUAL / walletCount=0 / closedCount=8）。
//
// 正确口径：重对账 = 拿**同一份对账单**重新跑一遍，所以截止点固定在这张案件
// （或这次运行）的业务日日终。
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from './adminFetch';

/**
 * 对指定业务日重跑一次钱包级对账。businessDate 形如 `2026-08-28`，取自当前案件
 * （kase.businessDate）或当前运行（run.businessDate）。成功返回 true；可处理的
 * 失败返回 false 并弹提示。AdminSessionError 由全局跳转接管，这里吞掉记 false。
 */
export async function triggerWalletReconRun(businessDate: string): Promise<boolean> {
  try {
    const res = await adminFetch(
      `${import.meta.env.VITE_API_URL}/admin/reconciliation/runs/wallet`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff: `${businessDate}T23:59:59.999Z` }),
      },
    );
    if (!res.ok) {
      alert(await getApiErrorMessage(res, 'Re-reconcile failed'));
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof AdminSessionError) return false;
    console.error('Re-reconcile request failed', error);
    alert('Re-reconcile request failed');
    return false;
  }
}
