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
3. fixed initial password notice: `123456`
- SHOULD keep role selection sourced from `GET /admin/iam/roles`.

## 3) Seeded Role Admin Accounts (Base Config)
- Base seed MUST preserve one fixed admin account per RBAC role (17 total), including:
1. `SUPER_ADMIN` -> `admin@fiatx.com` (`ADMIN-001`)
2. `IAM_ADMIN` -> `iam_admin@fiatx.com`
3. `APPROVER` -> `approver@fiatx.com`
4. `COMPLIANCE_OFFICER` -> `compliance_officer@fiatx.com`
5. `MLRO` -> `mlro@fiatx.com`
6. `ALERT_ANALYST` -> `alert_analyst@fiatx.com`
7. `CUSTOMER_OPS` -> `customer_ops@fiatx.com`
8. `TRADING_OPS` -> `trading_ops@fiatx.com`
9. `TREASURY_MAKER` -> `treasury_maker@fiatx.com`
10. `TREASURY_CHECKER` -> `treasury_checker@fiatx.com`
11. `ACCOUNTING_OPS` -> `accounting_ops@fiatx.com`
12. `SETTLEMENT_OPS` -> `settlement_ops@fiatx.com`
13. `RECON_OPS` -> `recon_ops@fiatx.com`
14. `CONFIG_ADMIN` -> `config_admin@fiatx.com`
15. `AUDIT_OFFICER` -> `audit_officer@fiatx.com`
16. `DPO` -> `dpo@fiatx.com`
17. `CISO` -> `ciso@fiatx.com`
- MUST NOT add an extra `super_admin@...` seed identity.

## 4) Seed Behavior Rules
- Seed sync MUST be idempotent by email (`upsert`).
- Seed sync MUST enforce:
1. `status=ACTIVE`
2. deterministic `userNo`
3. compatibility field `users.role` equals target role code
4. target role exists in `user_roles`
5. non-target roles removed for seed role accounts (single-role convergence)
- Seed sync MAY reset seeded account password to configured default for demo baseline consistency.

## 5) Completeness Guard (`ensureBaseSeeded`)
- Base completeness check MUST include role seed account integrity:
1. all 17 accounts exist
2. each account is ACTIVE
3. each account has exact mapped role binding in `user_roles`
4. `admin@fiatx.com` owns `SUPER_ADMIN`
- If any check fails, `ensureBaseSeeded` MUST rerun base seed and repair.

## 6) Authorization Truth and Compatibility
- Authorization truth MUST remain `user_roles + role_permissions`.
- `users.role` MUST be treated as compatibility/display field only.
- This constraint MUST NOT introduce schema migration or API contract change by itself.

## 7) Delivery Checklist for Related Threads
- Update `prisma/seed.base.ts` and verify base seed idempotency.
- Verify role-seed accounts remain 17 after repeated `db:base:sync`.
- Verify seed drift repair:
1. missing role account is recreated
2. wrong extra role binding is converged back
- Verify `Platform Members` entry and create-member modal remain available in admin UI.
