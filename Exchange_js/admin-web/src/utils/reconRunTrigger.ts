// admin-web/src/utils/reconRunTrigger.ts
//
// Shared "一键重新对账 / Re-reconcile" action for the cockpit detail pages
// (Case detail + Run detail). Triggers a fresh per-wallet reconciliation run
// at the current instant so a case whose explaining funds order has since been
// pushed to CLEARED gets re-observed and closed.
//
// POST /admin/reconciliation/runs/wallet { cutoff: <now ISO> }
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from './adminFetch';

/**
 * Fire a wallet reconciliation run with cutoff = now. Returns true on success,
 * false on a handled failure (an alert is shown). AdminSessionError is swallowed
 * (global redirect handles it) and reported as false.
 */
export async function triggerWalletReconRun(): Promise<boolean> {
  try {
    const res = await adminFetch(
      `${import.meta.env.VITE_API_URL}/admin/reconciliation/runs/wallet`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff: new Date().toISOString() }),
      },
    );
    if (!res.ok) {
      alert(await getApiErrorMessage(res, 'Re-reconcile failed / 重新对账失败'));
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof AdminSessionError) return false;
    console.error('Re-reconcile request failed', error);
    alert('Re-reconcile request failed / 重新对账请求失败');
    return false;
  }
}
