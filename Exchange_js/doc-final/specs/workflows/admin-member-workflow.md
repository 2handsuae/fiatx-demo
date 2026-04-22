# Admin Member Workflow
Wave: 1 | Source verified: users.service.ts, users.controller.ts, admin-invitations.service.ts, auth.controller.ts, access-control.service.ts, access-control.controller.ts, governed-execution.listener.ts
Last Updated: 2026-04-21

## Purpose
End-to-end lifecycle for admin member accounts: governed provisioning via Change Ticket, invitation-link activation, and role binding changes (also via Change Ticket).

## Actors
| Actor | Role |
|---|---|
| Requesting Admin | Creates the provisioning or role-change Change Ticket |
| CISO | Approves the Change Ticket's linked ApprovalCase |
| Consumer Admin | Consumes the READY Change Ticket, triggering actual user creation / role update |
| New Admin Member | Receives the invitation link and activates their account |

## Admin Member Status Values (`User.status`)
| Status | Description |
|---|---|
| INACTIVE | Account created; invitation sent but not yet accepted |
| ACTIVE | Invitation accepted; password set; can log in |
| (soft-deleted) | `deletedAt` is non-null; treated as not-found by all queries |

## Invitation Status (`AdminUserInvitation`)
| Status (computed) | Condition |
|---|---|
| PENDING | `revokedAt = null`, `consumedAt = null`, `expiresAt > now` |
| EXPIRED | `revokedAt = null`, `consumedAt = null`, `expiresAt <= now` |
| USED | `consumedAt != null` |
| REVOKED | `revokedAt != null` |

TTL: 24 hours from issuance (`INVITATION_TTL_MS = 24 * 60 * 60 * 1000`).

## Flow A: New Admin Member Provisioning

### A1. Create Change Ticket (DRAFT)
Requesting Admin calls `POST /users` with `{ email, roleCodes[], changeReason }`.  
Internally calls `changeTicketsService.createAdminMemberProvisioningTicket`. The service:
- Normalizes email (lowercase) and role codes (uppercase, deduplicated).
- Creates a `ADMIN_ACCESS_CHANGE` Change Ticket in DRAFT with frozen `bindingSnapshotJson`:
  ```json
  { "intent": "ADMIN_MEMBER_PROVISIONING", "email": "...", "roleCodes": [...], "ticketNo": "...", ... }
  ```
- Returns the ticket (no user account created yet).

### A2. Submit Change Ticket (DRAFT → PENDING_APPROVAL)
Requesting Admin calls `POST /admin/control-gates/change-tickets/:id/submit`.  
Creates a `CHANGE_TICKET_APPROVAL` ApprovalCase (checker role: `CISO`) and links it to the ticket.

### A3. CISO Approves (PENDING_APPROVAL → READY)
CISO calls `POST /admin/control-gates/approvals/:id/approve`.  
On approval, `syncApprovalProjectionByEvent` moves ticket to READY.

### A4. Consume Change Ticket (READY → DONE)
Consumer Admin calls `POST /admin/control-gates/change-tickets/:id/consume` with `{ success: true }`.  
`GovernedExecutionListener` handles `CHANGE_TICKET_CONSUMED` event with `binding.intent = ADMIN_MEMBER_PROVISIONING`:
1. Calls `usersService.executeAdminMemberProvisioning(binding, actor)`.
2. Inside `createAdminUser`:
   - Creates `User` record with `status = INACTIVE`, a temporary bcrypt password, and a generated `userNo` (`ADM-XXXXXX`).
   - Calls `adminInvitationsService.createInvitationForUser` — creates `AdminUserInvitation` row with `tokenHash` (SHA-256 of random 24-byte token), sets `expiresAt = now + 24h`. Revokes any pre-existing valid invitations for the same user.
   - Calls `accessControlService.replaceUserRoles` to bind the requested roles.
   - Returns `{ userNo, email, status: "INACTIVE", inviteLink, inviteExpiresAt }`.
