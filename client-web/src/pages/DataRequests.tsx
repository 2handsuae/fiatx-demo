import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, FileText, RefreshCw, ScrollText } from 'lucide-react';
import { CustomerSessionError, customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';
import { StatusBadge } from '../components/StatusBadge';
import {
  CONSENT_DECISION_LABEL,
  DSR_OUTCOME_HEADLINE,
  DSR_TYPES,
  DSR_TYPE_LABEL,
  DSR_TYPE_OPTION,
  ERASURE_CLAUSE_EXCERPT,
  getDsrStatusView,
  humanizeCode,
  profileRows,
  type DsrType,
} from '../utils/dsrView';

/* ────────────────────────────────────────────────────────────────
 *  Data requests — 战役丙波四 T7. Submit an access / correction / deletion
 *  request about your own personal data and watch it through to an answer.
 *  - 后端投影不含 dueAt（内部办理时限，tipping-off 红线）：这里只写"30 天内答复"，不算任何截止日。
 *  - 办结 ACCESS：展示 DPO 生成的资料摘要（三区可折叠）。
 *  - 办结 ERASURE：展示条款引用卡（协议版本 + §VI + 固定摘录），链到 /agreement。
 * ──────────────────────────────────────────────────────────────── */

interface DsrSummary {
  generatedAt: string;
  profile: Record<string, string | null>;
  agreementConsents: Array<{ versionKey: string; actedAt: string; decision: string }>;
  kycMaterials: Array<{ materialType: string; status: string; issuedAt: string }>;
}

interface DsrRow {
  requestNo: string;
  type: DsrType;
  detail: string;
  status: string;
  submittedAt: string;
  resolvedAt: string | null;
  resolutionCode: string | null;
  resolutionNote: string | null;
  clauseRef: { versionKey: string; section: string } | null;
  summary: DsrSummary | null;
}

const API = import.meta.env.VITE_API_URL;

const day = (iso: string) => new Date(iso).toLocaleDateString();

const Collapsible = ({ title, count, defaultOpen = false, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-fx-rule rounded-xl bg-fx-charcoal/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="text-[13px] font-medium text-fx-sand">
          {title}
          {count !== undefined && <span className="ml-2 font-mono text-[10px] text-fx-dust">{count}</span>}
        </span>
        {open ? <ChevronDown size={14} className="text-fx-dust" /> : <ChevronRight size={14} className="text-fx-dust" />}
      </button>
      {open && <div className="px-4 pb-3.5 pt-0.5">{children}</div>}
    </div>
  );
};

const DataSummary = ({ summary }: { summary: DsrSummary }) => (
  <div className="space-y-2">
    <p className="font-mono text-[10px] text-fx-dust">Snapshot taken {day(summary.generatedAt)}</p>
    <Collapsible title="Profile" defaultOpen>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {profileRows(summary.profile).map((row) => (
          <div key={row.label}>
            <dt className="text-[11px] text-fx-dust">{row.label}</dt>
            <dd className="text-[13px] text-fx-sand break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Collapsible>
    <Collapsible title="Agreement consents" count={summary.agreementConsents.length}>
      {summary.agreementConsents.length === 0 ? (
        <p className="text-[12px] text-fx-dust">No agreement history on record.</p>
      ) : (
        <ul className="divide-y divide-fx-rule">
          {summary.agreementConsents.map((c, i) => (
            <li key={i} className="flex items-center justify-between py-1.5 text-[13px] text-fx-sand">
              <span>Customer Agreement {c.versionKey} — {CONSENT_DECISION_LABEL[c.decision] ?? humanizeCode(c.decision)}</span>
              <span className="font-mono text-[11px] text-fx-dust">{day(c.actedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
    <Collapsible title="KYC materials" count={summary.kycMaterials.length}>
      {summary.kycMaterials.length === 0 ? (
        <p className="text-[12px] text-fx-dust">No document requests on record.</p>
      ) : (
        <ul className="divide-y divide-fx-rule">
          {summary.kycMaterials.map((m, i) => (
            <li key={i} className="flex items-center justify-between py-1.5 text-[13px] text-fx-sand">
              <span>{humanizeCode(m.materialType)} — {humanizeCode(m.status)}</span>
              <span className="font-mono text-[11px] text-fx-dust">{day(m.issuedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  </div>
);

const ClauseCard = ({ clauseRef }: { clauseRef: { versionKey: string; section: string } }) => (
  <div className="rounded-xl border border-fx-brass/30 bg-fx-brass/[0.04] px-4 py-3.5">
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fx-brass">
      <ScrollText size={13} /> Clause we are relying on
    </div>
    <div className="mt-2 text-[13px] font-medium text-fx-sand">
      Customer Agreement {clauseRef.versionKey} · §{clauseRef.section}
    </div>
    <blockquote className="mt-2 border-l-2 border-fx-brass/50 pl-3 text-[13px] italic leading-relaxed text-fx-dune">
      “… {ERASURE_CLAUSE_EXCERPT} …”
    </blockquote>
    <Link to="/agreement" className="mt-3 inline-flex items-center gap-1 text-[12px] text-fx-brass hover:underline">
      Read the full agreement <ChevronRight size={12} />
    </Link>
  </div>
);

const RequestCard = ({ row }: { row: DsrRow }) => {
  const view = getDsrStatusView(row.status);
  const resolved = row.status === 'RESOLVED';
  return (
    <article className="border border-fx-rule bg-fx-ink px-5 py-4 space-y-3.5" data-request-no={row.requestNo}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-fx-sand">{DSR_TYPE_LABEL[row.type] ?? row.type}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-fx-dust">
            <span>{row.requestNo}</span>
            <span>·</span>
            <span>Submitted {day(row.submittedAt)}</span>
          </div>
        </div>
        <StatusBadge view={view} />
      </div>

      <div>
        <div className="text-[11px] text-fx-dust">What you asked</div>
        <p className="mt-0.5 text-[13px] text-fx-dune whitespace-pre-wrap break-words">{row.detail}</p>
      </div>

      {!resolved && (
        <p className="text-[12px] text-fx-dust">
          {row.status === 'IN_REVIEW'
            ? 'Our Data Protection Officer is working on this. We will respond within 30 days of your request.'
            : 'We have received your request. We will respond within 30 days.'}
        </p>
      )}

      {resolved && (
        <div className="space-y-3 border-t border-fx-rule pt-3.5">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fx-sand">
              <CheckCircle2 size={14} className="text-fx-sage" />
              {(row.resolutionCode && DSR_OUTCOME_HEADLINE[row.resolutionCode]) ?? 'Your request has been answered'}
            </div>
            {row.resolvedAt && <div className="mt-0.5 font-mono text-[10px] text-fx-dust">Answered {day(row.resolvedAt)}</div>}
            {row.resolutionNote && (
              <p className="mt-2 text-[13px] leading-relaxed text-fx-dune whitespace-pre-wrap break-words">{row.resolutionNote}</p>
            )}
            {row.resolutionCode === 'RECTIFICATION_SELF_SERVICE' && (
              <Link to="/profile" className="mt-2 inline-flex items-center gap-1 text-[12px] text-fx-brass hover:underline">
                Go to your profile <ChevronRight size={12} />
              </Link>
            )}
          </div>
          {row.type === 'ACCESS' && row.summary && <DataSummary summary={row.summary} />}
          {row.type === 'ERASURE' && row.clauseRef && <ClauseCard clauseRef={row.clauseRef} />}
        </div>
      )}
    </article>
  );
};

const DataRequests = () => {
  const [items, setItems] = useState<DsrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [type, setType] = useState<DsrType>('ACCESS');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submittedNo, setSubmittedNo] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await customerFetch(`${API}/client/me/dsr-requests`);
      if (!res.ok) { setError(await getCustomerApiErrorMessage(res, 'Failed to load your data requests')); return; }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const submit = async () => {
    setFormError('');
    setSubmittedNo('');
    if (!detail.trim()) { setFormError('Please tell us a little about what you need'); return; }
    setSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/me/dsr-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, detail: detail.trim() }),
      });
      if (!res.ok) { setFormError(await getCustomerApiErrorMessage(res, 'Failed to submit your request')); return; }
      const data = await res.json();
      setSubmittedNo(data.requestNo as string);
      setDetail('');
      await fetchItems();
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setFormError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[26px] font-normal text-fx-sand">Data requests</h1>
          <p className="mt-1.5 text-[12px] text-fx-dust">
            Ask for a copy of your data, a correction, or deletion. We will respond within 30 days.
          </p>
        </div>
        <button
          onClick={() => void fetchItems()}
          className="text-fx-dust hover:text-fx-brass transition-colors"
          title="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <section className="border border-fx-rule bg-fx-ink px-5 py-5 space-y-4">
        <h2 className="text-[13px] font-semibold text-fx-sand">Make a request</h2>

        <div role="radiogroup" aria-label="Request type" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DSR_TYPES.map((t) => {
            const opt = DSR_TYPE_OPTION[t];
            const selected = type === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setType(t)}
                className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                  selected ? 'border-fx-brass bg-fx-brass/[0.06]' : 'border-fx-rule bg-fx-charcoal/30 hover:border-fx-brass/50'
                }`}
              >
                <div className={`text-[13px] font-semibold ${selected ? 'text-fx-brass' : 'text-fx-sand'}`}>{opt.label}</div>
                <div className="mt-1 text-[12px] leading-snug text-fx-dust">{opt.hint}</div>
              </button>
            );
          })}
        </div>

        <div>
          <label htmlFor="dsr-detail" className="text-xs text-fx-dust font-medium block mb-1">Tell us what you need</label>
          <textarea
            id="dsr-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={4}
            placeholder={DSR_TYPE_OPTION[type].placeholder}
            className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
          />
        </div>

        {formError && (
          <div className="flex items-start gap-2 rounded-xl border border-fx-rust/30 bg-fx-rust/10 px-3 py-2.5 text-xs text-fx-rust">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {formError}
          </div>
        )}
        {submittedNo && (
          <div className="flex items-start gap-2 rounded-xl border border-fx-sage/30 bg-fx-sage/10 px-3 py-2.5 text-xs text-fx-sage">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>
              We have received your request <span className="font-mono">{submittedNo}</span>. We will respond within 30 days.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] text-fx-dust">Handled by our Data Protection Officer under the UAE Federal PDPL.</p>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-fx-brass text-fx-obsidian font-semibold text-sm rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40"
          >
            {submitting && <RefreshCw size={15} className="animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold text-fx-sand">Your requests</h2>

        {error && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle size={22} className="text-fx-rust" />
            <p className="font-mono text-[12px] text-fx-rust">{error}</p>
            <button
              onClick={() => void fetchItems()}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
            >
              Retry
            </button>
          </div>
        )}

        {!error && loading && items.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="animate-spin text-fx-dust" size={20} />
          </div>
        )}

        {!error && !loading && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText size={22} className="text-fx-dust" />
            <p className="font-mono text-[12px] text-fx-dust">You haven't made any data requests.</p>
          </div>
        )}

        {!error && items.length > 0 && (
          <div className="space-y-3">
            {items.map((row) => <RequestCard key={row.requestNo} row={row} />)}
          </div>
        )}
      </section>
    </div>
  );
};

export default DataRequests;
