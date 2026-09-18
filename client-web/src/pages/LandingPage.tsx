import { useEffect, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Link } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────
 *  FIATX — Dubai virtual asset bridge
 *  Aesthetic: Desert Monolith — editorial luxury + regulated gravity
 *  Nothing here is meant to sparkle. It's meant to hold still.
 * ──────────────────────────────────────────────────────────────── */

const MASTHEAD = ['F', 'I', 'A', 'T', 'X'];

// Footnotes under each letter — a tiny editorial joke only readable up close.
const MASTHEAD_FOOTNOTES = [
  'fiat',
  'institutional',
  'AED',
  'treasury',
  'exchange',
];

const RATES = [
  { pair: 'AED / USDT',  bid: '3.6725',   delta: '+0.0012', dir: 'up' },
  { pair: 'AED / USDC',  bid: '3.6718',   delta: '+0.0008', dir: 'up' },
  { pair: 'USD / USDT',  bid: '0.9998',   delta: '−0.0002', dir: 'down' },
  { pair: 'XAU / AED',   bid: '9,842.50', delta: '+18.20',  dir: 'up' },
  { pair: 'BTC / USDT',  bid: '103,412',  delta: '+1,204',  dir: 'up' },
  { pair: 'ETH / USDT',  bid: '3,721.80', delta: '−12.40',  dir: 'down' },
  { pair: 'AED / EUR',   bid: '0.2467',   delta: '+0.0004', dir: 'up' },
  { pair: 'AED / GBP',   bid: '0.2148',   delta: '−0.0003', dir: 'down' },
];

const SERVICES = [
  {
    no: '01',
    title: 'Fiat ↔ Virtual Asset',
    kicker: 'Core settlement',
    body:
      'Two-sided dirham bridge. AED into major stable assets on T+0, institutional quoting with price-tiered spreads. Settlement rides on-shore through UAE banking rails.',
    caption: 'AED · USDT · USDC · EURT',
  },
  {
    no: '02',
    title: 'Safeguarded Custody',
    kicker: 'Client assets',
    body:
      'Segregated client balances held in VARA-approved custody arrangements, with daily reconciliation and monthly statement warehousing. Your money is a ledger entry we cannot touch.',
    caption: 'Bank-segregated · Daily recon · Monthly audit',
  },
  {
    no: '03',
    title: 'Regulated Payouts',
    kicker: 'Money movement',
    body:
      'Domestic IBAN payouts, cross-border wires and on-chain settlements — all routed through our travel-rule and sanctions-screening pipeline before a single satoshi moves.',
    caption: 'Travel rule · KYT · Sanctions screen',
  },
];

const METRICS = [
  { k: 'Settlement window',    v: 'T+0',        m: 'intraday dirham' },
  { k: 'Licence jurisdiction', v: 'Dubai · UAE', m: 'VARA VASP' },
  { k: 'Record retention',     v: '8 years',    m: 'per CRM rule 15' },
  { k: 'Custody model',        v: 'Segregated', m: 'bank + on-chain' },
];

/* ─── Live Dubai clock (Asia/Dubai, UTC+4) ──────────────────────── */
function DubaiClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const dubai = new Date(now.getTime() + (now.getTimezoneOffset() + 240) * 60_000);
  const hh = String(dubai.getHours()).padStart(2, '0');
  const mm = String(dubai.getMinutes()).padStart(2, '0');
  const ss = String(dubai.getSeconds()).padStart(2, '0');
  return (
    <span className="font-mono text-[11px] text-fx-dune tabular-nums">
      <span className="text-fx-dust mr-2">DXB</span>
      {hh}:{mm}
      <span className="text-fx-brass/60 animate-fx-pulse">:</span>
      {ss}
    </span>
  );
}

