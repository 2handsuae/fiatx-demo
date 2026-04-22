# Frontend: Client UI Rules
Last Updated: 2026-04-21 | Scope: Wave 1–4 | Source: docs/constraints/frontend-client-ui-constraints.md, frontend-platform-constraints.md

---

## API Client Rules

- ALL HTTP calls MUST use the canonical `customerFetch`-equivalent helper — never raw `fetch`, `axios`, or page-local token reads.
- That helper MUST centralize: token attachment, 401/403 handling, stable error parsing, session reset behavior.
- API host MUST come from `import.meta.env.VITE_API_URL` — no hardcoded hosts.
- Page code MUST NOT scatter token reads, raw non-2xx handling, or duplicated auth parsing.

---

## Auth & Session Rules

- Client auth gating MUST distinguish four states: not signed in / signed in but verification required / signed in but account frozen or restricted / signed in and fully active.
- Auth checks MUST live at route-guard or app-shell level — UI hiding alone is NOT a permission boundary.
- Client session helpers MUST NOT be shared with or reused by `admin-web`.
- The `AuthGuard` verification-overlay pattern is the canonical design for blocked-but-guided access.
- Blocking surfaces MUST feel guided and calm, not punitive.
- Verification completion MUST redirect to `/profile` when `onboardingStatus = APPROVED` and `operatingStatus = ACTIVE`.

Verification journey (`/verification`) MUST:
- Keep the approved step structure: `INTRO` → `GUIDE` → `FLOW`.
- Consume onboarding contract from `GET /onboarding/me`, `GET /onboarding/next-step`, `GET /onboarding/responses`.
- Treat `GET /onboarding/me` as canonical state truth; `GET /onboarding/next-step` is guidance only.
- Gate all simulation controls behind `Simulation Mode` — hide bootstrap, session regeneration, and mock-complete when simulation mode is off.
- Show explicit `Start EDD` for `PENDING_EDD` with no valid session link — MUST NOT auto-create EDD implicitly.

---

## Component Rules

- Page types MUST fit one of: `Landing`, `Auth`, `Journey`, `Account`, `Transactions`.
- `Journey` pages are step-based/state-based flows and MUST emphasize guidance over density.
- Client information density MUST stay lower than admin density; sequence information rather than dump it.
- All flows MUST explicitly handle: `loading`, `empty`, `error`, `success`, `disabled`, `expired`, `archived`, `forbidden`. Silent failure is forbidden.
- `framer-motion` usage MUST remain purposeful and lightweight — no long decorative animations with no workflow value.
- Amount, asset code, rate, fee, and timing formats MUST stay consistent.
- Statuses MUST be translated into customer-meaningful language while preserving backend truth.
- CTA targets MUST point to real active routes; marketing copy MUST NOT disagree with actual route availability.

---

## Forbidden Patterns

- MUST NOT use raw `fetch` or page-local token reads — only `customerFetch` equivalent.
- MUST NOT hardcode API hosts in page code.
- MUST NOT expose raw UUIDs or internal system ids as normal customer-facing content.
- MUST NOT let each page reinvent session and request handling.
- MUST NOT turn journey pages into dense operator-style forms.
- MUST NOT drift into loud Web3 / cyberpunk neon / heavy glow styling.
- MUST NOT let marketing CTA routes diverge from actual runtime navigation.
- MUST NOT treat UI hiding as the only auth/permission boundary.
- MUST NOT let `getNextStep` override canonical customer state truth from `GET /onboarding/me`.
- MUST NOT auto-create EDD sessions implicitly when `PENDING_EDD` has no valid session link.
