import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import { ProfileBannerStack } from '../components/ProfileBannerStack';
import {
  isCustomerApprovedForAccess,
  isCustomerFinalApprovalPending,
  isCustomerInProgress,
  isCustomerRejected,
  isCustomerWithdrawn,
} from '../utils/customerOnboarding';

/* ────────────────────────────────────────────────────────────────
 *  Profile — FIATX Terminal dialect.
 *  Compact dossier. All fields on a single screen. The only piece
 *  of Fraunces is the member's name at 28px. Everything else is
 *  IBM Plex Sans / Mono. No oversized numerals, no `§` ornament.
 * ──────────────────────────────────────────────────────────────── */

type ProfileLike = ReturnType<typeof useCustomerProfile>['profile'];

function getPrimaryStatus(profile: NonNullable<ProfileLike>) {
  const compliance = String(profile.complianceStatus || 'CLEAR').toUpperCase();
  const hasRestrictions = Array.isArray(profile.restrictions) && profile.restrictions.length > 0;
  const onboarding = String(profile.onboardingStatus || 'NONE').toUpperCase();
  const admin = String(profile.adminStatus || 'INACTIVE').toUpperCase();
  if (compliance === 'FROZEN') return 'FROZEN';
  if (hasRestrictions) return 'RESTRICTED';
  if (onboarding === 'APPROVED' && admin === 'ACTIVE') return 'ACTIVE';
  return onboarding;
}

function statusTone(status: string) {
  if (status === 'APPROVED' || status === 'ACTIVE')
    return 'text-fx-sage border-fx-sage/30 bg-fx-sage/5';
  if (status === 'REJECTED' || status === 'FROZEN' || status === 'WITHDRAWN')
    return 'text-fx-rust border-fx-rust/30 bg-fx-rust/5';
  if (status === 'FINAL_APPROVAL')
    return 'text-fx-brass border-fx-brass/30 bg-fx-brass/5';
  return 'text-fx-dune border-fx-rule bg-transparent';
}

