Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js/client-web`
Supersedes: `docs/constraints/frontend-ui-constraints.md`
Depends On: `docs/constraints/frontend-platform-constraints.md`, `docs/constraints/onboarding-flow-constraints.md`, `docs/constraints/customer-transaction-flow-constraints.md`
Source of Truth Level: constraints

# Frontend Client UI Constraints

## 1) Purpose
- This document defines the long-term client UI language for `client-web`.
- The client app should feel trustworthy, precise, and technology-forward without becoming flashy.
- The target aesthetic is `trust + technology + restrained luxury`.

## 2) Brand and Mood
- Client UI SHOULD feel like advanced financial technology, not a generic SaaS panel and not a loud Web3 campaign page.
- Target mood:
1. credible
2. precise
3. cool-toned
4. premium but restrained
5. motion-aware
- Allowed visual tools:
1. glass surfaces
2. controlled gradients
3. soft glow
4. crisp borders
5. strong numeric emphasis
- Forbidden visual drift:
1. cyberpunk neon overload
2. heavy glow everywhere
3. low-contrast dark spectacle
4. cheap token-landing-page styling

## 3) Canonical Client Page Types
- Client pages SHOULD fit one of:
1. `Landing`
2. `Auth`
3. `Journey`
4. `Account`
5. `Transactions`
- `Journey` pages are step-based or state-based customer flows and MUST emphasize guidance over density.
- The `/verification` page is the canonical journey special case in the current runtime.

## 4) Layout and Density
- Client information density MUST stay lower than admin density.
- Important information SHOULD be sequenced, not dumped.
- The UI SHOULD emphasize:
1. next action
2. current status
3. asset and amount meaning
4. customer-safe explanations
- Technical detail SHOULD stay hidden unless it has clear customer value.

## 5) Motion Rules
- Motion MAY support:
1. page entry
2. state transition
3. journey progression
4. attention focus
5. success/error feedback
- Motion MUST NOT slow decision-making or block urgent tasks.
- `framer-motion` usage SHOULD remain purposeful and lightweight.
- Long decorative animations with no workflow value are forbidden.

## 6) Data Display Rules
- Client UI MUST NOT default to showing UUIDs or internal system ids.
- Transaction numbers, response numbers, or cycle numbers MAY be shown only when they help the customer track or communicate a real issue.
- Amount, asset code, rate, fee, and timing formats MUST stay consistent.
- Statuses SHOULD be translated into customer-meaningful language while preserving backend truth.

## 7) Request and Session Rules
- Client runtime MUST converge on one canonical request helper equivalent to `customerFetch`.
- That helper MUST centralize:
1. token attachment
2. 401/403 handling
3. stable error parsing
4. session reset behavior
- Page code MUST NOT keep scattering token reads, raw non-2xx handling, or duplicated auth parsing.

## 8) Auth and Access Guard Rules
- Client auth gating MUST distinguish:
1. not signed in
2. signed in but verification required
3. signed in but account frozen/restricted
4. signed in and fully active
- Blocking surfaces SHOULD feel guided and calm, not punitive.
- The current `AuthGuard` verification overlay direction is valid and SHOULD be treated as the preferred design pattern for blocked-but-guided access.

## 9) Verification Journey Rules
- `/verification` MUST keep the approved journey structure:
1. `INTRO`
2. `GUIDE`
3. `FLOW`
- `/verification` MUST consume onboarding contract from:
1. `GET /onboarding/me`
2. `GET /onboarding/next-step`
3. `GET /onboarding/responses`
- Canonical customer fields from `GET /onboarding/me` are the primary onboarding state truth.
- `GET /onboarding/next-step` is guidance only; frontend MAY use:
1. `actions[]`
2. `blockedReason`
3. `activeCaseId`
- `getNextStep` MUST NOT override canonical customer state truth.
- `/verification` MUST use shared `Simulation Mode` gating for customer-side onboarding simulation controls.
- When simulation mode is disabled, customer-side bootstrap, session regeneration, and mock-complete actions MUST stay hidden.
- `PENDING_EDD` with no valid session link MUST show explicit `Start EDD` and MUST NOT auto-create EDD implicitly.
- Verification completion MUST redirect:
1. `onboardingStatus = APPROVED` and `operatingStatus = ACTIVE` -> `/profile`
- Session compatibility MAY support both:
1. `latestSession.sessionId`
2. `latestSession.id`

## 10) Landing and CTA Rules
- Landing pages MAY be more expressive than account pages, but MUST still belong to the same product family.
- CTA targets MUST point to real active routes.
- Marketing copy and product copy MAY differ in tone, but MUST NOT disagree on product meaning or route availability.

## 11) Current Runtime Debt That This Document Freezes
- Current runtime includes a valid advanced-fintech visual direction in dashboard and gating surfaces.
- Current runtime also contains known cleanup debt:
1. landing CTA points to `/trade` while active router does not expose that route
2. many client pages still use raw `fetch`, local token reads, and page-local error handling
- These are active cleanup inputs, not accepted final-state patterns.

## 12) Forbidden Patterns
- MUST NOT expose raw technical ids as normal customer UI content.
- MUST NOT let each page reinvent session and request handling.
- MUST NOT drift into loud Web3 spectacle styling.
- MUST NOT turn journey pages into dense operator-style forms.
- MUST NOT let marketing CTA routes diverge from actual runtime navigation.

## 13) Change Protocol
- Any durable client UI rule change MUST include:
1. impacted page type
2. affected customer journey or transaction flow
3. copy/route impact
4. cleanup note if current runtime still contains known debt after the change
