import { motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Briefcase,
  Database,
  Globe,
  Menu,
  Shield,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const HERO_METRICS = [
  { label: 'Execution Latency', value: '42ms', accent: 'text-brand-accent' },
  { label: 'Settlement Visibility', value: 'T+0', accent: 'text-emerald-300' },
  { label: 'Monitoring Coverage', value: '24/7', accent: 'text-white' },
];

const PLATFORM_PILLARS = [
  {
    title: 'Funding Rails',
    description: 'Route crypto and fiat movement through one governed treasury surface.',
    icon: <Globe size={20} />,
  },
  {
    title: 'Risk Control',
    description: 'Travel Rule, KYT, approval gates, and evidence export stay visible end to end.',
    icon: <Shield size={20} />,
  },
  {
    title: 'Operator Clarity',
    description: 'Every transaction maps to a clean detail surface, not a maze of raw system state.',
    icon: <Briefcase size={20} />,
  },
];

const TRUST_SIGNALS = [
  { label: 'Regulated control plane', icon: <Shield size={18} /> },
  { label: 'Realtime treasury state', icon: <Activity size={18} /> },
  { label: 'Institutional audit evidence', icon: <Database size={18} /> },
  { label: 'Best execution visibility', icon: <TrendingUp size={18} /> },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

const LandingPage = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isAuthenticated } = useAuth();

  const primaryHref = isAuthenticated ? '/overview' : '/register';
  const primaryLabel = isAuthenticated ? 'Open Dashboard' : 'Open Your Account';
  const secondaryHref = isAuthenticated ? '/withdraw' : '/login';
  const secondaryLabel = isAuthenticated ? 'Review Funding Flows' : 'Client Sign In';

  return (
    <div className="min-h-screen overflow-hidden bg-[#03111f] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.16),_transparent_30%),radial-gradient(circle_at_80%_20%,_rgba(59,130,246,0.18),_transparent_28%),linear-gradient(180deg,_rgba(6,17,32,0.92),_rgba(2,6,23,1))]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(148,163,184,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.3)_1px,transparent_1px)] [background-size:56px_56px]" />
        <div className="absolute left-[10%] top-36 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-10 right-[8%] h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#041120]/75 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_30px_rgba(34,211,238,0.12)]">
              <span className="text-lg font-black tracking-tight text-white">E</span>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                Exchange
              </div>
              <div className="text-sm font-semibold text-white">Advanced Treasury Interface</div>
            </div>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#platform" className="text-sm font-medium text-slate-300 transition-colors hover:text-white">
              Platform
            </a>
            <a href="#controls" className="text-sm font-medium text-slate-300 transition-colors hover:text-white">
              Controls
            </a>
            <a href="#evidence" className="text-sm font-medium text-slate-300 transition-colors hover:text-white">
              Evidence
            </a>
            <Link
              to={secondaryHref}
              className="rounded-full border border-white/12 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:border-brand-accent/30 hover:bg-white/10"
            >
              {secondaryLabel}
            </Link>
            <Link
              to={primaryHref}
              className="inline-flex items-center gap-2 rounded-full bg-tech-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(34,211,238,0.16)] transition-all hover:translate-y-[-1px]"
            >
              {primaryLabel}
              <ArrowRight size={16} />
            </Link>
          </div>

          <button
            onClick={() => setIsMenuOpen((value) => !value)}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:text-white md:hidden"
          >
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {isMenuOpen ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="border-t border-white/10 bg-[#061424]/95 px-4 py-4 md:hidden"
          >
            <div className="space-y-3">
              <a href="#platform" className="block rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
                Platform
              </a>
              <a href="#controls" className="block rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
                Controls
              </a>
              <a href="#evidence" className="block rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
                Evidence
              </a>
              <Link
                to={secondaryHref}
                className="block rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-semibold text-white"
              >
                {secondaryLabel}
              </Link>
              <Link
                to={primaryHref}
                className="flex items-center justify-center gap-2 rounded-xl bg-tech-gradient px-4 py-3 text-sm font-semibold text-white"
              >
                {primaryLabel}
                <ArrowRight size={16} />
              </Link>
            </div>
          </motion.div>
        ) : null}
      </nav>

      <main>
        <section className="relative mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pb-28 lg:pt-24">
          <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <motion.div
              initial="hidden"
              animate="show"
              variants={fadeUp}
              transition={{ duration: 0.7 }}
              className="space-y-8"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-200">
                <Activity size={14} />
                Governed Digital Asset Operations
              </div>

              <div className="space-y-5">
                <h1 className="max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                  One platform for
                  <span className="block bg-[linear-gradient(90deg,#ffffff_0%,#8be9ff_38%,#3b82f6_100%)] bg-clip-text text-transparent">
                    funding, control, and proof.
                  </span>
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-slate-300">
                  Exchange brings treasury rails, compliance review, approval gates, and evidence
                  export into a single operating surface built for advanced financial workflows.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  to={primaryHref}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-semibold text-slate-950 transition-all hover:translate-y-[-1px] hover:bg-cyan-50"
                >
                  {primaryLabel}
                  <ArrowRight size={16} />
                </Link>
                <Link
                  to={secondaryHref}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/5 px-7 py-4 text-sm font-semibold text-white transition-all hover:border-cyan-300/30 hover:bg-white/10"
                >
                  {secondaryLabel}
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {HERO_METRICS.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-[1.75rem] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl"
                  >
                    <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                      {metric.label}
                    </div>
                    <div className={`mt-2 text-3xl font-black tracking-[-0.04em] ${metric.accent}`}>
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.12 }}
              className="relative"
            >
              <div className="absolute inset-0 rounded-[2.25rem] bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.22),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.18),_transparent_45%)] blur-2xl" />
              <div className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-[#081424]/80 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-2xl">
                <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(148,163,184,0.35)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.35)_1px,transparent_1px)] [background-size:24px_24px]" />

                <div className="relative z-10">
                  <div className="mb-6 flex items-start justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                        Command Layer
                      </div>
                      <div className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
                        Treasury Control Surface
                      </div>
                    </div>
                    <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                      Live
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-4 rounded-[1.75rem] border border-white/8 bg-white/5 p-5">
                      <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                            Portfolio Value
                          </div>
                          <div className="mt-2 font-mono text-4xl font-black tracking-[-0.06em] text-white">
                            124.6M
                          </div>
                        </div>
                        <div className="rounded-2xl bg-emerald-400/15 px-3 py-2 text-right text-emerald-300">
                          <div className="text-[10px] uppercase tracking-[0.18em]">Trend</div>
                          <div className="font-mono text-lg font-bold">+3.9%</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {[
                          ['BTC / AED', '4.2M', '+1.8%'],
                          ['ETH / AED', '3.7M', '+2.4%'],
                          ['USDT / AED', '12.9M', '+0.1%'],
                        ].map(([pair, exposure, change]) => (
                          <div
                            key={pair}
                            className="flex items-center justify-between rounded-2xl border border-white/8 bg-[#0b1828] px-4 py-3"
                          >
                            <div>
                              <div className="text-sm font-semibold text-white">{pair}</div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                Monitored exposure
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-base font-bold text-white">{exposure}</div>
                              <div className="text-xs font-semibold text-emerald-300">{change}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[1.75rem] border border-white/8 bg-white/5 p-5">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                          Review Load
                        </div>
                        <div className="mt-3 flex items-end justify-between">
                          <div className="text-3xl font-black tracking-[-0.05em] text-white">08</div>
                          <div className="text-sm font-semibold text-amber-300">Active cases</div>
                        </div>
                        <div className="mt-5 space-y-2">
                          {[
                            ['Travel Rule', '3'],
                            ['KYT Review', '2'],
                            ['Approval Gate', '3'],
                          ].map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between text-sm text-slate-300">
                              <span>{label}</span>
                              <span className="font-mono text-white">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[1.75rem] border border-white/8 bg-gradient-to-br from-white/8 to-cyan-400/10 p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
                          <Zap size={16} />
                          Evidence Ready
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-300">
                          Export packages carry linked transaction roots, control gates, and
                          timeline-ready audit context.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-black/20">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            {TRUST_SIGNALS.map((signal) => (
              <div
                key={signal.label}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-200"
              >
                <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-cyan-200">
                  {signal.icon}
                </div>
                <span className="font-medium">{signal.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="platform" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="mb-12 max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Platform Layers
            </div>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.04em] text-white">
              Built for operator confidence, not dashboard noise.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              The product language is intentionally split: a structured operator console for
              governance and a refined fintech surface for clients. Both ride on the same terms,
              same status model, and same evidence chain.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {PLATFORM_PILLARS.map((pillar, index) => (
              <motion.div
                key={pillar.title}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
                variants={fadeUp}
                transition={{ duration: 0.55, delay: index * 0.08 }}
                className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
              >
                <div className="mb-5 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-200">
                  {pillar.icon}
                </div>
                <h3 className="text-2xl font-black tracking-[-0.03em] text-white">{pillar.title}</h3>
                <p className="mt-4 text-sm leading-7 text-slate-300">{pillar.description}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="controls" className="border-y border-white/10 bg-black/20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div className="space-y-5">
              <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                Control Stack
              </div>
              <h2 className="text-4xl font-black tracking-[-0.04em] text-white">
                The memorable part is not the glow. It is the clarity.
              </h2>
              <p className="text-base leading-7 text-slate-300">
                Every funding flow, compliance review, and approval gate points to a canonical
                object identity. That is what makes the UI feel calm, precise, and trustworthy.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['No / Code first', 'Operator-facing surfaces prioritize human identifiers, not raw ids.'],
                ['Lifecycle states', 'Loading, review, blocked, archived, and final states stay explicit.'],
                ['Action grammar', 'Submit, approve, reject, retry, export, and refresh keep one meaning.'],
                ['Evidence symmetry', 'Read models, audit trails, and evidence packages follow the same root.'],
              ].map(([title, copy]) => (
                <div
                  key={title}
                  className="rounded-[1.75rem] border border-white/10 bg-[#081424]/80 p-5"
                >
                  <div className="text-lg font-bold text-white">{title}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="evidence" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8 backdrop-blur-2xl sm:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                  Evidence Ready
                </div>
                <h2 className="mt-4 text-4xl font-black tracking-[-0.04em] text-white">
                  Demo-ready flows, backed by operator-grade proof.
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                  Use the client surface to onboard, fund, and withdraw. Use the admin console to
                  inspect alerts, approvals, payouts, and evidence export without switching mental
                  models.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <Link
                  to={primaryHref}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-4 text-sm font-semibold text-slate-950 transition-all hover:bg-cyan-50"
                >
                  {primaryLabel}
                  <ArrowRight size={16} />
                </Link>
                <Link
                  to={secondaryHref}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/5 px-7 py-4 text-sm font-semibold text-white transition-all hover:bg-white/10"
                >
                  {secondaryLabel}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#020914]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-black text-white">
              E
            </div>
            <div>
              <div className="font-semibold text-slate-200">Exchange</div>
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                Advanced Treasury Interface
              </div>
            </div>
          </div>
          <div>© 2026 Exchange Group. Governance, treasury, and client flows in one platform.</div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
