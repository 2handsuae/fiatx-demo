import { useNavigate } from 'react-router-dom';
import { Landmark } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────
 *  TradingStartGuide — standalone interception page shown when an
 *  approved customer has no ACTIVE fiat withdrawal address yet.
 *  Rendered by AuthGuard for the order pages (deposit / withdraw /
 *  swap / deposit-wallets). One CTA → the Wallet page, where the
 *  customer adds a fiat (bank) withdrawal address to unlock trading.
 *  Reuses the AuthGuard calm-overlay design language.
 * ──────────────────────────────────────────────────────────────── */

const TradingStartGuide = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[520px]">
        {/* Byline — brass hairline + mono label */}
        <div className="flex items-center gap-3 mb-10">
          <span className="h-[1px] w-8 bg-fx-brass" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
            § Withdrawal address required
          </span>
        </div>

        {/* Icon */}
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-fx-brass/10 text-fx-brass mb-6">
          <Landmark size={20} />
        </span>

        {/* Title */}
        <h1 className="fx-display font-light text-[40px] leading-[1.05] text-fx-sand">
          Add a withdrawal address to start.
        </h1>

        {/* Body */}
        <p className="mt-6 fx-serif text-[15px] leading-[1.7] text-fx-dune max-w-[440px]">
          Before you can deposit, swap, or withdraw, you need at least one active
          fiat (bank) withdrawal address on file. It only takes a minute — add
          your bank account in the Wallet, and everything unlocks.
        </p>

        {/* CTA + meta line */}
        <div className="mt-10 flex flex-wrap items-center gap-5">
          <button onClick={() => navigate('/withdrawal-addresses')} className="fx-btn-primary">
            Go to Wallet →
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
            One-time setup · VARA regulated
          </span>
        </div>
      </div>
    </div>
  );
};

export default TradingStartGuide;
