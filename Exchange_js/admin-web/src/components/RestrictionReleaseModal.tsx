import { useEffect, useState, type ReactNode } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { scopeLabel, type AdminRestrictionRow } from '../utils/restrictionCauseMeta';

interface RestrictionReleaseModalProps {
  open: boolean;
  customerNo: string;
  restriction: AdminRestrictionRow | null;
  onClose: () => void;
  onSubmitted: (approvalNo: string) => Promise<void> | void;
}

const EchoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-adm-border py-2 last:border-b-0">
    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-adm-t3">
      {label}
    </span>
    <span className="min-w-0 break-all text-right font-mono text-[10px] text-adm-t2">
      {children}
    </span>
  </div>
);

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const RestrictionReleaseModal = ({
  open,
  customerNo,
  restriction,
  onClose,
  onSubmitted,
}: RestrictionReleaseModalProps) => {
  const [reason, setReason] = useState('');
  const [releaseOrderRef, setReleaseOrderRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    setReleaseOrderRef('');
    setError('');
  }, [open, restriction?.restrictionNo]);

  if (!open || !restriction) return null;

  // releasePolicy 取便签行上的存量值，不重新按 cause 推——便签一旦贴下，
  // 它的解除方式就是当时写死的那一个。
  const needsOrderRef = restriction.releasePolicy === 'MLRO_APPROVAL';

  const submit = async () => {
    if (!reason.trim() || (needsOrderRef && !releaseOrderRef.trim())) return;
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (releaseOrderRef.trim()) body.releaseOrderRef = releaseOrderRef.trim();

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/restrictions/${restriction.restrictionNo}/release`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to request release.'));
      }
      const data = (await res.json()) as { approvalNo: string };
      await onSubmitted(data.approvalNo);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to request release.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Release Restriction</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            This opens an approval case. The restriction stays OPEN until it is approved.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <div className="mb-4 rounded border border-adm-border bg-adm-bg px-3 py-1">
            <EchoRow label="Restriction No">
              <span className="font-semibold text-adm-amber">{restriction.restrictionNo}</span>
            </EchoRow>
            <EchoRow label="Cause">
              {restriction.cause}
              {restriction.visibility === 'SILENT' ? ' 🔇' : ''}
            </EchoRow>
            <EchoRow label="Blocks">{scopeLabel(restriction.scopes)}</EchoRow>
            <EchoRow label="Opened">
              {fmt(restriction.openedAt)} · {restriction.openedBy}
            </EchoRow>
            <EchoRow label="Opened Reason">{restriction.reason}</EchoRow>
            <EchoRow label="Case Ref">{restriction.caseRef || '—'}</EchoRow>
            <EchoRow label="Release By">{restriction.releasePolicy}</EchoRow>
          </div>

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Release Order Ref{needsOrderRef ? '' : ' (optional)'}
          </label>
          <input
            value={releaseOrderRef}
            onChange={(e) => setReleaseOrderRef(e.target.value)}
            placeholder={
              needsOrderRef
                ? 'Required — e.g. MLRO-ORDER-26081501'
                : 'e.g. OPS-TICKET-26081501'
            }
            disabled={submitting}
            className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          {needsOrderRef && (
            <p className="mt-1.5 font-mono text-[9px] text-adm-amber">
              MLRO_APPROVAL restrictions cannot be released without a written order reference.
            </p>
          )}

          <label className="mb-1.5 mt-4 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Release Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Name match cleared — false positive confirmed against passport MRZ"
            disabled={submitting}
            className="h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !reason.trim() || (needsOrderRef && !releaseOrderRef.trim())}
            className={adminButtonClass('modalConfirm')}
          >
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestrictionReleaseModal;
