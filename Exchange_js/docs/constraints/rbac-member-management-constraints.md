# RBAC Member Management Constraints

## 1) UI Boundary for Backend Member Management
- MUST keep `Platform Members` as the member operation page:
1. list members
2. create member
3. assign roles per member
- MUST keep role/permission explanation in dedicated `Role Management` page.
- MUST NOT duplicate role/permission catalog blocks into `Platform Members`.

## 2) Platform Members Entry and Form Contract
- MUST keep menu entry path `Backend Member Management -> Platform Members`.
- MUST keep create-member form contract:
1. email required
2. at least one role required
3. create result is `INACTIVE` and returns one-time invitation link metadata (`inviteLink`, `inviteExpiresAt`, `inviteStatus`)
- MUST keep activation contract:
1. invited member sets password via invitation link
2. member status switches `INACTIVE -> ACTIVE` only after successful invitation acceptance
3. only one active invitation token per member at a time (resend invalidates previous token)
- MUST keep invitation TTL contract:
1. default invitation validity is `24h`
2. expired/revoked/consumed tokens MUST be rejected explicitly
- SHOULD keep first-stage delivery mode as manual invite-link handoff from admin UI (no SMTP dependency required).
- SHOULD keep role selection sourced from `GET /admin/iam/roles`.

## 3) API and Login Contract (Invitation Activation)
- MUST keep API contracts:
1. `POST /users` returns invitation metadata for new `INACTIVE` member
2. `POST /users/:id/invitations/resend` issues a new invitation and invalidates prior active token
3. `GET /auth/admin-invitations/:token` validates invitation usability
4. `POST /auth/admin-invitations/accept` sets password and activates account
- MUST keep login gate:
1. `INACTIVE` admin account login MUST be rejected with readable activation-required message
2. `ACTIVE` transition happens only after invitation acceptance succeeds
- MUST keep soft-delete gate for governed admin-user deletion:
1. soft-deleted admin users MUST be excluded from platform member lists
2. soft-deleted admin users MUST be rejected by admin login/session lookup
3. invitation preview, resend, and acceptance MUST reject soft-deleted admin users

## 4) Seeded Role Admin Accounts (Base Config)
- Base seed MUST preserve one fixed admin account per active RBAC role (10 total), including:
1. `SUPER_ADMIN` -> `admin@fiatx.com` (`ADMIN-001`)
2. `RI` -> `ri@fiatx.com`
3. `SM` -> `sm@fiatx.com`
4. `TECH_ADMIN` -> `tech_admin@fiatx.com`
5. `OPS_TREASURY` -> `ops_treasury@fiatx.com`
6. `FINANCE` -> `finance@fiatx.com`
7. `COMPLIANCE_LEAD` -> `compliance_lead@fiatx.com`
8. `MLRO` -> `mlro@fiatx.com`
9. `DPO` -> `dpo@fiatx.com`
10. `CISO` -> `ciso@fiatx.com`
- MUST NOT add an extra `super_admin@...` seed identity.
- Legacy JS role seed identities MUST NOT be recreated in local base seed.
- If stale legacy role rows exist in an old local database, they MAY be deactivated during one-time cleanup, but MUST NOT be returned by `GET /admin/iam/roles` and MUST NOT be assignable.

## 5) Seed Behavior Rules
- Seed sync MUST be idempotent by email (`upsert`).
- Seed sync MUST enforce:
1. `status=ACTIVE`
2. deterministic `userNo`
3. compatibility field `users.role` equals target role code
4. target role exists in `user_roles`
5. non-target roles removed for seed role accounts (single-role convergence)
- Seed sync MAY reset seeded account password to configured default for demo baseline consistency.

## 6) Completeness Guard (`ensureBaseSeeded`)
- Base completeness check MUST include role seed account integrity:
1. all 10 active role accounts exist
2. each account is ACTIVE
3. each account has exact mapped role binding in `user_roles`
4. `admin@fiatx.com` owns `SUPER_ADMIN`
- If any check fails, `ensureBaseSeeded` MUST rerun base seed and repair.

## 7) Authorization Truth and Compatibility
- Authorization truth MUST remain `user_roles + role_permissions`.
- `users.role` MUST be treated as compatibility/display field only.
- This constraint MUST NOT introduce schema migration or API contract change by itself.

## 8) Delivery Checklist for Related Threads
- Update `prisma/seed.base.ts` and verify base seed idempotency.
- Verify role-seed accounts remain 10 after repeated `db:base:sync`.
- Verify seed drift repair:
1. missing role account is recreated
2. wrong extra role binding is converged back
- Verify `Platform Members` entry and create-member modal remain available in admin UI.
- Verify invitation activation flow:
1. create returns invite metadata and member is `INACTIVE`
2. resend invalidates previous token
3. accept sets password and flips status to `ACTIVE`
4. `INACTIVE` login rejected before activation

## 9) Governance Phase-2 Permission Baseline
- `Control Gates Center -> Change Tickets` MUST follow the phase-2 role matrix:
1. all Java roles can read
2. `TECH_ADMIN / FINANCE / OPS_TREASURY / COMPLIANCE_LEAD / CISO` can create and submit
3. `TECH_ADMIN / CISO` can run gate checks and mark deploy status
4. `TECH_ADMIN` can close
5. `SUPER_ADMIN` keeps full-site bypass permissions for demo
- `GET /auth/me` permission resolution MUST expose the above permissions after `db:base:sync`.

## 10) Governance Phase-4 Permission Baseline
- `Control Gates Center -> SLA Timers` MUST follow the phase-4 role matrix:
1. `TECH_ADMIN / CISO / COMPLIANCE_LEAD / MLRO / DPO / RI / SM` can read
2. `TECH_ADMIN / CISO / COMPLIANCE_LEAD` can close `CHANGE_POST_APPROVAL_FOLLOWUP`
3. `OPS_TREASURY / FINANCE` have no SLA timer access in this phase
4. `SUPER_ADMIN` keeps full-site bypass permissions for demo
- `GET /auth/me` permission resolution MUST expose the above permissions after `db:base:sync`.
