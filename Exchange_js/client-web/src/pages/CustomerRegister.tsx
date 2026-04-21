import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────
 *  Open account — FIATX
 *  Mirrors the backend Zod schema 1:1 (customer-auth.controller.ts):
 *    email      (required)
 *    password   (required, min 6)
 *    firstName  (optional)
 *    lastName   (optional)
 *    customerType = 'INDIVIDUAL'  (only option today)
 *
 *  The acceptTerms checkbox is a client-side gate only; the backend
 *  does not yet persist termsAcceptedAt (see
 *  docs/cleanup/deferred-refactors.md for the deferred work).
 * ──────────────────────────────────────────────────────────────── */

const MASTHEAD = ['F', 'I', 'A', 'T', 'X'];

function MiniMasthead() {
  return (
    <Link to="/" className="inline-flex items-end gap-1.5">
      {MASTHEAD.map((l, i) => (
        <span key={i} className="inline-flex items-end">
          <span className="fx-display font-light text-[22px] leading-none text-fx-sand">{l}</span>
          {i < MASTHEAD.length - 1 && (
            <span className="w-[3px] h-[3px] rounded-full bg-fx-brass mx-2 mb-[0.25em] shrink-0" />
          )}
        </span>
      ))}
    </Link>
  );
}

const MIN_PASSWORD_LENGTH = 6;

/* ─── Terms & data protection content (client-side) ─────────────── */

type Section = {
  no: string;
  title: string;
  body: string[];
};

const TERMS_SECTIONS: Section[] = [
  {
    no: 'I',
    title: 'About FIATX',
    body: [
      'FIATX Financial Services Ltd is a virtual asset service provider licensed in Dubai by the Virtual Assets Regulatory Authority ("VARA") as a Category 2 VASP. The services described in these terms are provided under VARA Rulebook authorisation, and are governed exclusively by the laws of the Dubai International Financial Centre and the supervision of VARA.',
      'By opening an individual account, you are entering into a contract with FIATX. These terms, together with the Privacy Notice that appears as Part II of this document, form the entire agreement between you and us.',
    ],
  },
  {
    no: 'II',
    title: 'Eligibility & Identity Verification',
    body: [
      'You must be at least 21 years of age, a natural person acting on your own behalf, and not a resident of a sanctioned jurisdiction. We may decline any application at our sole discretion, including in response to risk signals from our sanctions and adverse-media screening providers.',
      'Customer due diligence is performed under VARA Compliance and Risk Management Rulebook Part D. Level-1 verification is required for every account; Level-2 (enhanced due diligence) is required for politically exposed persons, large inbound transfers, and accounts flagged by our risk engine.',
    ],
  },
  {
    no: 'III',
    title: 'Accepted Activities',
    body: [
      'You may use FIATX to: (a) convert UAE dirhams into supported virtual assets and back, (b) hold balances in the safeguarded client-asset account, and (c) instruct on-chain and domestic IBAN payouts subject to our travel-rule and sanctions-screening procedures.',
      'You may not use FIATX to: (a) move funds for any third party, (b) structure transactions to avoid reporting thresholds, (c) interact with services appearing on the OFAC, EU or UN consolidated sanctions lists, or (d) any activity prohibited by the FATF Recommendations.',
    ],
  },
  {
    no: 'IV',
    title: 'Fees, Settlement & Client Money',
    body: [
      'All applicable fees and spreads are published on our fee schedule and are updated with 14 days\' written notice. Settlement windows for dirham-denominated transactions are intraday (T+0) subject to UAE banking cut-off times.',
      'Client money is held under segregated safeguarding arrangements at VARA-approved banking partners. Daily reconciliation and monthly statement warehousing are performed under CRM Rulebook Part F. We do not rehypothecate client assets.',
    ],
  },
  {
    no: 'V',
    title: 'Liability & Dispute Resolution',
    body: [
      'Our liability to you is limited to direct losses caused by our own negligence or wilful default. We are not liable for losses arising from price movement, third-party custodians, network outages, or instructions we execute in accordance with your account authentication.',
      'Disputes are resolved through the VARA complaints procedure followed by arbitration under the DIFC-LCIA Arbitration Rules, seated in Dubai, conducted in English. Nothing in this clause limits your statutory rights under UAE federal consumer protection law.',
    ],
  },
  {
    no: 'VI',
    title: 'Privacy & Data Protection',
    body: [
      'Personal data is processed under the UAE Federal Personal Data Protection Law (PDPL) and CRM Rulebook Part E. Lawful bases for processing are: (i) performance of this contract, (ii) compliance with our regulatory obligations as a VASP, and (iii) legitimate interests in preventing financial crime.',
      'Categories of data collected: identity documents, biometric data (liveness video), transaction metadata, device and IP data, and communications with our support team. We retain these records for eight years after the end of our relationship, as required by the CRM Rulebook.',
      'Your rights: access, rectification, erasure (subject to retention obligations), portability, and objection to processing not based on consent. Data subject requests are handled by our Data Protection Officer at dpo@fiatx.ae within 30 days.',
    ],
  },
  {
    no: 'VII',
    title: 'How to Contact Us',
    body: [
      'Operations and account support: support@fiatx.ae · Compliance and MLRO: compliance@fiatx.ae · Data protection enquiries: dpo@fiatx.ae · Registered office: Level 41, Emirates Towers, Sheikh Zayed Road, Dubai.',
      'A printable PDF of these terms is available on request. We will notify you of any material change to these terms at least 14 days before the change takes effect.',
    ],
  },
];

