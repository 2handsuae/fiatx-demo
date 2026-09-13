// admin-web/src/components/DemoOpsPanel.tsx
// 云端演示自助还原面板（spec 2026-09-13-cloud-demo-ops-buttons-design.md §4）。
// status 轮询用裸 fetch（免登录端点）：重铺期间后端整个不在、旧 token 已失效，
// adminFetch 的 401 重定向会把轮询打断。只有两个 POST 走 adminFetch。
import { useEffect, useRef, useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';

interface Props { open: boolean; onClose: () => void }

interface DemoOpsStatus {
  boot: string;
  reconBreak: { state: 'idle' | 'running' | 'done' | 'fail'; tail: string[]; finishedAt: string | null };
}

type ResetPhase = 'idle' | 'confirm' | 'resetting' | 'done';

const POLL_MS = 2000;

const DemoOpsPanel = ({ open, onClose }: Props) => {
  const [status, setStatus] = useState<DemoOpsStatus | null>(null);
  const [resetPhase, setResetPhase] = useState<ResetPhase>('idle');
  const [reconRequested, setReconRequested] = useState(false);
  const [error, setError] = useState('');
  // 重铺完成判定要「先见断线、再见 READY」：点击瞬间文件可能还是 READY。
  const sawDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/demo-ops/status`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const next = (await res.json()) as DemoOpsStatus;
        if (cancelled) return;
        setStatus(next);
        setResetPhase((phase) =>
          phase === 'resetting' && sawDownRef.current && next.boot === 'READY' ? 'done' : phase,
        );
      } catch {
        if (!cancelled) sawDownRef.current = true; // 重铺期间接口不在：预期形态，不当错误展示
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open]);

  if (!open) return null;

  const reconState = status?.reconBreak.state ?? 'idle';
  const busy = resetPhase === 'resetting' || reconState === 'running';

  const requestReset = async () => {
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/demo-ops/reset`, { method: 'POST' });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to start the reset')); return; }
      sawDownRef.current = false;
      setResetPhase('resetting');
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to start the reset');
    }
  };

  const requestReconBreak = async () => {
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/demo-ops/recon-break`, { method: 'POST' });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to start the restore')); return; }
      setReconRequested(true);
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to start the restore');
    }
  };

  const goToSignIn = () => {
    localStorage.removeItem('admin_token');
    window.location.href = '/admin/login';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={resetPhase === 'resetting' ? undefined : onClose}
    >
      <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-adm-t1">Demo Data</h3>
          <span className="font-mono text-[10px] text-adm-t3">{status ? status.boot : '…'}</span>
        </div>
        <p className="mb-4 text-xs text-adm-t3">Self-service restore for the shared demo dataset.</p>

        {resetPhase === 'done' ? (
          <>
            <p className="text-xs text-adm-t2">
              Reset complete — the demo dataset is back to its standard state. Your session has expired;
              please sign in again.
            </p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={goToSignIn} className={adminButtonClass('modalConfirm')}>Go to sign-in</button>
            </div>
          </>
        ) : resetPhase === 'resetting' ? (
          <p className="text-xs text-adm-t2">
            Rebuilding the entire dataset — this takes about a minute and the system is unavailable meanwhile.
            This panel keeps checking and will tell you when it is done.
          </p>
        ) : (
          <>
            {/* ── Full reset ── */}
            <div className="mb-3 rounded border border-adm-border p-3">
              <div className="mb-1 text-xs font-medium text-adm-t1">Full reset</div>
              <p className="mb-2 text-xs text-adm-t3">
                Rebuilds everything from scratch: seeded customers, one full trading day, 18 reconciliation
                scenarios. Takes about a minute; everyone is signed out and manually created data is lost.
              </p>
              {resetPhase === 'confirm' ? (
                <div className="flex items-center justify-end gap-2">
                  <span className="mr-auto text-xs text-adm-red">Wipe all current data and re-seed?</span>
                  <button type="button" onClick={() => setResetPhase('idle')} className={adminButtonClass('modalCancel')}>Cancel</button>
                  <button type="button" disabled={busy} onClick={() => void requestReset()} className={adminButtonClass('modalConfirm')}>Yes, reset everything</button>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button type="button" disabled={busy} onClick={() => setResetPhase('confirm')} className={adminButtonClass('modalConfirm')}>Reset all demo data…</button>
                </div>
              )}
            </div>

            {/* ── Recon scenarios ── */}
            <div className="rounded border border-adm-border p-3">
              <div className="mb-1 text-xs font-medium text-adm-t1">Restore reconciliation scenarios</div>
              <p className="mb-2 text-xs text-adm-t3">
                Re-stages only the 18 reconciliation break scenarios (previous runs, cases and dispositions
                are cleared). Customers, transactions and everything else stay untouched. Takes a few seconds.
              </p>
              {reconState === 'running' ? (
                <p className="text-xs text-adm-amber">Restoring… this takes a few seconds.</p>
              ) : reconRequested && reconState === 'done' ? (
                <p className="text-xs text-adm-t2">Done — 18 reconciliation scenarios restored. Open the reconciliation cases page to start over.</p>
              ) : reconRequested && reconState === 'fail' ? (
                <>
                  <p className="mb-1 text-xs text-adm-red">Restore failed — last output:</p>
                  <pre className="max-h-32 overflow-auto rounded bg-adm-hover/40 p-2 font-mono text-[10px] text-adm-t2">{(status?.reconBreak.tail ?? []).slice(-8).join('\n')}</pre>
                </>
              ) : null}
              {reconState !== 'running' && (
                <div className="mt-2 flex justify-end">
                  <button type="button" disabled={busy} onClick={() => void requestReconBreak()} className={adminButtonClass('modalConfirm')}>Restore recon scenarios</button>
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-xs text-adm-red">{error}</p>}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DemoOpsPanel;
