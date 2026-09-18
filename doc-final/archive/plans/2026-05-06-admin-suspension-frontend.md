# C4 Admin Suspension Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Suspend User" button and confirmation modal to the admin-web PlatformMemberDetailPage so CISO/TECH_OFFICER can initiate account suspension.

**Architecture:** Inline additions to the existing detail page component following the Role Change modal pattern. One new permission constant.

**Tech Stack:** React, TypeScript, Tailwind CSS (adm-* tokens), lucide-react icons, adminFetch

---

### Task 1: Add USERS_SUSPEND permission constant

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts:14` (after `IAM_ROLE_CHANGE_REQUEST_DETAIL_READ`)

- [ ] **Step 1: Add the permission constant**

In `admin-web/src/rbac/permissions.ts`, add after line 14 (`IAM_ROLE_CHANGE_REQUEST_DETAIL_READ`):

```typescript
  USERS_SUSPEND: 'api.post.users_id_suspend',
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to permissions.ts

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/rbac/permissions.ts
git commit -m "feat(admin): add USERS_SUSPEND permission constant"
```

---

### Task 2: Add suspend button, handler, and modal to PlatformMemberDetailPage

**Files:**
- Modify: `admin-web/src/pages/PlatformMemberDetailPage.tsx`

- [ ] **Step 1: Add UserX to lucide-react import**

Change the import on line 3 from:

```typescript
import { Mail, RefreshCw, Copy, Check, ShieldCheck, X } from 'lucide-react';
```

to:

```typescript
import { Mail, RefreshCw, Copy, Check, ShieldCheck, UserX, X } from 'lucide-react';
```

- [ ] **Step 2: Add suspend state variables**

After the role change state block (line 103, after `const [submittingRoleChange, setSubmittingRoleChange] = useState(false);`), add:

```typescript
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [submittingSuspend, setSubmittingSuspend] = useState(false);
```

- [ ] **Step 3: Add handleSubmitSuspend handler**

After the `handleSubmitRoleChange` function (after line 203), add a new section:

```typescript
  /* ── Suspend user ── */

  const handleSubmitSuspend = async () => {
    if (!member || !suspendReason.trim()) return;
    setSubmittingSuspend(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/users/${id}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit suspension request'));
      const data = await res.json();
      setShowSuspendModal(false);
      setSuspendReason('');
      setNotice(`Suspension request submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit suspension request.');
    } finally {
      setSubmittingSuspend(false);
    }
  };
```

- [ ] **Step 4: Add canSuspend derived variable and update showActions**

In the "Derived" section (around line 249-256), change:

```typescript
  const canChangeRoles =
    member.status === 'ACTIVE' && hasAnyPermission([PERMISSIONS.IAM_ROLE_CHANGE_REQUESTS_CREATE]);
  const showActions = canResend || canChangeRoles;
```

to:

```typescript
  const canChangeRoles =
    member.status === 'ACTIVE' && hasAnyPermission([PERMISSIONS.IAM_ROLE_CHANGE_REQUESTS_CREATE]);
  const canSuspend =
    (member.status === 'ACTIVE' || member.status === 'INACTIVE') &&
    hasAnyPermission([PERMISSIONS.USERS_SUSPEND]);
  const showActions = canResend || canChangeRoles || canSuspend;
```

- [ ] **Step 5: Add Suspend User button in sidebar Actions**

In the sidebar Actions section (around line 358-383), add the suspend button after the "Resend Invitation" button block and before the closing `</div>` of the button container:

After:
```typescript
                {canResend && (
                  <button
                    onClick={() => void handleResend()}
                    disabled={resending}
                    className={adminButtonClass('detailUtility')}
                  >
                    <Mail size={13} />
                    {resending ? 'Reissuing…' : 'Resend Invitation'}
                  </button>
                )}
```

Add:
```typescript
                {canSuspend && (
                  <button
                    onClick={() => { setSuspendReason(''); setShowSuspendModal(true); }}
                    className={adminButtonClass('workflowNegative')}
                  >
                    <UserX size={13} />
                    Suspend User
                  </button>
                )}
```

- [ ] **Step 6: Add Suspend Confirmation Modal**

After the Role Change Modal closing tag (`{/* ════ Role Change Modal ════ */}` block ends at line 493), add the suspend modal before the final `</div>`:

```typescript
      {/* ════ Suspend Modal ════ */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Suspend Admin Account
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {member.userNo} · {member.email}
                </p>
              </div>
              <button
                onClick={() => setShowSuspendModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a suspension request for approval. If approved, this user will be
                immediately blocked from accessing the admin panel.
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Suspension
                </p>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this account should be suspended…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowSuspendModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitSuspend()}
                disabled={submittingSuspend || !suspendReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingSuspend ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 8: Verify in browser**

Run: `npm run dev:start` (if not already running)

1. Navigate to `http://localhost:3501/dashboard/members`
2. Click on an ACTIVE user to go to their detail page
3. Verify "Suspend User" red button appears in the sidebar Actions section
4. Click "Suspend User" → modal opens with warning and reason textarea
5. Type a reason → "Submit for Approval" becomes enabled
6. Submit → success notice shows with approval number
7. Verify a SUSPENDED user does NOT show the "Suspend User" button

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/PlatformMemberDetailPage.tsx
git commit -m "feat(admin): add suspend user button and confirmation modal to member detail page"
```
