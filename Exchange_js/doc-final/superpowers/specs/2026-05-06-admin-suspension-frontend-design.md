# C4 Admin Account Suspension — Frontend Design Spec

Date: 2026-05-06
Status: Approved
Scope: Admin-web UI only (backend already complete per `2026-05-05-admin-suspension-design.md`)

## Purpose

Add a "Suspend User" entry point in the admin-web `PlatformMemberDetailPage` so that CISO / TECH_OFFICER can initiate account suspension through the existing backend API (`POST /users/:id/suspend`).

## Approach

Inline in `PlatformMemberDetailPage.tsx`, following the exact same pattern as the existing Role Change feature (button in Actions section + modal at bottom of component). No new components or files besides a permission constant.

## Backend API Contract

```
POST /users/:id/suspend
Headers: Authorization: Bearer <jwt>
Body: { "reason": "string (required, trimmed)" }

Success 201:
{
  "approvalNo": "APPR-000042",
  "traceId": "uuid",
  "targetUserNo": "ADM-000003",
  "status": "PENDING"
}

Error 400: User is SUPER_ADMIN / already SUSPENDED / invalid status
Error 403: No permission / cannot suspend yourself
Error 404: User not found
Error 409: Duplicate pending suspension already exists
```

## UI Design

### 1. Suspend Button

- **Location**: Actions section of `PlatformMemberDetailPage`, after the existing "Change Roles" button
- **Visibility**: `(member.status === 'ACTIVE' || member.status === 'INACTIVE')` AND `hasAnyPermission([PERMISSIONS.USERS_SUSPEND])`
- **Variant**: `adminButtonClass('workflowNegative')` — red destructive style
- **Icon**: `UserX` from `lucide-react`
- **Label**: "Suspend User"
- **Click handler**: Opens the suspend confirmation modal

### 2. Suspend Confirmation Modal

Follows the Role Change modal pattern (overlay + centered card).

**Structure:**

```
┌─────────────────────────────────────────┐
│ Suspend Admin Account                   │
│ For: ADM-000003 (user@example.com)      │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ⚠ This will submit a suspension    │ │
│ │ request for approval. If approved,  │ │
│ │ this user will be immediately       │ │
│ │ blocked from accessing the admin    │ │
│ │ panel.                              │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ REASON FOR SUSPENSION                   │
│ ┌─────────────────────────────────────┐ │
│ │ (textarea placeholder:              │ │
│ │  "Describe why this account should  │ │
│ │   be suspended…")                   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│              [Cancel] [Submit for Approval] │
└─────────────────────────────────────────┘
```

**Styling (all `adm-*` tokens):**
- Overlay: `bg-black/50`, `z-[100]`
- Card: `border-adm-border bg-adm-panel rounded-lg shadow-xl max-w-md`
- Title: `font-mono text-[13px] font-semibold text-adm-t1`
- Subtitle: `font-mono text-[10px] text-adm-t3`
- Warning box: `border-adm-amber/30 bg-adm-amber/10 text-adm-amber font-mono text-[11px]`
- Reason label: `font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3`
- Textarea: `border-adm-border bg-adm-bg text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber font-mono text-[11px] h-20`
- Cancel button: `adminButtonClass('modalCancel')`
- Submit button: `adminButtonClass('modalConfirm')`, disabled when `!suspendReason.trim() || submittingSuspend`
- Submit label toggles: "Submitting…" while in flight, "Submit for Approval" otherwise

### 3. State Additions

Three new state variables in `PlatformMemberDetailPage`:

```typescript
const [showSuspendModal, setShowSuspendModal] = useState(false);
const [suspendReason, setSuspendReason] = useState('');
const [submittingSuspend, setSubmittingSuspend] = useState(false);
```

### 4. Submit Handler

```typescript
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
    if (!res.ok) {
      const msg = await getApiErrorMessage(res, 'Failed to submit suspension request');
      throw new Error(msg);
    }
    const data = await res.json();
    setShowSuspendModal(false);
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

### 5. Permission Constant

Add to `admin-web/src/rbac/permissions.ts`:

```typescript
USERS_SUSPEND: 'api.post.users_id_suspend',
```

## Files Changed

| File | Change |
|---|---|
| `admin-web/src/rbac/permissions.ts` | Add `USERS_SUSPEND` constant |
| `admin-web/src/pages/PlatformMemberDetailPage.tsx` | Add `UserX` import, 3 state vars, `handleSubmitSuspend`, button in Actions, modal at bottom |

## Compliance with Frontend Rules

| Rule | How Met |
|---|---|
| API calls via `adminFetch` | `handleSubmitSuspend` uses `adminFetch` |
| API host from `VITE_API_URL` | Template literal uses `import.meta.env.VITE_API_URL` |
| `AdminSessionError` silent return | Caught and returned early |
| Permission gate via `hasAnyPermission` | Button visibility gated |
| Shared primitives only | Uses `adminButtonClass`, `AdminBadge` (existing) |
| `adm-*` design tokens | All colors use `adm-*` tokens, no raw Tailwind colors |
| No hardcoded API hosts | Confirmed |
| No Chinese as default UI language | All labels in English |

## Out of Scope

- Reactivation UI (C4b, separate workflow)
- Suspension status banner on detail page (nice-to-have, not required for MVP)
- Bulk suspension from list page
- PlatformMembers list page changes (already has SUSPENDED in status filter)
