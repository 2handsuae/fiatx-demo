#!/usr/bin/env bash
# scripts/reset-business-complete.sh
#
# Complete business reset = restore the demo to its freshly-seeded baseline.
#
# Because TigerBeetle is append-only, a true zero-state reset requires the TB
# data file to be REFORMATTED. The TB reformat must happen with no process
# holding the data file, so the sequence is:
#
#   1. Clear all business-layer Prisma rows   (ts-node scripts/reset-business-data.ts)
#   2. Stop → reformat → start TigerBeetle     (scripts/dev-tigerbeetle.sh format + start)
#   3. Re-seed the business demo               (ts-node prisma/seed.ts --mode=business)
#
# Base IAM (users/roles/permissions/...) is NOT touched — it lives in the base seed.
#
# CAVEAT: the backend holds a TB connection. If the stack is running, stop it
# first (npm run dev:stop) so `format` can reclaim the TB data file; otherwise
# the reformat races a live writer. This script stops/reformats/starts TB itself,
# but it does NOT stop the backend — run it against a stopped stack.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

echo "[reset] 1/3 clearing business-layer Prisma data"
npx ts-node scripts/reset-business-data.ts

echo "[reset] 2/3 reformatting TigerBeetle (stop → format → start)"
bash "${SCRIPT_DIR}/dev-tigerbeetle.sh" format
bash "${SCRIPT_DIR}/dev-tigerbeetle.sh" start

echo "[reset] 3/3 re-seeding business demo"
npx ts-node prisma/seed.ts --mode=business

echo "[reset] complete business reset finished."
