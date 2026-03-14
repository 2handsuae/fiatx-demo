import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

const CHANGE_TYPE_OPTIONS = [
  'SYSTEM',
  'SECURITY',
  'ACCESS_CONTROL',
  'CONFIG',
  'HOTFIX',
  'ACCOUNTING',
];

const ChangeTicketCreatePage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    changeType: 'SYSTEM',
    scopeSummary: '',
    testEvidenceRef: '',
    rollbackPlanRef: '',
    emergency: false,
    emergencyReason: '',
    postApprovalDueAt: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (formData.emergency && !formData.emergencyReason.trim()) {
      setError('Emergency reason is required when the ticket is marked as emergency.');
      setLoading(false);
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        changeType: formData.changeType,
        scopeSummary: formData.scopeSummary.trim(),
        testEvidenceRef: formData.testEvidenceRef.trim(),
        rollbackPlanRef: formData.rollbackPlanRef.trim(),
        emergency: formData.emergency,
      };

      if (formData.emergencyReason.trim()) {
        payload.emergencyReason = formData.emergencyReason.trim();
      }
      if (formData.postApprovalDueAt.trim()) {
        payload.postApprovalDueAt = new Date(formData.postApprovalDueAt).toISOString();
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/change-tickets`,
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
      navigate(`/dashboard/governance/change-tickets/${created.id}`);
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
          onClick={() => navigate('/dashboard/governance/change-tickets')}
          className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Change Ticket</h1>
          <p className="mt-1 text-sm text-gray-500">
            Open a release-gated governance ticket with the minimum evidence required.
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
              <label className="block text-sm font-medium text-gray-700">Risk Level</label>
              <input
                value="HIGH"
                readOnly
                className="w-full rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-gray-600"
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

          <div className="rounded-xl border border-admin-border bg-gray-50 p-4">
            <div className="flex items-center gap-3">
              <input
                id="emergency"
                type="checkbox"
                checked={formData.emergency}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, emergency: e.target.checked }))
                }
                className="h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary"
              />
              <label htmlFor="emergency" className="text-sm font-medium text-gray-700">
                Mark as emergency change
              </label>
            </div>

            {formData.emergency && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Emergency Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={formData.emergencyReason}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, emergencyReason: e.target.value }))
                    }
                    rows={3}
                    className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Post Approval Due At
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.postApprovalDueAt}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, postApprovalDueAt: e.target.value }))
                    }
                    className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-admin-border pt-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard/governance/change-tickets')}
              className="rounded-lg border border-admin-border bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-6 py-2 text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
