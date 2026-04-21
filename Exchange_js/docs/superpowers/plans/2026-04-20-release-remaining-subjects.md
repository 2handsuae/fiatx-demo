# Release Remaining Config Subjects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the full Config Release → CT → Publish governance pipeline for the 5 remaining subjects (COA, ACCT_EVENT, JOURNAL_TEMPLATE, CLEARING_TEMPLATE, PRICING_POLICY) that have never been published.

**Architecture:** Pure operational task — no code changes. Each subject goes through: `stage` (generates traceId) → `validate` (auto-creates BUSINESS_CONFIG_CHANGE CT) → Submit CT → Approve → Consume (auto-triggers publish). A shared Bash helper function executes steps 3–5 via the REST API.

**Tech Stack:** NestJS API on `http://localhost:3000`, admin credentials `admin@fiatx.com / 123456`, Node 20 required for stage/validate scripts.

---

## Pre-flight

Working directory for ALL commands: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js`

Services must be running. Verify:
```bash
curl -s http://localhost:3000/admin/business-config/releases?take=1 \
  -H "Authorization: Bearer $(curl -s -X POST http://localhost:3000/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')" \
  | python3 -c "import sys,json; print('API OK, releases:', len(json.load(sys.stdin).get('items',[])))"
```
Expected: `API OK, releases: <number>`. If API is down, run:
```bash
source ~/.nvm/nvm.sh && nvm use 20 && npm run dev:start 2>&1 | grep "all services"
```

---

## Shared Helper

Each task uses these two shell functions. Define them once at the start of your shell session (copy-paste into terminal):

```bash
get_token() {
  curl -s -X POST http://localhost:3000/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@fiatx.com","password":"123456"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"
}

release_subject() {
  local SUBJECT="$1"
  local TOKEN=$(get_token)

  echo "=== [$SUBJECT] 1. Stage ==="
  local STAGE=$(source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1 && \
    npm run config:release:stage -- --subject "$SUBJECT" 2>&1 | \
    grep -v "^>" | grep -v "exchange_js@" | grep -v "node -r" | grep -v "^Now using" | grep -v "^$")
  local RELEASE_NO=$(echo "$STAGE" | python3 -c "import sys,json,re; m=re.search(r'\{.*\}',sys.stdin.read(),re.DOTALL); d=json.loads(m.group(0)); print(d['releaseNo'])" 2>/dev/null)
  local TRACE_ID=$(echo "$STAGE" | python3 -c "import sys,json,re; m=re.search(r'\{.*\}',sys.stdin.read(),re.DOTALL); d=json.loads(m.group(0)); print(d['traceId'])" 2>/dev/null)
  echo "  releaseNo : $RELEASE_NO"
  echo "  traceId   : $TRACE_ID"

  echo "=== [$SUBJECT] 2. Validate ==="
  source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1 && \
    npm run config:release:validate -- --release "$RELEASE_NO" 2>&1 | tail -6

  local TOKEN=$(get_token)

  echo "=== [$SUBJECT] 3. Get auto-created CT ==="
  local CT_ID=$(curl -s "http://localhost:3000/admin/business-config/releases/$RELEASE_NO" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('changeTicketId',''))")
  echo "  CT ID: $CT_ID"

  echo "=== [$SUBJECT] 4. Submit CT ==="
  local APPROVAL_ID=$(curl -s -X POST \
    "http://localhost:3000/admin/control-gates/change-tickets/$CT_ID/submit" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('approvalCaseId',''))")
  echo "  approvalCaseId: $APPROVAL_ID"

  echo "=== [$SUBJECT] 5. Approve ==="
  curl -s -X POST \
    "http://localhost:3000/admin/control-gates/approvals/$APPROVAL_ID/approve" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"reason\":\"Approving initial $SUBJECT config release\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('  Approval status:', d.get('status'))"

  echo "=== [$SUBJECT] 6. Consume CT (triggers auto-publish) ==="
  curl -s -X POST \
    "http://localhost:3000/admin/control-gates/change-tickets/$CT_ID/consume" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"success":true,"reason":"Initial release execution"}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('  CT status:', d.get('status'), '| consumedAt:', d.get('consumedAt'))"

  sleep 2
  local TOKEN=$(get_token)

  echo "=== [$SUBJECT] 7. Verify release ==="
  curl -s "http://localhost:3000/admin/business-config/releases/$RELEASE_NO" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('  Release status:', d.get('status'), '| publishedAt:', d.get('publishedAt'))"

  echo "=== [$SUBJECT] 8. Audit trace ($TRACE_ID) ==="
  curl -s "http://localhost:3000/admin/audit-logs?traceId=$TRACE_ID&take=20" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = sorted(d.get('items', []), key=lambda x: x.get('occurredAt','') or '')
