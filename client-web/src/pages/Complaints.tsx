import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, MessageSquare, Plus, RefreshCw, X } from 'lucide-react';
import { CustomerSessionError, customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';
import { StatusBadge } from '../components/StatusBadge';
import { getComplaintStatusView, COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABEL } from '../utils/complaintStatusView';

/* ────────────────────────────────────────────────────────────────
 *  Complaints — spec §3 (战役甲波五): submit a complaint + a read-only
 *  list of my own complaints. No conversation/attachments/withdrawal —
 *  those are explicitly out of scope (client can submit + watch progress).
 * ──────────────────────────────────────────────────────────────── */

interface ComplaintListItem {
  complaintNo: string;
  category: string;
  relatedOrderNo: string | null;
  subject: string;
  currentStatus: string;
  submittedAt: string;
}

const API = import.meta.env.VITE_API_URL;

const NewComplaintModal = ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (complaintNo: string) => void }) => {
  const [category, setCategory] = useState<string>(COMPLAINT_CATEGORIES[0]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [relatedOrderNo, setRelatedOrderNo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCategory(COMPLAINT_CATEGORIES[0]);
    setSubject('');
    setDescription('');
    setRelatedOrderNo('');
    setError('');
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!subject.trim()) { setError('Please give your complaint a short subject line'); return; }
    if (!description.trim()) { setError('Please describe what happened'); return; }
    setSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/me/complaints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          description: description.trim(),
          relatedOrderNo: relatedOrderNo.trim() || undefined,
        }),
      });
      if (!res.ok) { setError(await getCustomerApiErrorMessage(res, 'Failed to submit your complaint')); return; }
      const data = await res.json();
      onCreated(data.complaintNo as string);
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-fx-rule">
        <div className="flex justify-between items-center p-5 border-b border-fx-rule">
          <div>
            <h3 className="text-lg font-bold text-fx-sand">New Complaint</h3>
            <p className="text-sm text-fx-dust mt-1">Tell us what went wrong — we'll acknowledge it within a week</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="text-xs text-fx-dust font-medium block mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm focus:outline-none focus:border-fx-brass"
            >
              {COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{COMPLAINT_CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-fx-dust font-medium block mb-1">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A short summary, e.g. Withdrawal fee was charged twice"
              className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
            />
          </div>

          <div>
            <label className="text-xs text-fx-dust font-medium block mb-1">
              Related Order No.
              <span className="ml-1 text-fx-dust/60 font-normal">(optional)</span>
            </label>
            <input
              value={relatedOrderNo}
              onChange={(e) => setRelatedOrderNo(e.target.value)}
              placeholder="e.g. WDR-… / DEP-… / SWP-…"
              className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm font-mono placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
            />
          </div>

          <div>
            <label className="text-xs text-fx-dust font-medium block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What happened, when, and what you'd like us to do about it"
              className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
            />
          </div>
        </div>

        <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 flex gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-3 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {submitting && <RefreshCw size={16} className="animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit Complaint'}
          </button>
        </div>
      </div>
    </div>
  );
};

const Complaints = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<ComplaintListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await customerFetch(`${API}/client/me/complaints`);
      if (!res.ok) { setError(await getCustomerApiErrorMessage(res, 'Failed to load your complaints')); return; }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[26px] font-normal text-fx-sand">Complaints</h1>
          <p className="mt-1.5 text-[12px] text-fx-dust">Submit a complaint and track its progress</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void fetchItems()}
            className="text-fx-dust hover:text-fx-brass transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-fx-brass text-fx-obsidian font-semibold text-sm rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all"
          >
            <Plus size={15} /> New Complaint
          </button>
        </div>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
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

      {!error && loading && (
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="animate-spin text-fx-dust" size={20} />
        </div>
      )}

      {!error && !loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <MessageSquare size={22} className="text-fx-dust" />
          <p className="font-mono text-[12px] text-fx-dust">You haven't submitted any complaints.</p>
        </div>
      )}

      {!error && !loading && items.length > 0 && (
        <div className="border border-fx-rule bg-fx-ink divide-y divide-fx-rule">
          {items.map((item) => {
            const view = getComplaintStatusView(item.currentStatus);
            const submitted = new Date(item.submittedAt);
            return (
              <button
                key={item.complaintNo}
                onClick={() => navigate(`/complaints/${item.complaintNo}`)}
                className="w-full flex items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-fx-charcoal/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fx-sand truncate">{item.subject}</div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-fx-dust">
                    <span>{item.complaintNo}</span>
                    <span>·</span>
                    <span>{COMPLAINT_CATEGORY_LABEL[item.category] ?? item.category}</span>
                    <span>·</span>
                    <span>{submitted.toLocaleDateString()}</span>
                  </div>
                </div>
                <StatusBadge view={view} />
              </button>
            );
          })}
        </div>
      )}

      <NewComplaintModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(complaintNo) => { setShowNew(false); navigate(`/complaints/${complaintNo}`); }}
      />
    </div>
  );
};

export default Complaints;
