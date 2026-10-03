import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import { useTierUpgrade, type TierUpgradeOverview } from '../hooks/useTierUpgrade';
import { customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';
import { ProfileBannerStack } from '../components/ProfileBannerStack';
import {
  isCustomerApprovedForAccess,
  isCustomerFinalApprovalPending,
  isCustomerInProgress,
  isCustomerRejected,
  isCustomerWithdrawn,
  normalizeLifecycle,
} from '../utils/customerOnboarding';

/* ────────────────────────────────────────────────────────────────
 *  Profile — FIATX Terminal dialect.
 *  Compact dossier. All fields on a single screen. The only piece
 *  of Fraunces is the member's name at 28px. Everything else is
 *  IBM Plex Sans / Mono. No oversized numerals, no `§` ornament.
 * ──────────────────────────────────────────────────────────────── */

type ProfileLike = ReturnType<typeof useCustomerProfile>['profile'];

/** 档位升级在途单 stage → 文案（Task 10 brief）。 */
const STAGE_COPY: Record<
  NonNullable<TierUpgradeOverview['application']>['stage'],
  string
> = {
  SUBMIT_MATERIALS: 'Upgrade started — submit your documents',
  UNDER_REVIEW: 'Documents under review',
  PENDING_DECISION: 'Awaiting final decision',
  APPROVED: 'Upgrade approved — you are now on Premium.',
  REJECTED: 'Upgrade declined — you may apply again',
};

function getPrimaryStatus(profile: NonNullable<ProfileLike>) {
  // 徽章 = lifecycle，唯一例外是有「可告知」限制时压成 RESTRICTED。
  // SILENT 便签不在 disclosed 里，被制裁客户这里恒等于 ACTIVE（tipping-off）。
  const lifecycle = normalizeLifecycle(profile.lifecycle) ?? 'PROSPECT';
  if (lifecycle === 'ACTIVE' && profile.disclosed.length > 0) return 'RESTRICTED';
  return lifecycle;
}

function statusTone(status: string) {
  if (status === 'ACTIVE') return 'text-fx-sage border-fx-sage/30 bg-fx-sage/5';
  if (status === 'REJECTED' || status === 'WITHDRAWN' || status === 'OFFBOARDED')
    return 'text-fx-rust border-fx-rust/30 bg-fx-rust/5';
  if (status === 'PENDING_APPROVAL' || status === 'RESTRICTED')
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

/* ─── Phone row with inline edit (丙波四 T9) ───────────────────────
 *  Phone is the only identity field a customer edits themselves (PATCH /client/me/phone).
 *  It is also a sign-in identifier, so the helper line says so. 409 (number held by another
 *  account) surfaces the server's message in place. The "saved" notice lives in the parent:
 *  refreshProfile() flips the page to its loading state, which remounts this row.
 * ──────────────────────────────────────────────────────────────── */
function PhoneRow({
  phone,
  saved,
  onEditStart,
  onSaved,
}: {
  phone?: string | null;
  saved: boolean;
  onEditStart: () => void;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft(phone ?? '');
    setError('');
    setEditing(true);
    onEditStart();
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/phone`, {
        method: 'PATCH',
        body: JSON.stringify({ phone: draft }),
      });
      if (!res.ok) {
        setError(await getCustomerApiErrorMessage(res, 'Could not update your phone number.'));
        return;
      }
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const unchanged = draft.trim() === (phone ?? '');
  const colCls = editing ? 'col-span-12 md:col-span-8' : 'col-span-12 sm:col-span-6 md:col-span-4';

  return (
    <div className={colCls}>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">Phone</div>
      {editing ? (
        <div>
          <input
            type="tel"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving && draft.trim() && !unchanged) void save();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label="Phone number"
            className="fx-input font-mono text-[12px] tabular-nums max-w-xs"
          />
          <p className="mt-2 font-sans text-[11px] text-fx-dust/80 leading-snug max-w-md">
            This number is also a sign-in identifier — once saved, you can sign in with the new one.
          </p>
          {error && <p className="mt-2 font-mono text-[11px] text-fx-rust">{error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void save()}
              disabled={saving || !draft.trim() || unchanged}
              className="fx-btn-primary !px-4 !py-2"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving} className="fx-btn-ghost !px-4 !py-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline gap-3">
            <span
              className={`break-words leading-snug font-mono text-[12px] tabular-nums ${phone ? 'text-fx-sand' : 'text-fx-dust'}`}
            >
              {phone || '—'}
            </span>
            <button
              onClick={startEdit}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-brass hover:text-fx-ember transition-colors"
            >
              {phone ? 'Change' : 'Add'}
            </button>
          </div>
          {saved && (
            <p className="mt-2 font-mono text-[11px] text-fx-sage">
              Phone number updated — you can now sign in with it.
            </p>
          )}
        </div>
      )}
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
  const { profile, loading, error, refreshProfile } = useCustomerProfile();
  const { data: tier } = useTierUpgrade();
  const navigate = useNavigate();
  const [phoneSaved, setPhoneSaved] = useState(false);

  const applyForUpgrade = async () => {
    const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/tier-upgrade/apply`, {
      method: 'POST',
    });
    if (r.ok) navigate('/tier-upgrade/verify');
  };

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
  const lifecycle = normalizeLifecycle(profile.lifecycle) ?? 'PROSPECT';
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
      {/* 波三G（业主 2026-09-12 横幅矩阵，推翻 2026-08-18 G6）：本页不挂
          <PendingActionBanner />——绑了条子的材料行已并进 RestrictionBanner
          的条子形态，单独材料（无单无条子）与条子行统一收拢进
          ProfileBannerStack（Overview 页同款）。PendingActionBanner 现在只留给
          Deposit/Withdraw 页，渲染「没绑条子、绑了本域订单」的材料行——那类行
          不在 ProfileBannerStack 的范围里。 */}

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
          <PhoneRow
            phone={profile.phone}
            saved={phoneSaved}
            onEditStart={() => setPhoneSaved(false)}
            onSaved={async () => {
              setPhoneSaved(true);
              await refreshProfile();
            }}
          />
          <Row label="Member since" value={fmtDate(profile.createdAt)} mono />
          <Row label="Last login" value={fmt(profile.lastLoginAt)} mono />
        </div>
      </section>

      {/* ── Compliance lifecycle ───────────────────────────────── */}
      <section>
        <SectionTitle>Compliance lifecycle</SectionTitle>
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
          <Row
            label="Lifecycle"
            value={
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.14em] ${statusTone(
                  lifecycle,
                )}`}
              >
                <span className="w-[3px] h-[3px] rounded-full bg-current" />
                {lifecycle.replace(/_/g, ' ')}
              </span>
            }
          />
          <Row label="Risk rating" value={profile.riskRating} mono />
          <Row label="EDD required" value={profile.eddRequired ? 'YES' : 'NO'} mono />
        </div>
      </section>

      {/* ── Trading tier ────────────────────────────────────────── */}
      {lifecycle === 'ACTIVE' && (
        <section>
          <SectionTitle>Trading tier</SectionTitle>
          <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
            <Row label="Current tier" value={tier?.tradingTier ?? profile.tradingTier} mono accent />
          </div>
          {tier && tier.limits.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full max-w-xl text-left font-mono text-[11px] text-fx-dune">
                <thead><tr className="text-fx-dust uppercase tracking-[0.12em] text-[9px]">
                  <th className="py-1 pr-4">Cumulative limit (AED)</th><th className="py-1 pr-4">Basic</th><th className="py-1">Premium</th>
                </tr></thead>
                <tbody>
                  {tier.limits.map((l) => (
                    <tr key={`${l.operationType}-${l.period}`} className="border-t border-fx-rule">
                      <td className="py-1.5 pr-4">{l.operationType} · {l.period}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{l.basicLimit ?? '—'}</td>
                      <td className="py-1.5 tabular-nums text-fx-brass">{l.premiumLimit ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-5">
            {tier?.application?.stage === 'REJECTED' && (
              <span className="mr-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust">
                {STAGE_COPY.REJECTED}
              </span>
            )}
            {tier?.canApply ? (
              <button onClick={() => void applyForUpgrade()} className="fx-btn-primary">
                Upgrade to Premium →
              </button>
            ) : tier?.application && tier.application.stage !== 'REJECTED' ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-brass">
                {STAGE_COPY[tier.application.stage]}
              </span>
            ) : null}
            {tier?.application?.stage === 'SUBMIT_MATERIALS' && (
              <button onClick={() => navigate('/tier-upgrade/verify')} className="ml-3 fx-btn-ghost">Continue</button>
            )}
          </div>
        </section>
      )}

      {/* ── Current restrictions ───────────────────────────────── */}
      {/* 只列 disclosed —— SILENT 便签后端根本不下发。空则整节隐藏：一行
          "Restrictions  NONE" 对被制裁客户就是一个可对比的信号面，不留。 */}
      {profile.disclosed.length > 0 && (
        <section>
          <SectionTitle>
            Current restrictions
            <span className="ml-2 text-fx-dust/60 normal-case tracking-normal font-sans text-[11px]">
              ({profile.disclosed.length})
            </span>
          </SectionTitle>
          <div className="pt-5 space-y-3">
            {profile.disclosed.map((row) => (
              <div
                key={row.restrictionNo}
                className="border-l-2 border-fx-rust/60 bg-fx-rust/[0.03] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust">
                    {row.label}
                  </span>
                  <span className="font-mono text-[10px] text-fx-dust tabular-nums">
                    {row.scopes.join(' · ')}
                  </span>
                  <span className="font-mono text-[10px] text-fx-dust tabular-nums">
                    Since {fmtDate(row.openedAt)}
                  </span>
                </div>
                <p className="mt-1.5 font-sans text-[12px] text-fx-dune leading-snug break-words">
                  {row.reason}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

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
          <Row label="Member identifier" value={profile.customerNo} mono span={3} />
        </div>
        <p className="mt-4 font-sans text-[12px] text-fx-dust/70 leading-relaxed max-w-2xl">
          You may request a copy of all personal data held about you at any time by emailing{' '}
          <span className="text-fx-brass">dpo@fiatx.ae</span>. Requests are answered within
          thirty days under the UAE Federal Personal Data Protection Law.
        </p>
        <button
          onClick={() => navigate('/data-requests')}
          className="mt-4 w-full max-w-xl flex items-center justify-between gap-3 border border-fx-rule bg-fx-ink/40 px-4 py-3 text-left transition-colors hover:border-fx-brass/50 hover:bg-fx-brass/[0.03] group"
        >
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust mb-0.5">
              Submit a data request
            </div>
            <div className="font-sans text-[12px] text-fx-dune truncate">
              Ask for a copy of your data, a correction, or deletion — and track the answer.
            </div>
          </div>
          <ArrowRight size={13} className="text-fx-brass shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </section>
    </div>
  );
};

export default CustomerProfile;