function fmt(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ─── Tight key/value row (dossier style) ──────────────────────── */
function Row({
  label,
  value,
  mono = false,
  accent = false,
  span = 1,
}: {
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
  span?: 1 | 2 | 3;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  const colCls =
    span === 3 ? 'col-span-12' : span === 2 ? 'col-span-12 md:col-span-8' : 'col-span-12 sm:col-span-6 md:col-span-4';
  return (
    <div className={colCls}>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">
        {label}
      </div>
      <div
        className={[
          'break-words leading-snug',
          mono ? 'font-mono text-[12px] tabular-nums' : 'font-sans text-[13px]',
          accent
            ? 'text-fx-brass'
            : display === '—'
              ? 'text-fx-dust'
              : 'text-fx-sand',
        ].join(' ')}
      >
        {display}
      </div>
    </div>
  );
}

/* ─── Section heading — small, quiet ───────────────────────────── */
function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 border-b border-fx-rule">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-fx-dust">
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────── */

const CustomerProfile = () => {
  const { profile, loading, error } = useCustomerProfile();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center gap-3">
        <RefreshCw size={14} className="animate-spin text-fx-brass" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fx-dust">
          Loading profile
        </span>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-md mx-auto mt-16 border border-fx-rust/30 bg-fx-rust/5 p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust mb-2">
          Error
        </div>
        <p className="font-sans text-[13px] text-fx-dune">
          {error || 'Profile could not be loaded.'}
        </p>
      </div>
    );
  }

  const primaryStatus = getPrimaryStatus(profile);
  const approved = isCustomerApprovedForAccess(profile);
  const rejected = isCustomerRejected(profile);
  const withdrawn = isCustomerWithdrawn(profile);
  const finalPending = isCustomerFinalApprovalPending(profile);
  const inProgress = isCustomerInProgress(profile);

  const firstName = profile.firstName || '';
  const lastName = profile.lastName || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Member';
  const initials = ((firstName[0] || '') + (lastName[0] || 'M')).toUpperCase();

  const showVerifyCta = !approved;
  const ctaLabel = rejected
    ? 'Retry verification'
    : withdrawn
      ? 'Restart verification'
      : finalPending
        ? 'View verification status'
        : inProgress
          ? 'Continue verification'
          : 'Start verification';
  const ctaCaption = rejected
    ? 'Application declined'
    : withdrawn
      ? 'Application withdrawn'
      : finalPending
        ? 'Awaiting compliance sign-off'
        : inProgress
          ? 'Verification in progress'
          : 'Trading unlocks after CDD clearance';

  const periodicReviewActive = !!profile.activePeriodicReviewCycleId;
  const prrStatus = String(
    profile.activePeriodicReviewCycle?.status || '',
  )
    .trim()
    .toUpperCase();

  return (
    <div className="space-y-10">
      {/* ── Compliance banners ─────────────────────────────────── */}
      <ProfileBannerStack />

      {/* ── Compact header ─────────────────────────────────────── */}
      <header>
        <div className="flex items-start gap-5">
          <div className="shrink-0 w-14 h-14 border border-fx-brass/40 bg-fx-brass/5 flex items-center justify-center">
            <span className="font-mono text-[16px] text-fx-brass font-medium leading-none">
              {initials}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            {/* The only Fraunces usage on this page — name only, 28px */}
            <h1 className="fx-display font-light text-[28px] leading-tight text-fx-sand break-words">
              {fullName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[9px] uppercase tracking-[0.14em] ${statusTone(
                  primaryStatus,
                )}`}
              >
                <span className="w-[3px] h-[3px] rounded-full bg-current" />
                {primaryStatus.replace(/_/g, ' ')}
              </span>
              <span className="font-mono text-[10px] text-fx-dust uppercase tracking-[0.12em]">
                {profile.customerType || 'INDIVIDUAL'}
              </span>
              <span className="font-mono text-[10px] text-fx-dust whitespace-nowrap">
                Member since {fmtDate(profile.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* CTA row — own line so the name isn't squeezed */}
        {showVerifyCta && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate('/verification')}
              className="fx-btn-primary"
            >
              {ctaLabel} →
            </button>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-dust/70">
              {ctaCaption}
            </span>
          </div>
        )}
      </header>

      {/* ── Periodic review banner ─────────────────────────────── */}
      {periodicReviewActive && (
        <div className="border-l-2 border-fx-brass bg-fx-brass/[0.03] px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-brass mb-1">
              Periodic review active
            </div>
            <p className="font-sans text-[12px] text-fx-dune leading-snug">
              {prrStatus === 'REJECTED'
                ? 'Periodic review was rejected. Trading restrictions remain in place until compliance resolves the cycle.'
                : prrStatus === 'EDD_UNDER_REVIEW'
                  ? 'Your periodic review EDD submission is under compliance review.'
                  : prrStatus === 'CDD_UNDER_REVIEW'
                    ? 'Your periodic review CDD submission is under compliance review.'
                    : prrStatus === 'PENDING_EDD_INPUT'
                      ? 'Additional EDD information is required for your periodic review.'
                      : 'Periodic review is active. Complete the required response to continue.'}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[10px] text-fx-dust tabular-nums">
              {profile.activePeriodicReviewCycle?.cycleNo && (
                <span>Cycle {profile.activePeriodicReviewCycle.cycleNo}</span>
              )}
              {prrStatus && <span>Status {prrStatus}</span>}
              {profile.nextReviewAt && (
                <span>Next {fmtDate(profile.nextReviewAt)}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => navigate('/verification')}
            className="shrink-0 fx-btn-ghost"
          >
            Open review
          </button>
        </div>
      )}

      {/* ── Identity ───────────────────────────────────────────── */}
      <section>
        <SectionTitle>Identity</SectionTitle>
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
          <Row label="First name" value={profile.firstName} />
          <Row label="Last name" value={profile.lastName} />
          <Row label="Customer type" value={profile.customerType} />
          <Row label="Email" value={profile.email} mono span={2} />
          <Row label="Phone" value={profile.phone} mono />
          <Row label="Member since" value={fmtDate(profile.createdAt)} mono />
          <Row label="Last login" value={fmt(profile.lastLoginAt)} mono />
        </div>
      </section>

      {/* ── Compliance lifecycle ───────────────────────────────── */}
      <section>
        <SectionTitle>Compliance lifecycle</SectionTitle>
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
          <Row
            label="Onboarding"
            value={
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.14em] ${statusTone(
                  String(profile.onboardingStatus || 'NONE').toUpperCase(),
                )}`}
              >
                <span className="w-[3px] h-[3px] rounded-full bg-current" />
                {String(profile.onboardingStatus || 'NONE').replace(/_/g, ' ')}
              </span>
            }
          />
          <Row
            label="Admin status"
            value={
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.14em] ${statusTone(
                  String(profile.adminStatus || 'INACTIVE').toUpperCase(),
                )}`}
              >
                <span className="w-[3px] h-[3px] rounded-full bg-current" />
                {String(profile.adminStatus || 'INACTIVE').replace(/_/g, ' ')}
              </span>
            }
          />
          <Row
            label="Restrictions"
            value={
              Array.isArray(profile.restrictions) && profile.restrictions.length > 0
                ? profile.restrictions.join(', ')
                : 'NONE'
            }
            mono
          />
          <Row
            label="Compliance status"
            value={
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.14em] ${statusTone(
                  String(profile.complianceStatus || 'CLEAR').toUpperCase(),
                )}`}
              >
                <span className="w-[3px] h-[3px] rounded-full bg-current" />
                {String(profile.complianceStatus || 'CLEAR').replace(/_/g, ' ')}
              </span>
            }
          />
          <Row label="Risk rating" value={profile.riskRating} mono />
          <Row label="EDD required" value={profile.eddRequired ? 'YES' : 'NO'} mono />
          <Row
            label="Investor tier"
            value={profile.investorTier || 'STANDARD'}
          />
          <Row
            label="CDD document expires"
            value={fmt(profile.cddDocumentExpiresAt)}
            mono
          />
        </div>
      </section>

      {/* ── Verification snapshot ──────────────────────────────── */}
      <section>
        <SectionTitle>
          Verification
          <span className="ml-2 text-fx-dust/60 normal-case tracking-normal font-sans text-[11px]">
            (Sumsub)
          </span>
        </SectionTitle>
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
          <Row label="Provider" value="Sumsub" />
          <Row
            label="Substatus"
            value={
              finalPending
                ? 'AWAITING FINAL APPROVAL'
                : inProgress
                  ? 'IN PROGRESS'
                  : rejected
                    ? 'REJECTED'
                    : approved
                      ? 'COMPLETED'
                      : 'NOT STARTED'
            }
            mono
          />
          <Row
            label="Onboarding status"
            value={String(profile.onboardingStatus || 'NONE').toUpperCase()}
            mono
          />
        </div>

        <button
          onClick={() => navigate('/verification')}
          className="mt-5 w-full max-w-xl flex items-center justify-between gap-3 border border-fx-rule bg-fx-ink/40 px-4 py-3 text-left transition-colors hover:border-fx-brass/50 hover:bg-fx-brass/[0.03] group"
        >
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust mb-0.5">
              {approved ? 'Verification history' : ctaLabel}
            </div>
            <div className="font-sans text-[12px] text-fx-dune truncate">
              {approved
                ? 'View the full Sumsub webhook timeline attached to your account.'
                : 'Open the verification flow to continue the journey.'}
            </div>
          </div>
          <ArrowRight size={13} className="text-fx-brass shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </section>

      {/* ── Audit & retention ──────────────────────────────────── */}
      <section>
        <SectionTitle>Audit &amp; retention</SectionTitle>
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
          <Row label="Retention period" value="8 years" mono accent />
          <Row label="Governing rulebook" value="CRM Rulebook Part F" mono />
          <Row label="Data protection" value="UAE Federal PDPL" mono />
          <Row label="DPO contact" value="dpo@fiatx.ae" mono />
          <Row label="Member identifier" value={profile.id} mono span={3} />
        </div>
        <p className="mt-4 font-sans text-[12px] text-fx-dust/70 leading-relaxed max-w-2xl">
          You may request a copy of all personal data held about you at any time by emailing{' '}
          <span className="text-fx-brass">dpo@fiatx.ae</span>. Requests are answered within
          thirty days under the UAE Federal Personal Data Protection Law.
        </p>
      </section>
    </div>
  );
};

export default CustomerProfile;
