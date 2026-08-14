import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Clock } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { resolvePendingAction, type PendingAction } from '../utils/resolvePendingAction';
import { useAuth } from '../context/AuthContext';

/* ────────────────────────────────────────────────────────────────
 *  PendingActionBanner — entry point for a customer's outstanding
 *  Sumsub verification action after a swap KYT rejection.
 *
 *  Whether to show anything is decided ONCE, on the backend write side
 *  (swap-workflow.service.ts's handleRejectDisposition): a customer under
 *  sanctions investigation must be told nothing at all — telling them is
 *  "tipping off", a criminal offence in most AML regimes. GET
 *  /client/me/pending-action already encodes that decision: it returns
 *  null for sanctions/hard-line rejections and a real action only for
 *  soft-line ones. This component renders purely off that response —
 *  null means render nothing, no questions asked. Do NOT add any
 *  conditional logic here derived from swap status, restrictions, reject
 *  reason, or anything else — that would put the tipping-off decision in
 *  two places, and the failure mode is a customer being told about a
 *  sanctions investigation.
 *
 *  三态（parity 2026-08-14）：action=null → 不渲染；submittedAt=null →
 *  「请认证」+ CTA 跳 /verification/pending；submittedAt 有值 →
 *  「材料已提交审核中」无 CTA。三态全部按后端字段值渲染——不是本组件在
 *  推导，只是把后端已经决定的事实换成文案。
 *
 *  Fetch-on-mount + refetch-on-visibilitychange mirrors
 *  ProfileBannerStack.tsx's existing pattern.
 * ──────────────────────────────────────────────────────────────── */

export function PendingActionBanner() {
  const [action, setAction] = useState<PendingAction | null>(null);
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  // 记住上一次是否有 action：从「有」翻到「无」= 限制大概率已解除
  //（officer GREEN 清了 pendingAction + restrictions），此刻刷新 AuthContext
  // 的共享 user，让 Swap/Withdraw 页的禁用按钮当场解禁——否则要整页刷新
  //（AuthContext 只在挂载时拉一次 profile，见 useCustomerProfile.ts）。
  const hadActionRef = useRef(false);

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/pending-action`,
      );
      const next = await resolvePendingAction(res);
      if (hadActionRef.current && next === null) {
        void refreshProfile?.();
      }
      hadActionRef.current = next !== null;
      setAction(next);
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      // A non-2xx response, a parse failure, and a network failure all land
      // here (resolvePendingAction throws on !res.ok instead of resolving
      // to "no change"). Any of them on a refetch must not leave a stale
      // action banner on screen after the backend has since cleared it
      // (e.g. a later hard-line disposition) — that would be exactly the
      // tipping-off failure mode this component exists to prevent, just
      // reached through a bug instead of missing logic. One explicit null,
      // not three separate call sites that can drift.
      // 注意：失败路径【不】触发 refreshProfile —— 失败不是「已解除」的证据。
      setAction(null);
    }
  };

  useEffect(() => {
    void load();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!action) return null;

  const submitted = !!action.submittedAt;

  return (
    <div className="border-l-4 border-l-fx-copper bg-fx-copper/[0.03] px-4 py-3 flex items-start justify-between gap-4 mb-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {submitted ? (
          <Clock size={14} className="shrink-0 mt-[1px] text-fx-copper" />
        ) : (
          <AlertCircle size={14} className="shrink-0 mt-[1px] text-fx-copper" />
        )}
        <p className="font-sans text-[12px] text-fx-dune leading-snug">
          {submitted
            ? 'Verification submitted — under review.'
            : 'Additional verification is required before you can continue trading.'}
        </p>
      </div>
      {!submitted && (
        <button
          onClick={() => navigate('/verification/pending')}
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
        >
          Complete verification
        </button>
      )}
    </div>
  );
}
