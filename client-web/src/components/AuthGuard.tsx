import { useEffect, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  isCustomerApprovedForAccess,
  isCustomerFinalApprovalPending,
  isCustomerRejected,
  isCustomerWithdrawn,
  normalizeLifecycle,
} from '../utils/customerOnboarding';
import { useTradingReadiness } from '../hooks/useTradingReadiness';
import { customerFetch } from '../utils/customerFetch';
import TradingStartGuide from './TradingStartGuide';

/* ────────────────────────────────────────────────────────────────
 *  AuthGuard — calm pending notice.
 *  A single, low-ornament halt frame that sits inside the member
 *  shell. No giant watermark, no 4-stage ledger. Just: where we are,
 *  what's next, one CTA.
 * ──────────────────────────────────────────────────────────────── */

interface AuthGuardProps {
  children: ReactNode;
}

type GateCopy = {
  byline: string;
  title: string;
  body: string;
  cta: string;
  tone: 'neutral' | 'waiting' | 'blocked';
};

const STEPS = ['Register', 'Verify', 'Review', 'Active'] as const;

const AuthGuard = ({ children }: AuthGuardProps) => {
  const { user, loading, isAuthenticated, error } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { tradingReady, loading: tradingReadinessLoading, refetch: refetchTradingReadiness } = useTradingReadiness();

  useEffect(() => {
    if (!loading && !isAuthenticated && !error) {
      navigate('/login');
    }
  }, [loading, isAuthenticated, error, navigate]);

  // Re-check trading readiness on every navigation: AuthGuard persists across
  // route changes (React reuses the Outlet slot), so its readiness would otherwise
  // stay stale after the customer adds their first fiat address and navigates on
  // to a business page — leaving the guard wrongly showing.
  useEffect(() => {
    refetchTradingReadiness();
  }, [location.pathname, refetchTradingReadiness]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center gap-3">
        <RefreshCw size={14} className="animate-spin text-fx-brass" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
          Verifying session
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center px-6">
        <div className="w-full max-w-md border border-fx-rust/30 bg-fx-rust/5 p-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-rust mb-3">
            § Session error
          </div>
          <div className="fx-serif text-[18px] text-fx-sand mb-3 leading-snug">
            Couldn&apos;t verify your session.
          </div>
          <p className="font-mono text-[11px] text-fx-dune mb-6 leading-relaxed">
            {error}
          </p>
          <button onClick={() => window.location.reload()} className="fx-btn-ghost">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const isApproved = user ? isCustomerApprovedForAccess(user) : false;
  if (isApproved) {
    // RESTRICTED（parity 2026-08-14 定稿）：受限能力的页面一律【不重定向】——
    // Swap/Withdraw 页自禁按钮 + RestrictionBanner 逐条提示（业主拍板：页面基本不动）；
    // 后端 L1 门（CAPABILITY_RESTRICTED）原样在，前端只是体验层。

    // Trading-readiness gate: approved but no active fiat withdrawal address → show the
    // standalone guide page (its CTA routes to /withdrawal-addresses to add one).
    // Business paths blocked; /withdrawal-addresses (the setup page) intentionally NOT blocked.
    // Segment-boundary match: '/withdraw' must NOT catch '/withdrawal-addresses' (its own destination).
    const readinessBlockedPaths = ['/deposit', '/withdraw', '/swap'];
    if (
      !tradingReadinessLoading &&
      !tradingReady &&
      readinessBlockedPaths.some(
        (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
      )
    ) {
      return <TradingStartGuide />;
    }

    return <>{children}</>;
  }

  // 波二开门：认证页本身对未 ACTIVE 客户放行（照 readiness 门放行 /withdrawal-addresses 的先例）
  if (location.pathname === '/onboarding/verify') return <>{children}</>;

  // lifecycle 未过的四步拦截页。OFFBOARDED 到不了这里——终态客户的会话在
  // jwt.strategy 就被拒，根本进不到路由。
  const lifecycle = normalizeLifecycle(user?.lifecycle) ?? 'PROSPECT';
  const isRejected = user ? isCustomerRejected(user) : false;
  const isWithdrawn = user ? isCustomerWithdrawn(user) : false;
  const isBlocked = isRejected || isWithdrawn;
  const isFinalPending = user ? isCustomerFinalApprovalPending(user) : false;

  /* Current step index into STEPS (0..3) */
  const stepIndex = isBlocked
    ? 1
    : isFinalPending
      ? 2
      : lifecycle === 'IN_VERIFICATION'
        ? 1
        : lifecycle === 'PROSPECT'
          ? 1
          : 2;

  let copy: GateCopy;
  if (isBlocked) {
    copy = {
      byline: '§ Access paused',
      title: isRejected ? 'Application declined.' : 'Application withdrawn.',
      body:
        user?.canReapply === false
          ? 'This application cannot be reopened. Please contact support.'
          : isRejected
            ? 'Our compliance team could not approve this application. You may open a new one with updated supporting information.'
            : 'This application was withdrawn. You may open a new application at any time.',
      cta: isRejected ? 'Retry verification' : 'Restart verification',
      tone: 'blocked',
    };
  } else if (isFinalPending) {
    copy = {
      byline: '§ Awaiting final approval',
      title: 'Final approval pending.',
      body: 'A compliance officer is signing off your file. This usually takes 1–2 business days; we will email you the moment your account is active.',
      cta: 'View status',
      tone: 'waiting',
    };
  } else if (lifecycle === 'IN_VERIFICATION') {
    copy = {
      byline: '§ Verification in progress',
      title: 'Verification in progress.',
      body: 'You can continue your identity verification whenever you are ready. The process takes about three minutes.',
      cta: 'Continue verification',
      tone: 'waiting',
    };
  } else {
    copy = {
      byline: '§ Access pending',
      title: 'Identity pending.',
      body: 'Your trading features unlock once you pass customer due diligence. The process takes about three minutes.',
      cta: 'Start verification',
      tone: 'neutral',
    };
  }

  const titleTone =
    copy.tone === 'blocked' ? 'text-fx-rust' : 'text-fx-sand';

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[520px]">
        {/* Byline — brass hairline + mono label */}
        <div className="flex items-center gap-3 mb-10">
          <span className="h-[1px] w-8 bg-fx-brass" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
            {copy.byline}
          </span>
        </div>

        {/* Title — single line, Fraunces display, calm size */}
        <h1 className={`fx-display font-light text-[40px] leading-[1.05] ${titleTone}`}>
          {copy.title}
        </h1>

        {/* Body — single paragraph, serif, narrow */}
        <p className="mt-6 fx-serif text-[15px] leading-[1.7] text-fx-dune max-w-[440px]">
          {copy.body}
        </p>

        {/* CTA + meta line */}
        <div className="mt-10 flex flex-wrap items-center gap-5">
          {(() => {
            const goVerify = () => navigate('/onboarding/verify');
            const post = (p: string) =>
              customerFetch(`${import.meta.env.VITE_API_URL}/client/me/onboarding/${p}`, { method: 'POST' });
            if (isBlocked && user?.canReapply === false) return null; // 终拒：无 CTA，中性文案
            if (isBlocked) {
              return <button className="fx-btn-primary" onClick={async () => { const r = await post('reapply'); if (r.ok) goVerify(); }}>{copy.cta}</button>;
            }
            if (isFinalPending) return null; // 等高管终审：陈述屏，无动作
            if (lifecycle === 'IN_VERIFICATION') {
              return <button className="fx-btn-primary" onClick={goVerify}>{copy.cta}</button>;
            }
            return <button className="fx-btn-primary" onClick={async () => { const r = await post('start'); if (r.ok) goVerify(); }}>{copy.cta}</button>;
          })()}
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
            Est. 3 min · VARA regulated
          </span>
        </div>

        {/* Step ticker — tiny hairline stepper */}
        <div className="mt-14 pt-5 border-t border-fx-rule flex items-center gap-4 font-mono text-[9px] uppercase tracking-[0.18em]">
          {STEPS.map((label, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            const tone =
              done
                ? 'text-fx-sage'
                : active
                  ? 'text-fx-brass'
                  : 'text-fx-dust/40';
            return (
              <span key={label} className="flex items-center gap-2">
                <span className={tone}>
                  {String.fromCharCode(0x2160 + i)}
                </span>
                <span className={tone}>{label}</span>
                {i < STEPS.length - 1 && (
                  <span className="ml-2 h-[1px] w-6 bg-fx-rule" />
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AuthGuard;