/* ─── The FIATX masthead — our signature element ───────────────── */
function Masthead({ size = 'hero' }: { size?: 'hero' | 'nav' }) {
  const letterCls =
    size === 'hero'
      ? 'fx-display font-light text-[96px] md:text-[128px] xl:text-[168px] leading-[0.85]'
      : 'fx-display font-light text-[22px] leading-none';
  const gapCls = size === 'hero' ? 'gap-3 md:gap-5' : 'gap-1.5';
  const dotCls =
    size === 'hero'
      ? 'w-[8px] h-[8px] md:w-[10px] md:h-[10px] rounded-full bg-fx-brass'
      : 'w-[3px] h-[3px] rounded-full bg-fx-brass';

  return (
    <div className={`inline-flex items-end ${gapCls}`}>
      {MASTHEAD.map((letter, i) => (
        <div key={i} className="relative flex items-end">
          <motion.span
            initial={{ y: 24, opacity: 0, rotate: -2 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            transition={{
              delay: 0.1 + i * 0.08,
              duration: 0.9,
              ease: [0.19, 1, 0.22, 1],
            }}
            className={`${letterCls} text-fx-sand inline-block`}
          >
            {letter}
          </motion.span>
          {size === 'hero' && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 + i * 0.04, duration: 0.6 }}
              className="absolute -bottom-6 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.2em] text-fx-dust whitespace-nowrap"
            >
              {MASTHEAD_FOOTNOTES[i]}
            </motion.span>
          )}
          {i < MASTHEAD.length - 1 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.4 }}
              className={`${dotCls} mx-1 md:mx-2 mb-[0.18em] shrink-0`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Top navigation — hairline border, no gloss ────────────────── */
function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-fx-rule backdrop-blur-xl bg-fx-obsidian/80">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 h-[72px] flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <Masthead size="nav" />
        </Link>

        <nav className="hidden lg:flex items-center gap-10 font-mono text-[11px] uppercase tracking-[0.18em] text-fx-dune">
          <a href="#services" className="hover:text-fx-brass transition-colors">Services</a>
          <a href="#regulation" className="hover:text-fx-brass transition-colors">Regulation</a>
          <a href="#metrics" className="hover:text-fx-brass transition-colors">Metrics</a>
          <a href="#contact" className="hover:text-fx-brass transition-colors">Contact</a>
        </nav>

        <div className="flex items-center gap-6">
          <div className="hidden md:block">
            <DubaiClock />
          </div>
          <Link to="/login" className="fx-btn-ghost">Sign in</Link>
          <Link to="/register" className="fx-btn-primary">Open account</Link>
        </div>
      </div>
    </header>
  );
}

/* ─── Rate ticker — Bloomberg chyron, sealed by a hairline ─────── */
function RateTicker() {
  const doubled = [...RATES, ...RATES];
  return (
    <div className="border-y border-fx-rule overflow-hidden bg-fx-ink/40">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
        className="flex animate-fx-scroll whitespace-nowrap py-3"
        style={{ animationDuration: '80s' }}
      >
        {doubled.map((r, i) => (
          <div key={i} className="flex items-center gap-3 px-8 shrink-0 font-mono text-[11px]">
            <span className="text-fx-dust uppercase tracking-[0.12em]">{r.pair}</span>
            <span className="text-fx-sand tabular-nums">{r.bid}</span>
            <span className={`tabular-nums ${r.dir === 'up' ? 'text-fx-sage' : 'text-fx-rust'}`}>
              {r.delta}
            </span>
            <span className="text-fx-dust/30">│</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─── Hero — asymmetric 12-col grid with watermark Roman numeral ─ */
function Hero() {
  const { scrollY } = useScroll();
  const watermarkY = useTransform(scrollY, [0, 800], [0, -120]);

  return (
    <section className="relative">
      {/* Giant Roman numeral watermark — MMXXV (2025) — parallax */}
      <motion.div
        style={{ y: watermarkY }}
        className="pointer-events-none absolute inset-0 flex items-center justify-end pr-4 md:pr-16 overflow-hidden"
      >
        <span className="fx-display-tight text-[280px] md:text-[440px] xl:text-[560px] leading-[0.8] text-fx-sand/[0.025] select-none">
          MMXXV
        </span>
      </motion.div>

      <div className="relative mx-auto max-w-[1400px] px-6 md:px-10 pt-24 md:pt-32 pb-20 md:pb-28">
        <div className="grid grid-cols-12 gap-x-6 md:gap-x-10">
          {/* ── Byline / issue number ────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.8 }}
            className="col-span-12 mb-10 md:mb-16 flex items-center gap-4 text-fx-dust"
          >
            <span className="h-[1px] w-10 bg-fx-brass" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
              Issue · 2025.IV · Dubai, UAE
            </span>
          </motion.div>

          {/* ── Masthead ─────────────────────────────────────────── */}
          <div className="col-span-12 lg:col-span-8">
            <Masthead size="hero" />
          </div>

          {/* ── Meta block (right column) ────────────────────────── */}
          <motion.aside
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1, duration: 0.9 }}
            className="col-span-12 lg:col-span-4 lg:border-l lg:border-fx-rule lg:pl-8 mt-20 lg:mt-4 space-y-6"
          >
            <div>
              <div className="fx-cap mb-2">Filed under</div>
              <div className="font-mono text-[12px] text-fx-dune leading-relaxed">
                Virtual Asset Service Provider · Category 2 · Custody &amp; Exchange
              </div>
            </div>
            <div className="h-[1px] bg-fx-rule" />
            <div>
              <div className="fx-cap mb-2">Licence</div>
              <div className="font-mono text-[12px] text-fx-sand leading-relaxed">
                Virtual Assets Regulatory Authority
                <br />
                <span className="text-fx-brass">VASP No. 2025/DXB-••••</span>
              </div>
            </div>
            <div className="h-[1px] bg-fx-rule" />
            <div>
              <div className="fx-cap mb-2">Registered office</div>
              <div className="font-mono text-[12px] text-fx-dune leading-relaxed">
                Level 41, Emirates Towers
                <br />
                Sheikh Zayed Road, Dubai
              </div>
            </div>
          </motion.aside>
        </div>

        {/* ── Editorial lede — big serif pull quote ─────────────── */}
        <div className="grid grid-cols-12 gap-x-6 md:gap-x-10 mt-24 md:mt-36">
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.3, duration: 1 }}
            className="col-span-12 md:col-span-10 lg:col-span-9 fx-serif text-[28px] md:text-[40px] xl:text-[52px] leading-[1.15] text-fx-sand"
          >
            A regulated bridge between the{' '}
            <span className="italic text-fx-brass">dirham</span> and the digital. Built in Dubai,
            held to VARA&apos;s compliance rulebook, engineered for institutions that refuse to
            guess.
          </motion.p>
        </div>

        {/* ── CTA strip ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="mt-12 md:mt-20 flex flex-wrap items-center gap-4"
        >
          <Link to="/register" className="fx-btn-primary">
            Open an account →
          </Link>
          <a href="#services" className="fx-btn-ghost">
            Read the prospectus
          </a>
          <span className="ml-2 fx-cap">KYC — 3 minutes · dirham-native onboarding</span>
        </motion.div>
      </div>

      <RateTicker />
    </section>
  );
}

/* ─── Services — editorial 3-column with numerals & rules ──────── */
function Services() {
  return (
    <section id="services" className="relative border-t border-fx-rule">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 py-24 md:py-32">
        <div className="mb-16 md:mb-24 grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-4 fx-cap">§ Services</div>
          <h2 className="col-span-12 md:col-span-8 fx-display font-light text-[42px] md:text-[64px] leading-[0.95] text-fx-sand">
            Three things,
            <br />
            <span className="italic fx-serif text-fx-dune">done properly.</span>
          </h2>
        </div>

        <div className="grid grid-cols-12 gap-6 md:gap-10">
          {SERVICES.map((s, idx) => (
            <motion.article
              key={s.no}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.9, delay: idx * 0.1, ease: [0.19, 1, 0.22, 1] }}
              className="col-span-12 md:col-span-4 relative flex flex-col pt-8 border-t border-fx-rule"
            >
              <div className="flex items-baseline justify-between mb-10">
                <span className="fx-display font-light text-[72px] leading-none text-fx-brass/40">
                  {s.no}
                </span>
                <span className="fx-cap">{s.kicker}</span>
              </div>
              <h3 className="fx-display text-[30px] leading-[1.05] text-fx-sand mb-6">{s.title}</h3>
              <p className="fx-serif text-[15px] leading-[1.7] text-fx-dune mb-8 max-w-sm">
                {s.body}
              </p>
              <div className="mt-auto fx-cap text-fx-brass/80">{s.caption}</div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Regulation — the trust wall ───────────────────────────────── */
function Regulation() {
  return (
    <section id="regulation" className="relative border-t border-fx-rule bg-fx-ink/40">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 py-24 md:py-32">
        <div className="grid grid-cols-12 gap-6 md:gap-10">
          <div className="col-span-12 md:col-span-5 space-y-6">
            <div className="fx-cap">§ Regulation</div>
            <h2 className="fx-display font-light text-[40px] md:text-[56px] leading-[0.95] text-fx-sand">
              Licensed.
              <br />
              <span className="italic text-fx-brass">Audited.</span>
              <br />
              <span className="fx-serif italic text-fx-dune">Accountable.</span>
            </h2>
            <p className="fx-serif text-[15px] leading-[1.7] text-fx-dune max-w-md">
              FIATX operates under the Virtual Assets Regulatory Authority of Dubai — VARA —
              Category 2 VASP licence. Every customer, every transaction, every reconciliation
              break is recorded against an eight-year retention clock and exportable on demand.
            </p>
          </div>

          <div className="col-span-12 md:col-span-6 md:col-start-7 grid grid-cols-1 divide-y divide-fx-rule border border-fx-rule">
            {[
              { k: 'Customer Due Diligence', v: 'Level-1 onboarding via Sumsub · live webhook audit trail' },
              { k: 'Enhanced Due Diligence', v: 'Level-2 manual review for PEPs, high-risk, complex ownership' },
              { k: 'Travel Rule',            v: 'IVMS-101 data exchange on every fiat ↔ crypto transfer' },
              { k: 'Sanctions Screening',    v: 'OFAC / EU / UN lists · wallet attribution · daily refresh' },
              { k: 'STR Reporting',          v: 'goAML integration · 48-hour filing window · MLRO oversight' },
              { k: 'Record Retention',       v: 'Eight years on every audit event · immutable · exportable' },
            ].map((row) => (
              <div key={row.k} className="grid grid-cols-12 gap-4 px-6 py-5">
                <div className="col-span-12 md:col-span-4 fx-cap text-fx-dune">{row.k}</div>
                <div className="col-span-12 md:col-span-8 font-mono text-[12px] text-fx-sand leading-relaxed">
                  {row.v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Metrics — numeric editorial row ───────────────────────────── */
function Metrics() {
  return (
    <section id="metrics" className="relative border-t border-fx-rule">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 py-24 md:py-32">
        <div className="mb-16 md:mb-24 flex items-end justify-between gap-6">
          <div>
            <div className="fx-cap mb-4">§ By the numbers</div>
            <h2 className="fx-display font-light text-[42px] md:text-[64px] leading-[0.95] text-fx-sand">
              Concrete
              <span className="italic fx-serif text-fx-dune"> claims.</span>
            </h2>
          </div>
          <div className="hidden md:block fx-cap text-right text-fx-dust/70 max-w-[200px]">
            As of the most<br />recent regulatory filing
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 md:gap-10 border-t border-fx-rule pt-12">
          {METRICS.map((m, i) => (
            <motion.div
              key={m.k}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: i * 0.1 }}
              className="col-span-12 sm:col-span-6 md:col-span-3 flex flex-col gap-3"
            >
              <div className="fx-cap text-fx-dust">{m.k}</div>
              <div className="fx-display font-light text-[36px] md:text-[44px] leading-none text-fx-brass tabular-nums">
                {m.v}
              </div>
              <div className="font-mono text-[11px] text-fx-dune">{m.m}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Closing CTA — quiet invitation ─────────────────────────────── */
function Invitation() {
  return (
    <section id="contact" className="relative border-t border-fx-rule bg-fx-ink/40">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 py-28 md:py-40">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-9">
            <div className="fx-cap mb-6">§ Open an account</div>
            <h2 className="fx-display font-light text-[48px] md:text-[80px] xl:text-[104px] leading-[0.9] text-fx-sand">
              A quiet corner of
              <br />
              <span className="italic fx-serif text-fx-brass">regulated finance.</span>
            </h2>
            <p className="mt-10 fx-serif text-[16px] md:text-[18px] leading-[1.6] text-fx-dune max-w-2xl">
              Individual onboarding is live. Corporate, UBO and treasury access is by invitation —
              we like to know who we&apos;re working with.
            </p>
          </div>
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-4 lg:pt-20">
            <Link to="/register" className="fx-btn-primary w-full">
              Open an individual account
            </Link>
            <Link to="/login" className="fx-btn-ghost w-full">
              Sign in
            </Link>
            <p className="fx-cap text-fx-dust mt-4">
              Corporate enquiries:{' '}
              <span className="text-fx-dune normal-case tracking-normal font-sans">
                institutions@fiatx.ae
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer — masthead echo + colophon ─────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-fx-rule">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 py-16">
        <div className="grid grid-cols-12 gap-6 mb-12">
          <div className="col-span-12 md:col-span-4">
            <Masthead size="nav" />
            <p className="mt-4 fx-serif text-[13px] text-fx-dune max-w-xs leading-relaxed">
              Operated by FIATX Financial Services Ltd, a Virtual Assets Service Provider licensed
              by the Virtual Assets Regulatory Authority of Dubai.
            </p>
          </div>
          <div className="col-span-6 md:col-span-2">
            <div className="fx-cap mb-4">Product</div>
            <ul className="space-y-2 font-mono text-[11px] text-fx-dune">
              <li><a href="#services" className="hover:text-fx-brass">Services</a></li>
              <li><Link to="/register" className="hover:text-fx-brass">Open account</Link></li>
              <li><Link to="/login" className="hover:text-fx-brass">Sign in</Link></li>
            </ul>
          </div>
          <div className="col-span-6 md:col-span-2">
            <div className="fx-cap mb-4">Legal</div>
            <ul className="space-y-2 font-mono text-[11px] text-fx-dune">
              <li><a href="#" className="hover:text-fx-brass">Terms</a></li>
              <li><a href="#" className="hover:text-fx-brass">Privacy</a></li>
              <li><a href="#" className="hover:text-fx-brass">Cookies</a></li>
              <li><a href="#" className="hover:text-fx-brass">Licence</a></li>
            </ul>
          </div>
          <div className="col-span-12 md:col-span-4 md:text-right">
            <div className="fx-cap mb-4">Licence watermark</div>
            <div className="font-mono text-[11px] text-fx-dune">
              VARA VASP · LICENCE No. 2025/DXB-••••
              <br />
              CRM Rulebook compliant · 8yr retention
              <br />
              MLRO registered · goAML enrolled
            </div>
          </div>
        </div>
        <div className="border-t border-fx-rule pt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-fx-dust">
            © 2025 FIATX Financial Services Ltd · Dubai, UAE
          </div>
          <DubaiClock />
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ──────────────────────────────────────────────────────── */
const LandingPage = () => {
  return (
    <div className="min-h-screen bg-fx-obsidian text-fx-sand">
      <TopNav />
      <Hero />
      <Services />
      <Regulation />
      <Metrics />
      <Invitation />
      <Footer />
    </div>
  );
};

export default LandingPage;
