// admin-web/src/components/CustomerProfileEditModal.tsx
//
// 战役丙波四 T8：运营改客户档案（CDD 七字段）。形态照 MaterialRequestIssueModal（遮罩 + 表单 + 底部两按钮）。
// 只发「与现值不同」的字段；后端白名单外的键整单 400，这里本来就不会发。
// 每次保存后端落一条 CUSTOMER_PROFILE_UPDATED 审计（逐字段 before/after，证件号与住址打码）。

import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

export type ProfileFieldKey =
  | 'firstName'
  | 'lastName'
  | 'dateOfBirth'
  | 'nationality'
  | 'idDocType'
  | 'idDocNumber'
  | 'residentialAddress';

export type ProfileFieldValues = Record<ProfileFieldKey, string>;

const FIELDS: { key: ProfileFieldKey; label: string; individualOnly?: boolean; placeholder?: string }[] = [
  { key: 'firstName', label: 'First Name', individualOnly: true },
  { key: 'lastName', label: 'Last Name', individualOnly: true },
  { key: 'dateOfBirth', label: 'Date of Birth', placeholder: 'YYYY-MM-DD' },
  { key: 'nationality', label: 'Nationality', placeholder: 'e.g. AE' },
  { key: 'idDocType', label: 'ID Type', placeholder: 'e.g. EMIRATES_ID' },
  { key: 'idDocNumber', label: 'ID Number' },
  { key: 'residentialAddress', label: 'Residential Address' },
];

interface CustomerProfileEditModalProps {
  open: boolean;
  customerNo: string;
  customerLabel: string;
  isCorporate: boolean;
  /** 当前档案值（空值传 ''）。 */
  initial: ProfileFieldValues;
  onClose: () => void;
  onSaved: (changedFields: ProfileFieldKey[]) => Promise<void> | void;
}

const CustomerProfileEditModal = ({
  open,
  customerNo,
  customerLabel,
  isCorporate,
  initial,
  onClose,
  onSaved,
}: CustomerProfileEditModalProps) => {
  const [values, setValues] = useState<ProfileFieldValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValues(initial);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = FIELDS.filter((f) => !(isCorporate && f.individualOnly));
  // 只发与现值不同且非空的字段（不支持在本弹窗里清空字段）。
  const patch: Partial<ProfileFieldValues> = {};
  for (const f of shown) {
    const next = values[f.key].trim();
    if (next && next !== initial[f.key]) patch[f.key] = next;
  }
  const changedKeys = Object.keys(patch) as ProfileFieldKey[];

  const submit = async () => {
    if (changedKeys.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/customers/${customerNo}/profile`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to update customer profile.'));
      await onSaved(changedKeys);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to update customer profile.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Edit Profile</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {customerLabel} · {customerNo} — CDD fields only. Every save is written to the audit log with a
            field-by-field before/after (ID number and address are masked there).
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}
          {shown.map((f) => (
            <div key={f.key} className="mb-4 last:mb-0">
              <label
                htmlFor={`profile-edit-${f.key}`}
                className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3"
              >
                {f.label}
              </label>
              <input
                id={`profile-edit-${f.key}`}
                value={values[f.key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                disabled={submitting}
                className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || changedKeys.length === 0}
            className={adminButtonClass('workflowPrimary')}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerProfileEditModal;
