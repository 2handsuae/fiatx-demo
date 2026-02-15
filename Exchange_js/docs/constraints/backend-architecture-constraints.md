# Backend Architecture Constraints (`src/**`)

## 1) Module Boundary
- MUST follow Nest module boundaries by domain:
1. identity
2. asset-treasury
3. trading
4. accounting
5. clearing-settle
6. risk-engine
7. orchestrators
- Controllers MUST only handle transport concerns (request/response/auth/validation).
- Business logic MUST stay in services.
- Direct DB access MUST stay in services via `PrismaService`.

## 2) DTO and Validation
- MUST use DTO classes with `class-validator` and `ValidationPipe`.
- MUST whitelist payload fields (`ValidationPipe({ whitelist: true })` is global).
- MUST reject unsupported enum/status transitions with explicit exceptions.

## 3) Data Integrity and Transactions
- Multi-table state change MUST use DB transaction.
- Onboarding/compliance state recomputation MUST go through service orchestration, not ad-hoc updates.
- MUST keep base configuration and business data concerns separated:
1. base config via base seed/sync
2. business reset via business reset script

## 4) Error Handling and Observability
- MUST throw typed Nest HTTP exceptions (`BadRequestException`, `ForbiddenException`, `NotFoundException`, etc).
- MUST log failure context with enough identifiers (case id/customer id/event code), but MUST NOT log secrets.
- SHOULD keep controller responses deterministic and machine-parsable.

## 5) Event/Template Configuration Discipline
- MUST treat accounting events/templates/clearing templates as configuration data with idempotent sync.
- MUST avoid startup side-effect writes unless explicitly gated by env (e.g. `ACCT_CONFIG_SYNC_ON_BOOT=true`).

## 6) Dependency Rules
- MUST NOT introduce cross-module circular dependencies.
- SHOULD keep helper utilities pure and domain-agnostic unless placed inside a module.
- MUST prefer explicit imports from local modules over hidden global singletons (except approved global modules like Config/Logger/EventEmitter).

## 7) API Contract Stability
- For existing endpoints, behavioral changes MUST include:
1. impact list
2. backward compatibility statement
3. migration strategy (if any)
- MUST keep Swagger availability at `/api` in local dev.

## 8) Thread Delivery Checklist (Backend)
- DTO/validation updated if request shape changed.
- Transaction coverage confirmed for multi-entity writes.
- Error paths tested.
- Key module/service tests added or updated where behavior changed.
- No accidental startup mutation introduced.
