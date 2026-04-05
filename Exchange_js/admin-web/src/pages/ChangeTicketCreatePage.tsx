import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

const CHANGE_TYPE_OPTIONS = [
  'ADMIN_ACCESS_CHANGE',
  'RBAC_CATALOG_CHANGE',
];

const REQUIRED_FIELD_ERROR =
  'Please fill in scope summary, change reason, test evidence ref, and rollback plan ref with non-empty values.';

const ChangeTicketCreatePage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    changeType: 'ADMIN_ACCESS_CHANGE',
    scopeSummary: '',
    changeReason: '',
    testEvidenceRef: '',
    rollbackPlanRef: '',
    traceId: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = {
      scopeSummary: formData.scopeSummary.trim(),
      changeReason: formData.changeReason.trim(),
      testEvidenceRef: formData.testEvidenceRef.trim(),
      rollbackPlanRef: formData.rollbackPlanRef.trim(),
      traceId: formData.traceId.trim(),
    };

    if (
      !normalized.scopeSummary ||
      !normalized.changeReason ||
      !normalized.testEvidenceRef ||
      !normalized.rollbackPlanRef
    ) {
      setError(REQUIRED_FIELD_ERROR);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        changeType: formData.changeType,
        scopeSummary: normalized.scopeSummary,
        changeReason: normalized.changeReason,
        testEvidenceRef: normalized.testEvidenceRef,
        rollbackPlanRef: normalized.rollbackPlanRef,
      };

      if (normalized.traceId) {
        payload.traceId = normalized.traceId;
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to create change ticket.'));
      }

      const created = await response.json();
      navigate(`/dashboard/control-gates/change-tickets/${created.id}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create change ticket.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/dashboard/control-gates/change-tickets')}
          className={adminButtonClass('detailUtility')}
        >
          <ArrowLeft size={20} />
          Back
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Change Ticket</h1>
          <p className="mt-1 text-sm text-gray-500">
            Open a change ticket with the minimum evidence required.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {error && (
            <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-600">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Change Type <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.changeType}
                onChange={(e) => setFormData((prev) => ({ ...prev, changeType: e.target.value }))}
                className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              >
                {CHANGE_TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Trace ID</label>
              <input
                value={formData.traceId}
                onChange={(e) => setFormData((prev) => ({ ...prev, traceId: e.target.value }))}
                className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Scope Summary <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.scopeSummary}
              onChange={(e) => setFormData((prev) => ({ ...prev, scopeSummary: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Change Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.changeReason}
              onChange={(e) => setFormData((prev) => ({ ...prev, changeReason: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Test Evidence Ref <span className="text-red-500">*</span>
              </label>
              <input
                value={formData.testEvidenceRef}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, testEvidenceRef: e.target.value }))
                }
                className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Rollback Plan Ref <span className="text-red-500">*</span>
              </label>
              <input
                value={formData.rollbackPlanRef}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, rollbackPlanRef: e.target.value }))
                }
                className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-admin-border pt-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard/control-gates/change-tickets')}
              className={adminButtonClass('modalCancel')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={adminButtonClass('modalConfirm')}
            >
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Save size={18} />
              )}
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChangeTicketCreatePage;
