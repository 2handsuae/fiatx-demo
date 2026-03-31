import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

const TARGET_TYPE_OPTIONS = [
  'CHANGE_TICKET',
  'AUDIT_EVIDENCE_PACKAGE',
  'COMPLIANCE_CASE_EVIDENCE_PACKAGE',
  'ADMIN_USER',
];

const DeleteRequestCreatePage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    targetType: 'CHANGE_TICKET',
    targetNo: '',
    deleteReason: '',
    docRef: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        targetType: formData.targetType,
        targetNo: formData.targetNo.trim(),
        deleteReason: formData.deleteReason.trim(),
      };
      if (formData.docRef.trim()) {
        payload.docRef = formData.docRef.trim();
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to create delete request.'));
      }

      const created = await response.json();
      navigate(`/dashboard/control-gates/delete-requests/${created.id}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create delete request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/dashboard/control-gates/delete-requests')}
          className={adminButtonClass('detailUtility')}
        >
          <ArrowLeft size={20} />
          Back
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Delete Request</h1>
          <p className="mt-1 text-sm text-gray-500">
            Open a governed soft-delete request using the target No as the primary input.
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
                Target Type <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.targetType}
                onChange={(e) => setFormData((prev) => ({ ...prev, targetType: e.target.value }))}
                className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              >
                {TARGET_TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Target No <span className="text-red-500">*</span>
              </label>
              <input
                value={formData.targetNo}
                onChange={(e) => setFormData((prev) => ({ ...prev, targetNo: e.target.value }))}
                className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                placeholder="e.g. CT2603140001 / EVP2603140001 / CEP2603140001 / ADM2603140001"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Delete Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.deleteReason}
              onChange={(e) => setFormData((prev) => ({ ...prev, deleteReason: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Doc Ref</label>
            <input
              value={formData.docRef}
              onChange={(e) => setFormData((prev) => ({ ...prev, docRef: e.target.value }))}
              className="w-full rounded-lg border border-admin-border px-3 py-2 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              placeholder="Optional supporting document reference"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-admin-border pt-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard/control-gates/delete-requests')}
              className={adminButtonClass('modalCancel')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={adminButtonClass('modalConfirm')}
            >
              <Save size={16} />
              {loading ? 'Creating...' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeleteRequestCreatePage;
