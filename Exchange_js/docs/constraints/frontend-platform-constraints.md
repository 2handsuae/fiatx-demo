Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js/admin-web`, `Exchange_js/client-web`
Supersedes: `docs/constraints/frontend-ui-constraints.md`
Depends On: `docs/README.md`, `docs/constraints/runtime-config-constraints.md`, `docs/constraints/backend-api-contract-constraints.md`, `docs/constraints/backend-identity-and-operator-key-constraints.md`
Source of Truth Level: constraints

# Frontend Platform Constraints

## 1) Purpose
- This document is the shared frontend constitution for `admin-web` and `client-web`.
- It defines the common UI, contract, interaction, and delivery rules that both apps MUST follow.
- It does not define visual skin or product mood for a specific app; those rules belong to:
1. `docs/constraints/frontend-admin-ui-constraints.md`
2. `docs/constraints/frontend-client-ui-constraints.md`

## 2) Scope
- Applies to:
1. `admin-web/src/**`
2. `client-web/src/**`
3. frontend-facing documentation under `docs/constraints/**`
- Applies to current and future waves.
- `roadmap`, `acceptance`, and `cleanup` MAY describe validation and retirement context, but they MUST NOT replace active frontend truth under `docs/constraints/**`.

## 3) App Boundary
- `admin-web` and `client-web` MUST remain two independent apps.
- Route ownership MUST stay explicit:
1. admin routes under admin/dashboard/ledger/clearing/operator-facing paths
2. client routes under landing/auth/profile/verification/wallet/transaction/customer-facing paths
- Shared logic MAY exist at rule level, utility level, and token naming level, but pages and app shells MUST NOT be cross-mounted between apps.
- One app's auth/session/token helper MUST NOT be reused as the other app's runtime truth.

## 4) Canonical Language and Naming
- One product concept MUST have one canonical frontend name.
- Active page labels, field labels, button text, and empty/error messages MUST align with backend canonical concepts.
- Historical aliases MAY remain only in compatibility notes or historical screenshots; they MUST NOT return to active page copy.
- Frontend primary copy language is fixed to `English-first`.
- Transitional Chinese comments or rare operator notes MAY exist during cleanup, but they MUST NOT expand into the default active UI language.

## 5) Operator Key and Identity Display
- Backend/admin operator surfaces MUST default to `No/Code-first`.
- `id` MAY remain in routing, internal binding, or technical drill-down, but MUST NOT be the primary operator-facing search/display key when `No/Code` exists.
- Client surfaces MUST hide raw technical identifiers by default.
- Client MAY show transaction or response numbers only when they provide direct customer value.

## 6) Canonical Page Types
- Frontend pages SHOULD fit one of these shapes:
1. `List`
2. `Detail`
3. `Create-Edit`
4. `Action Surface`
5. `Journey`
- New pages MUST declare which page type they follow before inventing a new structure.
- A page MAY combine two types only when the dominant primary layout is still obvious.

## 7) Shared State Surfaces
- All frontend flows MUST explicitly handle:
1. `loading`
2. `empty`
3. `error`
4. `success`
5. `disabled`
6. `expired`
7. `archived`
8. `forbidden`
- These states MUST be rendered intentionally; silent failure is forbidden.
- Disabled and forbidden are different:
1. `disabled` means visible but not currently actionable
2. `forbidden` means not permitted and must be clearly explained or hidden per app rule

## 8) Shared Action Semantics
- Canonical action language MUST remain stable across apps:
1. `submit`
2. `approve`
3. `reject`
4. `execute`
5. `cancel`
6. `retry`
7. `export`
8. `refresh`
- Dangerous or irreversible actions MUST require explicit confirmation.
- In-flight actions MUST block duplicate submission.
- Action labels MUST describe business intent, not low-level HTTP mechanics.

## 8A) Admin Button Classification
- Before styling or placing an admin button, the page MUST classify it as one of:
1. `List Utility`
2. `List Row Action`
3. `Detail Utility`
4. `Detail Workflow Action`
5. `Detail Repair Action`
6. `Simulation Action`
7. `Modal Confirm`
- `Detail Workflow Action`, `Detail Repair Action`, and `Simulation Action` are different systems and MUST NOT be visually or structurally conflated.
- Admin list rows SHOULD default to `View/Open` as the only persistent row action unless a separate admin rule explicitly allows more.

## 9) Request, Session, and Error Handling
- All frontend API calls MUST use `import.meta.env.VITE_API_URL` as the host source.
- Page code MUST NOT hardcode API hosts.
- Each app MUST own one canonical request helper:
1. admin -> `adminFetch`-style helper
2. client -> `customerFetch`-style helper
- The canonical request helper MUST centralize:
1. token attachment
2. 401/403 handling
3. stable API error parsing
4. default request headers
- Page code MUST NOT keep scattering token reads, non-2xx parsing, and auth redirects in every file.
- Frontend auth checks MUST exist at route guard or app-shell level and MUST NOT rely only on UI hiding.

## 10) Contract and Type Discipline
- Frontend payload shapes MUST stay aligned with backend DTO/read-model contracts.
- UI MUST NOT reconstruct primary business truth by guessing from undocumented field combinations.
- New logic-heavy components MUST NOT introduce implicit `any`.
- Repeated response parsing and display formatting SHOULD be centralized.

## 11) Accessibility and Responsive Rules
- Keyboard focus visibility MUST remain intact on interactive controls.
- Disabled controls MUST look disabled and stay non-clickable.
- Tables MUST handle horizontal overflow deliberately.
- Mobile overlays, drawers, and sidebars MUST have explicit close behavior and backdrop behavior.
- Error, warning, and destructive states MUST preserve readable contrast.

## 12) Token and Theme Boundary
- Admin and client MAY keep different visual skins.
- Shared platform semantics MUST still map consistently across apps:
1. primary action
2. secondary action
3. success
4. warning
5. danger
6. info
7. disabled
- Token naming MUST remain mappable even when the apps use different palettes or component skins.

## 13) Runtime Alignment
- Local defaults remain:
1. admin `3001`
2. client `3002`
3. backend API `3000`
- Both frontend apps MUST keep runtime config aligned to `VITE_API_URL=http://localhost:3000` unless environment changes are explicit.

## 14) Delivery Checklist
- Every frontend thread MUST identify:
1. affected app
2. page type
3. contract impact
4. auth/session impact
5. loading/empty/error coverage
6. operator key or customer-facing identity impact
- Build verification MUST pass for the touched frontend app.

## 15) Forbidden Patterns
- MUST NOT treat UI hiding as the only permission boundary.
- MUST NOT reintroduce retired concept names into active UI copy.
- MUST NOT default to UUID-first operator display when a stable `No/Code` exists.
- MUST NOT let each page invent its own request, error, and auth handling rules.
- MUST NOT mix platform rules with app-specific visual mood in this document.

## 16) Change Protocol
- Any change to shared frontend rules MUST include:
1. rationale
2. impacted app(s)
3. impacted page types
4. compatibility note when active UI behavior changes