wt_set = set(x.get('workflowType') for x in items)
print(f'  Events: {len(items)}  |  workflowTypes: {wt_set}')
for evt in items:
    ok = '✅' if evt.get('workflowType') == 'BUSINESS_CONFIG_CHANGE' else '❌'
    print(f'  {ok} {evt.get(\"action\"):<50} wt={evt.get(\"workflowType\")}')
"
  echo ""
  echo "=== [$SUBJECT] DONE ==="
  echo ""
}
```

---

## Task 1: Release COA

**Expected events:** 10 audit events, all `workflowType=BUSINESS_CONFIG_CHANGE`

- [ ] **Step 1: Run the pipeline**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
release_subject COA
```

- [ ] **Step 2: Verify output**

Expected final lines:
```
  Release status: ACTIVE | publishedAt: <timestamp>
  Events: 10  |  workflowTypes: {'BUSINESS_CONFIG_CHANGE'}
  ✅ BUSINESS_CONFIG_RELEASE_STAGED   ...
  ✅ BUSINESS_CONFIG_RELEASE_VALIDATED ...
  ✅ CHANGE_TICKET_CREATED            ...
  ...all 10 lines have ✅
```

If `Release status` is not `ACTIVE`, check the backend log:
```bash
tail -30 /tmp/exchange_js_runtime_main/backend.log | grep -i "error\|Error"
```

---

## Task 2: Release ACCT_EVENT

- [ ] **Step 1: Run the pipeline**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
release_subject ACCT_EVENT
```

- [ ] **Step 2: Verify output**

Same acceptance criteria as Task 1: `Release status: ACTIVE`, 10 events all `BUSINESS_CONFIG_CHANGE`.

---

## Task 3: Release JOURNAL_TEMPLATE

- [ ] **Step 1: Run the pipeline**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
release_subject JOURNAL_TEMPLATE
```

- [ ] **Step 2: Verify output**

Same acceptance criteria. Note: JOURNAL_TEMPLATE manifest is large (many items), stage may take a few seconds longer.

---

## Task 4: Release CLEARING_TEMPLATE

- [ ] **Step 1: Run the pipeline**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
release_subject CLEARING_TEMPLATE
```

- [ ] **Step 2: Verify output**

Same acceptance criteria.

---

## Task 5: Release PRICING_POLICY

- [ ] **Step 1: Run the pipeline**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
release_subject PRICING_POLICY
```

- [ ] **Step 2: Verify output**

Same acceptance criteria.

---

## Task 6: Final Cross-Subject Verification

- [ ] **Step 1: Confirm all 5 subjects are ACTIVE**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT subjectType, status, releaseNo FROM business_config_releases WHERE status='ACTIVE' ORDER BY subjectType;"
```

Expected — exactly 6 rows (ASSET_CONFIG + 5 new):
```
ACCT_EVENT|ACTIVE|ACCT_EVENT-REL-001
ASSET_CONFIG|ACTIVE|ASSET_CONFIG-REL-003
CLEARING_TEMPLATE|ACTIVE|CLEARING_TEMPLATE-REL-001
COA|ACTIVE|COA-REL-001
JOURNAL_TEMPLATE|ACTIVE|JOURNAL_TEMPLATE-REL-001
PRICING_POLICY|ACTIVE|PRICING_POLICY-REL-001
```

- [ ] **Step 2: Confirm no subject is stuck in VALIDATED (unpublished)**

```bash
sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT subjectType, releaseNo, status FROM business_config_releases WHERE status='VALIDATED';"
```

Expected: empty (0 rows). Any VALIDATED row means the CT consume didn't trigger publish — re-run `release_subject <SUBJECT>`.

---

## Self-Review

- ✅ All 5 subjects covered: COA, ACCT_EVENT, JOURNAL_TEMPLATE, CLEARING_TEMPLATE, PRICING_POLICY
- ✅ Uses the integrated CT flow (no manual publish command)
- ✅ Verifies `workflowType=BUSINESS_CONFIG_CHANGE` on all audit events (validates today's enum fix)
- ✅ Task 6 cross-checks the full DB state
- ✅ No code changes — purely operational
