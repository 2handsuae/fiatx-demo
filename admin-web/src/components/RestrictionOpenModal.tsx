import { useEffect, useState, type ReactNode } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  RESTRICTION_CAUSES,
  RESTRICTION_CAUSE_POLICY,
  SELECTABLE_SCOPES,
  scopeLabel,
  type RestrictionCause,
  type RestrictionScope,
} from '../utils/restrictionCauseMeta';

interface RestrictionOpenModalProps {
  open: boolean;
  customerNo: string;
  customerLabel: string;
  onClose: () => void;
  onSubmitted: (restrictionNo: string, created: boolean) => Promise<void> | void;
}

/** 默认落在人工挂起而不是制裁——制裁必须是操作员主动选中的动作。 */
const DEFAULT_CAUSE: RestrictionCause = 'ADMIN_SUSPENSION';

const EchoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-adm-border py-2 last:border-b-0">
    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-adm-t3">
      {label}
    </span>
    <span className="min-w-0 text-right font-mono text-[10px] text-adm-t2">{children}</span>
  </div>
);

const RestrictionOpenModal = ({
  open,
  customerNo,
  customerLabel,
  onClose,
  onSubmitted,
}: RestrictionOpenModalProps) => {
  const [cause, setCause] = useState<RestrictionCause>(DEFAULT_CAUSE);
  const [scopes, setScopes] = useState<RestrictionScope[]>(
    RESTRICTION_CAUSE_POLICY[DEFAULT_CAUSE].defaultScopes,
  );
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCause(DEFAULT_CAUSE);
    setScopes(RESTRICTION_CAUSE_POLICY[DEFAULT_CAUSE].defaultScopes);
    setReason('');
    setCaseRef('');
    setError('');
  }, [open]);

  const policy = RESTRICTION_CAUSE_POLICY[cause];

  const pickCause = (next: RestrictionCause) => {
    setCause(next);
    setScopes(RESTRICTION_CAUSE_POLICY[next].defaultScopes);
  };

  const toggleScope = (scope: RestrictionScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      // scope 仅 scopeSelectable 的 cause 才允许出现在 body，否则后端 400。
      const body: Record<string, unknown> = { cause, reason: reason.trim() };
      if (policy.scopeSelectable) body.scopes = scopes;
      if (caseRef.trim()) body.caseRef = caseRef.trim();

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/restrictions`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to add restriction.'));
      }
      const data = (await res.json()) as { restrictionNo: string; created: boolean };
      await onSubmitted(data.restrictionNo, data.created);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to add restriction.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const submitDisabled =
    submitting || !reason.trim() || (policy.scopeSelectable && scopes.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Add Restriction</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {customerLabel} · {customerNo} — takes effect immediately, no approval.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Cause
          </label>
          <select
            value={cause}
            onChange={(e) => pickCause(e.target.value as RestrictionCause)}
            disabled={submitting}
            className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
          >
            {RESTRICTION_CAUSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* 只读回显 —— cause 一选，这三行就是后端会写进便签的事实 */}
          <div className="mb-4 rounded border border-adm-border bg-adm-bg px-3 py-1">
            <EchoRow label="Blocks">
              {policy.scopeSelectable ? (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  {SELECTABLE_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="inline-flex cursor-pointer items-center gap-1 text-adm-t2"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        disabled={submitting}
                        className="h-3 w-3 accent-current"
                      />
                      {scope}
                    </label>
                  ))}
                </span>
              ) : (
                scopeLabel(policy.defaultScopes)
              )}
            </EchoRow>
            <EchoRow label="Customer sees">
              {policy.visibility === 'SILENT'
                ? 'SILENT — nothing shown to the customer'
                : `DISCLOSED — "${policy.customerLabel}"`}
            </EchoRow>
            <EchoRow label="Release by">
              {policy.releasePolicy === 'MLRO_APPROVAL'
                ? 'MLRO_APPROVAL — MLRO approval required'
                : 'OPS_APPROVAL — ops officer approval required'}
            </EchoRow>
          </div>

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sanctions list hit confirmed by MLRO on 2026-08-15"
            disabled={submitting}
            className="mb-4 h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Case Ref (optional)
          </label>
          <input
            value={caseRef}
            onChange={(e) => setCaseRef(e.target.value)}
            placeholder="e.g. CRA26081500x"
            disabled={submitting}
            className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          <p className="mt-1.5 font-mono text-[9px] text-adm-t3">
            Same cause + same case ref on an open restriction is a no-op (idempotent).
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitDisabled}
            className={adminButtonClass('workflowNegative')}
          >
            {submitting ? 'Adding…' : 'Add Restriction'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestrictionOpenModal;