3. **Idempotency**: if `email` already exists and the user is still `INACTIVE` with the same role codes, `executeAdminMemberProvisioning` resends the invitation instead of failing.

### A5. Member Activation (INACTIVE → ACTIVE)
New member opens `inviteLink` → `GET /auth/admin-invitations/:token` to preview (validates token, returns email + expiry).  
Then submits `POST /auth/admin-invitations/accept` with `{ token, password }`:
- Verifies token hash, checks not revoked / consumed / expired, user still INACTIVE.
- Sets user `password = bcrypt(password)`, `status = ACTIVE`, resets `failedLoginAttempts`, clears `lockedUntil`.
- Marks invitation `consumedAt = now`. Revokes any other outstanding invitations for this user.
- Records `ADMIN_INVITATION_ACCEPTED` audit entry.

## Flow B: Role Binding Change

### B1. Create Change Ticket (DRAFT)
Admin calls `PUT /admin/iam/users/:id/roles` with `{ roleCodes[], changeReason }`.  
Internally calls `changeTicketsService.createAdminRoleBindingChangeTicket`. Creates a `RBAC_CATALOG_CHANGE` ticket with frozen binding:
```json
{ "intent": "ADMIN_ROLE_BINDING_CHANGE", "targetUserId": "...", "targetUserNo": "...", "roleCodes": [...], ... }
```

### B2–B4. Submit → Approve → Consume (same as Flow A steps A2–A4)
`GovernedExecutionListener` routes `binding.intent = ADMIN_ROLE_BINDING_CHANGE` →  
`accessControlService.executeGovernedRoleBindingChange(binding, actor)` which calls `replaceUserRoles` on the target user.

## Key Rules
- **Invitation link is single-use**: `consumedAt` is set on first accept; re-use throws `BadRequestException('Invitation link already used')`.
- **Token is never stored in plain text**: the service stores only `tokenHash = SHA-256(token)`. The raw token appears only in the invitation link returned to the provisioning caller.
- **Re-invite on INACTIVE user**: `POST /users/:id/invitations/resend` can re-issue a new invitation for any user in `INACTIVE` state (revokes previous valid invitations first).
- **Role hard-mutex enforcement**: `accessControlService.validateHardMutex` blocks certain role combinations (e.g., CISO + DPO) unless SUPER_ADMIN. Soft-warning combos are allowed but logged.
- **Binding snapshot is immutable**: role codes approved by the CISO are locked in the CT snapshot; the consumer cannot alter them at execution time.
- **SoD on CT approve**: per the approval workflow, the admin who created the CT cannot also be the CISO approver (unless SUPER_ADMIN).
- **Governed execution only**: user account creation from the provisioning path goes through the Change Ticket governance flow. Direct `createAdminUser` is an internal method; the public API creates a ticket, not a user.
- **Invitation TTL**: 24 hours. After expiry, a new invitation must be issued via resend endpoint or by consuming a new CT.

## API Endpoints
| Method | Path | Actor | Description |
|---|---|---|---|
| POST | /users | Admin | Create ADMIN_ACCESS_CHANGE change ticket (provisioning) |
| GET | /users | Admin | List admin members |
| GET | /users/:id | Admin | Get member detail with latest invitation status |
| POST | /users/:id/invitations/resend | Admin | Re-issue invitation link for INACTIVE member |
| PUT | /admin/iam/users/:id/roles | Admin | Create RBAC_CATALOG_CHANGE change ticket (role binding) |
| GET | /admin/iam/users/:id/roles | Admin | Get current role bindings for a user |
| GET | /admin/iam/roles | Admin | List role catalog |
| GET | /admin/iam/permissions | Admin | List permission catalog |
| GET | /auth/admin-invitations/:token | Public | Preview invitation (validate token, return email + expiry) |
| POST | /auth/admin-invitations/accept | Public | Accept invitation, set password, activate account |
