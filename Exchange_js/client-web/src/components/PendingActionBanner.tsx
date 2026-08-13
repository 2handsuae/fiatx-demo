import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';

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
 *  Fetch-on-mount + refetch-on-visibilitychange mirrors
 *  ProfileBannerStack.tsx's existing pattern (so switching back to this
 *  tab after an admin action picks up a fresh answer without a manual
 *  reload).
 * ──────────────────────────────────────────────────────────────── */

interface PendingAction {
  externalActionId: string;
  reason: string;
}

export function PendingActionBanner() {
  const [action, setAction] = useState<PendingAction | null>(null);

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/pending-action`,
      );
      if (!res.ok) return;
      // NestJS sends a body-less 200 (Content-Length: 0) for a bare `return
      // null`, not the text "null" — res.json() throws SyntaxError on that.
      // Read as text first and treat an empty body as null explicitly; a
      // caught parse error must not fall through to "leave the previous
      // action displayed" (see the refetch bug this guards against below).
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      setAction(data ?? null);
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      // A real parse/network failure on refetch must not leave a stale
      // action banner on screen after the backend has since cleared it
      // (e.g. a later hard-line disposition) — that would be exactly the
      // tipping-off failure mode this component exists to prevent, just
      // reached through a bug instead of missing logic. Explicit null,
      // not a silent no-op.
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

  return (
    <div className="border-l-4 border-l-fx-copper bg-fx-copper/[0.03] px-4 py-3 flex items-start justify-between gap-4 mb-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <AlertCircle size={14} className="shrink-0 mt-[1px] text-fx-copper" />
        <p className="font-sans text-[12px] text-fx-dune leading-snug">
          Additional verification is required before you can continue trading.
        </p>
      </div>
      <button
        onClick={() => startWebSdk(action.externalActionId)}
        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
      >
        Complete verification
      </button>
    </div>
  );
}

/**
 * STUB — not wired to a real Sumsub WebSDK launch. Withdraw/deposit's
 * equivalent flow (WithdrawVerification.tsx / DepositVerification.tsx)
 * mints an SDK access token from a dedicated per-record verification-session
 * endpoint (withdraw-verification-session.service.ts's createActionSdkToken
 * call, keyed by withdrawNo+seq). Swap's pendingAction is a single
 * customer-level slot (CustomerMain.pendingActionExternalId/
 * pendingActionReason, Task 7) with no equivalent token-minting endpoint —
 * building one is a backend change out of this task's scope (client-only +
 * one named hardening, see task-11-brief.md). Once that endpoint exists,
 * replace this with the same snsWebSdk.init(token, refreshToken)
 * .launch(...) pattern WithdrawVerification.tsx already uses.
 */
function startWebSdk(externalActionId: string) {
  console.info('[PendingActionBanner] startWebSdk stub — externalActionId:', externalActionId);
  window.alert('Verification is not available yet. Please contact support.');
}
