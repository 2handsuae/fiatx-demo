#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# package-release.sh — build a self-contained release zip.
#
# Produces Exchange_js-release-<timestamp>.zip containing:
#   - a clean export of all git-tracked source (no node_modules/.git/.env)
#   - .env.example (tracked)
#   - SETUP.md (tracked)
#   - prisma/dev.db  ← a freshly built, base + governance-seeded database
#
# The recipient can either run the included DB as-is, or recreate it with
# `npm run db:setup`. See SETUP.md.
#
#   npm run package:release
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_DIR}"

command -v git >/dev/null  || { echo "git not found" >&2; exit 1; }
command -v zip >/dev/null  || { echo "zip not found" >&2; exit 1; }

STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_NAME="Exchange_js-release-${STAMP}"
STAGE="$(mktemp -d)"
OUT_DIR="${STAGE}/${RELEASE_NAME}"
trap 'rm -rf "${STAGE}"' EXIT
mkdir -p "${OUT_DIR}"

echo "[package] exporting tracked source (git archive HEAD)"
git archive --format=tar HEAD | tar -x -C "${OUT_DIR}"

echo "[package] building fresh seeded database into the package"
PKG_DB="${OUT_DIR}/prisma/dev.db"
rm -f "${PKG_DB}" "${PKG_DB}-journal" "${PKG_DB}-wal" "${PKG_DB}-shm"
export DATABASE_URL="file:${PKG_DB}"
export GOVERNANCE_DEMO_ENABLED=true

# Build against the repo's installed node_modules / prisma, writing to PKG_DB.
npx prisma migrate deploy --schema "${APP_DIR}/prisma/schema.prisma"
npm run db:base:sync
# Governance demo is HTTP-driven (needs a running backend on API_URL). Best-effort:
# if a backend is reachable it gets baked in, otherwise the package ships with
# base data only and the recipient runs `npm run db:seed:demo` after startup.
GOV_INCLUDED="no"
if npm run governance:demo:seed >/dev/null 2>&1; then
  GOV_INCLUDED="yes"
else
  echo "[package] NOTE: governance demo seed skipped (no backend reachable) — base data only"
fi
# Drop WAL side-files so the packaged DB is a single self-contained file.
rm -f "${PKG_DB}-journal" "${PKG_DB}-wal" "${PKG_DB}-shm"

# Guard: the package must NOT contain a real .env (secrets) — only the example.
rm -f "${OUT_DIR}/.env"

echo "[package] zipping"
( cd "${STAGE}" && zip -rq "${APP_DIR}/${RELEASE_NAME}.zip" "${RELEASE_NAME}" )

DB_BYTES="$(wc -c < "${PKG_DB}" | tr -d ' ')"
echo "[package] done."
echo "  archive : ${APP_DIR}/${RELEASE_NAME}.zip"
echo "  db      : prisma/dev.db (${DB_BYTES} bytes; base seeded, governance demo: ${GOV_INCLUDED})"
echo "  recipient: unzip, npm install, copy .env.example -> .env, npm run start:dev"
