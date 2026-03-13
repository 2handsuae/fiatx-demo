# Frontend UI Constraints (`admin-web` + `client-web`)

## 1) Architecture and Routing
- MUST keep `admin-web` and `client-web` as two independent apps.
- MUST keep route ownership clear:
1. admin routes under `/admin/*`, `/dashboard/*`, `/exchange/*`, `/ledger/*`, `/clearing/*`
2. client routes under `/`, `/login`, `/register`, `/overview`, `/wallet`, `/deposit`, `/swap`, `/withdraw`, `/transactions`, `/profile`, `/verification`
- MUST not couple admin components into client app, or vice versa.

## 2) API Access Rules
- MUST use `import.meta.env.VITE_API_URL` as API host source.
- MUST NOT hardcode API host in page code.
- Admin pages that require auth SHOULD use `adminFetch` to enforce token lifecycle handling.
- For all fetch calls, MUST handle:
1. loading state
2. non-2xx response
3. empty result state
4. user-readable error message

## 3) Auth and Session
- MUST preserve token type boundaries:
1. admin token for admin app only
2. customer token for client app only
- MUST redirect to login on 401/403 for protected routes.
- MUST keep auth checks in route guard level (e.g. `AuthGuard`) and not rely only on UI hiding.

## 4) UI Behavior and Data Safety
- MUST keep action buttons idempotent-safe in UI:
1. disable while submitting
2. prevent duplicate clicks
- MUST confirm destructive actions with explicit user confirmation.
- SHOULD use shared formatting/util helpers for number/date/currency consistency.
- MUST avoid silent failures; display actionable messages when request fails.

## 5) Type and Contract Discipline
- MUST keep frontend payload shape aligned with backend DTO contracts.
- MUST NOT introduce implicit `any` in new logic-heavy components.
- SHOULD centralize repeated API response parsing logic into helper functions.

## 6) Port and Local Runtime Alignment
- MUST assume local defaults:
1. admin `3001`
2. client `3002`
3. backend API `3000`
- MUST keep both frontend `.env` files aligned to `VITE_API_URL=http://localhost:3000` unless environment explicitly changes.

## 7) Thread Delivery Checklist (Frontend)
- Route impact identified.
- API contract impact identified.
- Error/loading/empty states covered.
- Auth flow regression checked (login, token missing, 401/403).
- Build command passes for touched frontend app.

## 8) Client Verification Page Constraints
- `/verification` page MUST keep the approved main-style journey layout (`INTRO`, `GUIDE`, `FLOW`) unless explicitly changed by product decision.
- `/verification` MUST consume onboarding contract from:
1. `GET /onboarding/me`
2. `GET /onboarding/next-step`
3. `GET /onboarding/cases`
- If frontend uses legacy-style `step/action` rendering, it MUST be derived from backend `publicStatus + actions[]` via local projection and MUST NOT mutate backend contract semantics.
- CDD mock-complete interaction MUST open a dialog with three options:
1. `Low risk`
2. `Medium risk / High risk or PEP`
3. `Sanction & other`
- EDD mock-complete interaction MUST remain direct submit (no risk-type dialog).
- In `PENDING_EDD`, when no valid session link exists, UI MUST show an explicit `Start EDD` action to create link and MUST NOT auto-trigger EDD session creation.
- Verification completion UX MUST enforce redirect:
1. `publicStatus === ACTIVE` -> navigate to `/profile`
- Session compatibility in verification UI MUST support both:
1. `latestSession.sessionId`
2. `latestSession.id` (legacy fallback)
