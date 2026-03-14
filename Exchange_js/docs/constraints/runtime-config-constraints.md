# Runtime and Config Constraints

## 1) Source of Truth for Config
- MUST keep backend runtime config in `Exchange_js/.env`.
- MUST keep frontend runtime config in:
1. `Exchange_js/admin-web/.env`
2. `Exchange_js/client-web/.env`
- MUST NOT hardcode environment values directly in source files when env key already exists.

## 2) Required Local Defaults
- Backend:
1. `API_PORT=3500`
2. `ADMIN_URL=http://localhost:3501`
3. `CLIENT_URL=http://localhost:3502`
4. `DATABASE_URL="file:/tmp/exchange_js_audit_evidence/dev.db"`
- Frontend:
1. `VITE_API_URL=http://localhost:3500` (admin/client both)

## 3) Database Path Convention (Critical)
- Local SQLite MUST use an ASCII-safe absolute path to avoid Prisma migrate failures on Unicode worktree paths.
- Default audit-evidence worktree DB file MUST be treated as: `/tmp/exchange_js_audit_evidence/dev.db`.
- Stack scripts MAY derive sibling defaults such as `/tmp/exchange_js_main/dev.db` or `/tmp/exchange_js_codex/dev.db`, but MUST stay in the `/tmp/exchange_js_<stack>/dev.db` pattern.
- Any script that bootstraps DB MUST read `DATABASE_URL` first and MUST NOT hardcode `file:./dev.db`.
- Local bootstrap MUST execute the versioned SQL chain in `prisma/migrations/**/migration.sql` via `scripts/apply-local-migrations.sh`; do not reintroduce ad-hoc schema patch functions.

## 4) Standard Runtime Commands
- MUST use these commands as local workflow standard:
1. `npm run dev:start` (full stack up)
2. `npm run dev:stop` (full stack down)
3. `npm run dev:reset` (business reset only; base config preserved or auto-ensured)
4. `npm run db:base:sync`
5. `npm run db:biz:init`
6. `npm run db:biz:reset`

## 5) Startup/Reset Behavior Constraints
- `dev:start` MUST:
1. ensure dependencies
2. ensure DB schema exists (if missing, bootstrap from migrations)
3. apply pending Prisma migrations for existing local DB before starting services
4. MUST NOT truncate or reset existing DB file during normal startup
5. auto-heal baseline IAM data when required seed tables are missing/empty (`users`, `roles`, `permissions`)
6. fail fast if base IAM data is still missing after `db:base:sync`
7. start backend/admin/client in fixed local ports
- `dev:rebuild` MUST:
1. stop local services first
2. rebuild only from the versioned local migration runner (`npm run db:migrate:local`)
3. run `db:base:sync`
4. leave business/demo data seeding as an explicit next step
- `stack up` MUST follow the same DB safety and auto-heal rules as `dev:start`.
- `dev:stop` MUST:
1. stop by managed PID first
2. clean fallback orphan processes for the same project
- `dev:reset` MUST:
1. reset business data only
2. apply pending Prisma migrations before business reset execution
3. MUST NOT truncate or reset DB file before business reset
4. not auto-start services

## 6) Safety Rules
- MUST NOT commit local runtime artifacts:
1. `node_modules/`
2. `dist/`
3. `*.db` and `*.db.*`
4. `*.log`
5. `.DS_Store`
- MUST NOT put secrets/tokens into committed files.
- SHOULD keep `.env` local and out of VCS.

## 7) Thread Delivery Checklist (Runtime)
- Env keys added/changed documented.
- Command behavior updated and verified (`start/stop/reset`).
- DB path resolution verified against Prisma behavior, and MUST avoid Unicode-path-only SQLite locations.
- Local migration bootstrap verified against `scripts/apply-local-migrations.sh`.
- No regression to fixed local port contract 3500/3501/3502.
