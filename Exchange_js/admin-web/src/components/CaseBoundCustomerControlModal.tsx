import { useEffect, useMemo, useState } from 'react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

export type CustomerControlAction =
  | 'RESTRICT'
  | 'UNRESTRICT'
  | 'FREEZE'
  | 'UNFREEZE';

interface CaseOption {
  id: string;
  caseNo: string;
  status: string;
  stage?: string | null;
}

interface CaseListResponse {
  items?: CaseOption[];
}

interface CaseBoundCustomerControlModalProps {
  open: boolean;
  action: CustomerControlAction | null;
  customerNo?: string | null;
  customerLabel?: string | null;
  currentCaseId?: string | null;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
}

const actionLabelMap: Record<CustomerControlAction, string> = {
  RESTRICT: 'Restrict',
  UNRESTRICT: 'Unrestrict',
  FREEZE: 'Freeze',
  UNFREEZE: 'Unfreeze',
};

const reasonLabelMap: Record<CustomerControlAction, string> = {
  RESTRICT: 'Restriction reason',
  UNRESTRICT: 'Unrestriction reason',
  FREEZE: 'Freeze reason',
  UNFREEZE: 'Unfreeze reason',
};

const CaseBoundCustomerControlModal = ({
  open,
  action,
  customerNo,
  customerLabel,
  currentCaseId,
  onClose,
  onSubmitted,
}: CaseBoundCustomerControlModalProps) => {
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const requiresCurrentBinding =
    action === 'UNRESTRICT' || action === 'UNFREEZE';
  const actionLabel = action ? actionLabelMap[action] : 'Control';
  const currentBoundCaseExists = !requiresCurrentBinding || !!currentCaseId;

  useEffect(() => {
    if (!open || !action || !customerNo) {
      if (!open) {
        setCases([]);
        setSelectedCaseId('');
        setReason('');
        setError('');
      }
      return;
    }

    let cancelled = false;

    const loadCases = async () => {
      setLoading(true);
      setError('');
      setReason('');
      setCases([]);
      setSelectedCaseId('');

      if (requiresCurrentBinding && !currentCaseId) {
        setLoading(false);
        setError(`No active case binding found for ${actionLabel.toLowerCase()}.`);
        return;
      }

      try {
        const params = new URLSearchParams({
          customerNo,
          take: '50',
        });
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/cases?${params.toString()}`,
        );

        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Failed to load cases.'));
        }

        const data = (await response.json()) as CaseListResponse;
        if (cancelled) return;

        const caseItems = Array.isArray(data.items) ? data.items : [];
        setCases(caseItems);

        const defaultCase =
          (currentCaseId && caseItems.find((item) => item.id === currentCaseId)) ||
          (!requiresCurrentBinding ? caseItems[0] : undefined);

        setSelectedCaseId(defaultCase?.id || '');

        if (caseItems.length === 0) {
          setError('No compliance case is available for this customer.');
        } else if (requiresCurrentBinding && currentCaseId && !defaultCase) {
          setError(
            `Current bound case ${currentCaseId} is not available in the case list.`,
          );
        }
      } catch (e) {
        if (cancelled || e instanceof AdminSessionError) return;
        setError(e instanceof Error ? e.message : 'Failed to load cases.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadCases();

    return () => {
      cancelled = true;
    };
  }, [action, actionLabel, currentCaseId, customerNo, open, requiresCurrentBinding]);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) || null,
    [cases, selectedCaseId],
  );

  const submit = async () => {
    if (!action || !selectedCaseId || !reason.trim()) return;

    try {
      setSubmitting(true);
      setError('');
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${selectedCaseId}/action`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action,
            reason: reason.trim(),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `${actionLabel} failed.`));
      }

      await onSubmitted();
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `${actionLabel} failed.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !action) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-admin-border">
        <div className="px-6 py-4 border-b border-admin-border">
          <h2 className="text-lg font-semibold text-gray-900">
            {actionLabel} Customer via Compliance Case
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Customer: {customerLabel || customerNo || '-'} ({customerNo || '-'})
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Compliance Case</label>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              disabled={
                loading ||
                submitting ||
                !currentBoundCaseExists ||
                (requiresCurrentBinding && !!currentCaseId)
              }
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900 bg-white disabled:bg-gray-50"
            >
              <option value="">
                {loading ? 'Loading cases...' : 'Select a compliance case'}
              </option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.caseNo} | {item.status} | {item.stage || '-'}
                </option>
              ))}
            </select>
            {selectedCase && (
              <div className="text-xs text-gray-500">
                Selected case: {selectedCase.caseNo} ({selectedCase.status})
              </div>
            )}
            {requiresCurrentBinding && currentCaseId && (
              <div className="text-xs text-amber-700">
                This action is locked to the currently bound case.
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              {reasonLabelMap[action]}
            </label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Please provide ${reasonLabelMap[action].toLowerCase()}.`}
              disabled={submitting}
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-admin-border flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-admin-border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              submitting ||
              loading ||
              !selectedCaseId ||
              !reason.trim() ||
              !!error
            }
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : `Submit ${actionLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CaseBoundCustomerControlModal;
