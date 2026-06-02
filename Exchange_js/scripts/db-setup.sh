#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# db-setup.sh — portable, one-command database creation.
#
# Creates a fresh SQLite database from the versioned Prisma migrations and
# seeds it with base IAM data + governance demo data. Safe to run on any
# machine; does NOT depend on the multi-stack /tmp tooling.
#
#   npm run db:setup
#
# Override the target DB with an env var:
#   DATABASE_URL="file:/abs/path/dev.db" npm run db:setup
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_DIR}"

# 1. Ensure a .env exists (convenience for fresh checkouts).
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[db:setup] created .env from .env.example"
fi

# 2. Resolve DATABASE_URL: explicit env override wins, else read from .env.
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")"
fi
if [[ -z "${DATABASE_URL}" ]]; then
  echo "[db:setup] ERROR: DATABASE_URL is empty (check .env)" >&2
  exit 1
fi
export DATABASE_URL
echo "[db:setup] DATABASE_URL=${DATABASE_URL}"

# 3. Make sure the DB directory exists (handles absolute or prisma-relative).
DB_PATH="${DATABASE_URL#file:}"
case "${DB_PATH}" in
  /*) : ;;                                   # absolute
  *)  DB_PATH="${APP_DIR}/prisma/${DB_PATH#./}" ;;  # relative → prisma/
esac
mkdir -p "$(dirname "${DB_PATH}")"

# 4. Generate client + apply every migration (structure).
echo "[db:setup] generating Prisma client"
npx prisma generate >/dev/null
echo "[db:setup] applying migrations"
npx prisma migrate deploy

# 5. Seed: base IAM (login works). Requires TigerBeetle running for the
#    account-provisioning step — start it first (dev:tb:format / dev:tb:start).
echo "[db:setup] seeding base IAM data"
npm run db:base:sync

# 6. Governance demo data is HTTP-driven (needs the backend running on API_URL).
#    Best-effort: skip cleanly if no backend is up; the recipient can run
#    `npm run db:seed:demo` after `npm run start:dev`.
echo "[db:setup] seeding governance demo data (best-effort; needs backend running)"
if GOVERNANCE_DEMO_ENABLED=true npm run db:seed:demo >/dev/null 2>&1; then
  echo "[db:setup] governance demo data seeded"
else
  echo "[db:setup] governance demo skipped (backend not reachable) — run later: npm run db:seed:demo"
fi

echo "[db:setup] done — database ready at ${DB_PATH}"
echo "If you skipped it: start the stack, then  npm run db:seed:demo"