/* ─── The Terms Drawer — the interaction ──────────────────────── */

function TermsDrawer({
  open,
  onClose,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeSection, setActiveSection] = useState('I');
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  // Esc key closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setProgress(0);
      setActiveSection('I');
      setHasScrolledToBottom(false);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [open]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const max = Math.max(scrollHeight - clientHeight, 1);
    const pct = Math.min(100, Math.max(0, (scrollTop / max) * 100));
    setProgress(pct);
    if (pct >= 98) setHasScrolledToBottom(true);

    // Determine active section from section offsets
    const sections = el.querySelectorAll<HTMLElement>('[data-section]');
    let currentId = 'I';
    sections.forEach((s) => {
      if (s.offsetTop - scrollTop <= 120) {
        currentId = s.dataset.section || currentId;
      }
    });
    setActiveSection(currentId);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-fx-obsidian/80 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.aside
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-[640px] lg:w-[780px] bg-fx-ink border-l border-fx-rule flex flex-col shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.6)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terms-drawer-title"
          >
            {/* ── Header — masthead of a legal document ───────── */}
            <header className="shrink-0 border-b border-fx-rule px-8 md:px-12 pt-10 pb-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="fx-cap mb-3">§ Legal instrument</div>
                  <h2
                    id="terms-drawer-title"
                    className="fx-display font-light text-[36px] md:text-[44px] leading-[0.95] text-fx-sand"
                  >
                    Terms &amp; Data
                    <br />
                    <span className="italic fx-serif text-fx-brass">Protection Notice.</span>
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 p-2 text-fx-dust hover:text-fx-brass transition-colors"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Byline row */}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-fx-dust">
                <span className="fx-cap">Issued · 2025.IV · Dubai, UAE</span>
                <span className="fx-cap">Effective from signup</span>
                <span className="fx-cap">Version 1.0</span>
              </div>

              {/* Reading progress bar — hairline */}
              <div className="mt-8 relative h-[2px] bg-fx-rule">
                <motion.div
                  className="absolute top-0 left-0 h-full bg-fx-brass"
                  style={{ width: `${progress}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="fx-cap text-fx-dust/70">
                  Reading progress · {Math.round(progress)}%
                </span>
                <span className="fx-cap text-fx-brass">§ {activeSection}</span>
              </div>
            </header>

            {/* ── Scrollable body ───────────────────────────────── */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-8 md:px-12 py-10"
            >
              <div className="space-y-12 max-w-2xl">
                {TERMS_SECTIONS.map((section) => (
                  <section
                    key={section.no}
                    data-section={section.no}
                    className="scroll-mt-6"
                  >
                    <div className="flex items-baseline gap-6 mb-6 pb-4 border-b border-fx-rule">
                      <span className="fx-display font-light text-[40px] leading-none text-fx-brass/60 tabular-nums">
                        {section.no}
                      </span>
                      <h3 className="fx-display text-[22px] leading-tight text-fx-sand">
                        {section.title}
                      </h3>
                    </div>
                    <div className="space-y-5">
                      {section.body.map((para, i) => (
                        <p
                          key={i}
                          className="fx-serif text-[15px] leading-[1.75] text-fx-dune"
                        >
                          {para}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}

                {/* End-of-document colophon */}
                <div className="pt-8 border-t border-fx-rule">
                  <div className="fx-cap mb-2">End of document</div>
                  <p className="fx-serif italic text-[13px] text-fx-dust/70 leading-relaxed">
                    Issued by FIATX Financial Services Ltd · VARA VASP No. 2025/DXB-•••• ·
                    Level 41, Emirates Towers, Dubai · A printable copy is available at
                    dpo@fiatx.ae on request.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Footer — gated accept ────────────────────────── */}
            <footer className="shrink-0 border-t border-fx-rule px-8 md:px-12 py-6 bg-fx-charcoal/40">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="fx-cap text-fx-dust/80 max-w-xs">
                  {hasScrolledToBottom
                    ? 'Document read in full. You may accept or close.'
                    : 'Please scroll to the end of the document to accept.'}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="fx-btn-ghost"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={onAccept}
                    disabled={!hasScrolledToBottom}
                    className="fx-btn-primary"
                  >
                    Accept &amp; continue →
                  </button>
                </div>
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─── Page ─────────────────────────────────────────────────────── */

const CustomerRegister = () => {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirm: '',
    acceptTerms: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (formData.password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!formData.acceptTerms) {
      setError('Please read and accept the Terms & Data Protection Notice to continue.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/auth/customer/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email.trim(),
            password: formData.password,
            customerType: 'INDIVIDUAL',
            firstName: formData.firstName.trim() || undefined,
            lastName: formData.lastName.trim() || undefined,
            // TODO(backend): persist termsAcceptedAt when the register endpoint
            // is extended. Currently the column exists on customer_main but is
            // not written. See docs/cleanup/deferred-refactors.md.
          }),
        },
      );

      if (response.ok) {
        navigate('/login');
      } else {
        const err = await response.json().catch(() => ({}));
        setError(
          typeof err?.message === 'string' && err.message
            ? err.message
            : 'Registration failed.',
        );
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateField = (patch: Partial<typeof formData>) =>
    setFormData((prev) => ({ ...prev, ...patch }));

  return (
    <div className="min-h-screen bg-fx-obsidian text-fx-sand flex flex-col">
      {/* ── Slim header ──────────────────────────────────────── */}
      <header className="border-b border-fx-rule">
        <div className="mx-auto max-w-[1400px] px-6 md:px-10 h-[72px] flex items-center justify-between">
          <MiniMasthead />
          <div className="flex items-center gap-8">
            <span className="hidden sm:inline fx-cap">Open an account</span>
            <Link to="/login" className="fx-btn-ghost">Sign in</Link>
          </div>
        </div>
      </header>

      {/* ── Body — editorial two-column ──────────────────────── */}
      <main className="flex-1">
        <div className="mx-auto max-w-[1400px] px-6 md:px-10 grid grid-cols-12 gap-x-6 md:gap-x-10 pt-16 md:pt-24 pb-20">
          {/* ── Left: editorial gutter with onboarding path ── */}
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.9, ease: [0.19, 1, 0.22, 1] }}
            className="hidden lg:flex lg:col-span-5 xl:col-span-6 flex-col justify-between lg:pr-16 lg:border-r lg:border-fx-rule min-h-[640px]"
          >
            <div>
              <div className="fx-cap mb-8">§ Account application</div>
              <h1 className="fx-display font-light text-[72px] xl:text-[92px] leading-[0.9] text-fx-sand">
                Become a
                <br />
                <span className="italic fx-serif text-fx-brass">member.</span>
              </h1>
              <p className="mt-8 fx-serif text-[16px] leading-[1.7] text-fx-dune max-w-md">
                Individual accounts open in three minutes. Identity verification happens on your
                phone, in your own time, through Sumsub — our VARA-approved KYC partner.
              </p>
            </div>

            {/* Onboarding timeline — editorial list with rule dots */}
            <div className="mt-12 space-y-0">
              {[
                {
                  no: 'I',
                  title: 'Register',
                  body: 'Email, password, full name. 30 seconds.',
                  state: 'active',
                },
                {
                  no: 'II',
                  title: 'Identity verification',
                  body: 'Document capture and liveness check via Sumsub.',
                  state: 'next',
                },
                {
                  no: 'III',
                  title: 'Compliance review',
                  body: 'Our MLRO signs off where regulation requires a human.',
                  state: 'next',
                },
                {
                  no: 'IV',
                  title: 'Account active',
                  body: 'Your member ledger opens. Funds accepted in AED.',
                  state: 'next',
                },
              ].map((step) => (
                <div
                  key={step.no}
                  className="grid grid-cols-12 gap-4 py-5 border-t border-fx-rule last:border-b"
                >
                  <div
                    className={`col-span-2 fx-display font-light text-[32px] leading-none ${
                      step.state === 'active' ? 'text-fx-brass' : 'text-fx-dust/40'
                    }`}
                  >
                    {step.no}
                  </div>
                  <div className="col-span-10">
                    <div
                      className={`font-mono text-[11px] uppercase tracking-[0.16em] mb-1 ${
                        step.state === 'active' ? 'text-fx-sand' : 'text-fx-dust'
                      }`}
                    >
                      {step.title}
                    </div>
                    <div className="fx-serif text-[13px] text-fx-dune/80 leading-relaxed">
                      {step.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.aside>

          {/* ── Right: the form ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.9, ease: [0.19, 1, 0.22, 1] }}
            className="col-span-12 lg:col-span-7 xl:col-span-6 lg:pl-16"
          >
            {/* Mobile header */}
            <div className="lg:hidden mb-10">
              <div className="fx-cap mb-4">§ Account application</div>
              <h1 className="fx-display font-light text-[48px] leading-[0.95] text-fx-sand">
                Become a <span className="italic text-fx-brass">member.</span>
              </h1>
            </div>

            {/* Locked customer-type badge — explicit, not a useless dropdown */}
            <div className="mb-10 border border-fx-rule px-4 py-3 flex items-center justify-between">
              <div>
                <div className="fx-cap mb-0.5">Customer type</div>
                <div className="font-mono text-[13px] text-fx-sand">Individual</div>
              </div>
              <div className="fx-cap text-fx-dust/80">
                Corporate · by invitation only
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 border-l-2 border-fx-rust bg-fx-rust/5 px-4 py-3 font-mono text-[11px] text-fx-rust"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* ── First + Last name ──────────────────────── */}
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="fx-cap block mb-3">First name</label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => updateField({ firstName: e.target.value })}
                    placeholder="Given name"
                    className="fx-input"
                    maxLength={60}
                  />
                </div>
                <div>
                  <label className="fx-cap block mb-3">Last name</label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => updateField({ lastName: e.target.value })}
                    placeholder="Family name"
                    className="fx-input"
                    maxLength={60}
                  />
                </div>
              </div>

              {/* ── Email ──────────────────────────────────── */}
              <div>
                <label className="fx-cap block mb-3">Email address</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => updateField({ email: e.target.value })}
                  placeholder="name@example.com"
                  className="fx-input"
                />
              </div>

              {/* ── Password (own row) ─────────────────────── */}
              <div>
                <label className="fx-cap block mb-3">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={formData.password}
                    onChange={(e) => updateField({ password: e.target.value })}
                    placeholder="At least 6 characters"
                    className="fx-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-3 text-fx-dust hover:text-fx-brass transition-colors"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* ── Confirm password (own row) ─────────────── */}
              <div>
                <label className="fx-cap block mb-3">Confirm password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={formData.confirm}
                    onChange={(e) => updateField({ confirm: e.target.value })}
                    placeholder="Re-enter the password"
                    className="fx-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-0 top-3 text-fx-dust hover:text-fx-brass transition-colors"
                    aria-label="Toggle confirm password visibility"
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* ── Terms acceptance card — opens drawer ────── */}
              <div className="pt-2">
                <div
                  className={`border p-4 transition-colors ${
                    formData.acceptTerms
                      ? 'border-fx-brass/40 bg-fx-brass/[0.03]'
                      : 'border-fx-rule'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="pt-[3px]">
                      {formData.acceptTerms ? (
                        <div className="w-[14px] h-[14px] border border-fx-brass bg-fx-brass flex items-center justify-center">
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 10 10"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M1 5L4 8L9 2"
                              stroke="#0B0908"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      ) : (
                        <div className="w-[14px] h-[14px] border border-fx-rule-strong" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="fx-cap mb-1">
                        {formData.acceptTerms ? 'Accepted' : 'Required'}
                      </div>
                      <p className="fx-serif text-[13px] leading-[1.6] text-fx-dune">
                        I have read and accept the{' '}
                        <button
                          type="button"
                          onClick={() => setDrawerOpen(true)}
                          className="text-fx-brass hover:text-fx-ember underline underline-offset-2 decoration-fx-brass/40 hover:decoration-fx-ember transition-colors"
                        >
                          Terms of Service &amp; Data Protection Notice
                        </button>
                        , and I confirm the details above are my own.
                      </p>
                      {!formData.acceptTerms && (
                        <button
                          type="button"
                          onClick={() => setDrawerOpen(true)}
                          className="mt-3 fx-cap text-fx-brass hover:text-fx-ember transition-colors"
                        >
                          Read &amp; accept →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Submit ─────────────────────────────────── */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isLoading || !formData.acceptTerms}
                  className="fx-btn-primary w-full"
                >
                  {isLoading ? (
                    <>
                      <span className="w-3 h-3 border border-fx-obsidian border-t-transparent rounded-full animate-spin" />
                      Submitting application
                    </>
                  ) : (
                    <>Open an account →</>
                  )}
                </button>
              </div>
            </form>

            {/* ── Footer links ───────────────────────────── */}
            <div className="mt-14 pt-6 border-t border-fx-rule flex items-center justify-between">
              <span className="fx-cap text-fx-dust">Already a member?</span>
              <Link
                to="/login"
                className="fx-cap text-fx-brass hover:text-fx-ember transition-colors"
              >
                Sign in →
              </Link>
            </div>

            {/* ── Regulatory watermark ─────────────────── */}
            <div className="mt-20 pt-6 border-t border-fx-rule">
              <div className="font-mono text-[10px] leading-relaxed text-fx-dust/70 tracking-wider">
                VARA VASP · LICENCE No. 2025/DXB-••••
                <br />
                Personal data is processed under CRM Rulebook 14 and retained for 8 years.
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* ── Terms drawer (render at root for stacking) ──────── */}
      <TermsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAccept={() => {
          updateField({ acceptTerms: true });
          setDrawerOpen(false);
        }}
      />
    </div>
  );
};

export default CustomerRegister;
