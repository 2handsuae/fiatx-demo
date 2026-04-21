# Change Ticket Execution Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the direct runtime dependency from `ChangeTicketsService` on `UsersService` / `AccessControlService` by replacing synchronous method calls with an `EventEmitter2.emitAsync` dispatch, with a new `GovernedExecutionListener` in the identity layer subscribing to the event.

**Architecture:** Governance publishes a `change-ticket.consumed` event carrying the frozen binding snapshot and actor context. An identity-side listener routes the event to `UsersService.executeAdminMemberProvisioning` or `AccessControlService.executeGovernedRoleBindingChange` based on `binding.intent`. `emitAsync` is awaited so errors still propagate synchronously to the caller — the error-handling contract of `consume()` is unchanged.

**Tech Stack:** NestJS EventEmitter2 (already in use), TypeScript discriminated union types, `@OnEvent` decorator from `@nestjs/event-emitter`.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| **Create** | `src/modules/governance/change-tickets/events/change-ticket-consumed.event.ts` | Event constant + `ChangeTicketConsumedEvent` type (single source of truth) |
| **Modify** | `src/modules/governance/change-tickets/change-tickets.service.ts` | Replace `dispatchFormalExecution` body with `emitAsync`; remove identity injections |
| **Modify** | `src/modules/governance/change-tickets/change-tickets.module.ts` | Remove `UsersModule` and `AccessControlModule` from imports |
| **Create** | `src/modules/identity/governed-execution/governed-execution.listener.ts` | `@OnEvent` handler, routes by intent |
| **Create** | `src/modules/identity/governed-execution/governed-execution.module.ts` | NestJS module wrapping the listener |
| **Modify** | `src/app.module.ts` | Register `GovernedExecutionModule` |
| **Modify** | `src/modules/governance/change-tickets/change-tickets.service.spec.ts` | Remove identity mocks; assert `emitAsync` payload instead |
| **Create** | `src/modules/identity/governed-execution/governed-execution.listener.spec.ts` | Listener routing tests |

---

## Task 1: Define the event contract

**Files:**
- Create: `src/modules/governance/change-tickets/events/change-ticket-consumed.event.ts`

- [ ] **Step 1: Create the event file**

```typescript
// src/modules/governance/change-tickets/events/change-ticket-consumed.event.ts

export const CHANGE_TICKET_CONSUMED = 'change-ticket.consumed';

/**
 * Actor context carried with every governed-execution event.
 * Mirrors ApprovalActorContext but only the fields the identity layer needs.
 */
export type GovernedActorContext = {
  actorType?: string;
  userId: string;
  userNo?: string;
  role?: string;
  roleCodes?: string[];
};

/**
 * Binding payload emitted when a READY change ticket is consumed successfully.
 * The `intent` field drives routing in GovernedExecutionListener.
 * The remaining fields are the frozen binding snapshot stored at ticket creation.
 */
export type ChangeTicketConsumedEvent = {
  ticketId: string;
  ticketNo: string;
  traceId: string;
  actor: GovernedActorContext;
  binding: {
    intent?: string;
    [key: string]: unknown;
  };
};
```

- [ ] **Step 2: Verify the file compiles (no errors)**

```bash
cd Exchange_js
PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --skipLibCheck 2>&1 | grep "change-ticket-consumed" || echo "no errors in event file"
```

Expected: `no errors in event file`

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/change-tickets/events/change-ticket-consumed.event.ts
git commit -m "feat(governance): add ChangeTicketConsumedEvent contract for execution decoupling"
```

---

## Task 2: Refactor ChangeTicketsService — remove identity injections, emit event

**Files:**
- Modify: `src/modules/governance/change-tickets/change-tickets.service.ts`

**Context:** Currently `dispatchFormalExecution` (lines 318–335) calls `usersService` or `accessControlService` directly with `as any` casts. `consume()` (line 794) calls this before the DB update. We replace `dispatchFormalExecution` with an `emitAsync` call. The two identity service injections (constructor lines 104–105) and imports (lines 40–41) are removed.

- [ ] **Step 1: Update imports — remove identity service imports, add event imports**

Replace lines 40–41:
```typescript
import { UsersService } from '../../identity/users/users.service';
import { AccessControlService } from '../../identity/access-control/access-control.service';
```

With:
```typescript
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from './events/change-ticket-consumed.event';
```

- [ ] **Step 2: Remove identity service constructor parameters**

Replace the constructor (lines 97–106):
```typescript
constructor(
  @Inject(PrismaService)
  private readonly prisma: PrismaService & Record<string, any>,
  @Inject(forwardRef(() => ApprovalsService))
  private readonly approvalsService: ApprovalsService,
  private readonly auditLogsService: AuditLogsService,
  private readonly eventEmitter: EventEmitter2,
  private readonly usersService: UsersService,
  private readonly accessControlService: AccessControlService,
) {}
```

With:
```typescript
constructor(
  @Inject(PrismaService)
  private readonly prisma: PrismaService & Record<string, any>,
  @Inject(forwardRef(() => ApprovalsService))
  private readonly approvalsService: ApprovalsService,
  private readonly auditLogsService: AuditLogsService,
  private readonly eventEmitter: EventEmitter2,
) {}
```

- [ ] **Step 3: Replace `dispatchFormalExecution` body with `emitAsync`**

Replace the entire `dispatchFormalExecution` method (lines 318–335):
```typescript
private async dispatchFormalExecution(
  ticket: ChangeTicketRow,
  actor: ApprovalActorContext,
): Promise<unknown> {
  const bindingSnapshot = this.parseJson<ChangeTicketBindingSnapshot>(ticket.bindingSnapshotJson) || {};

  switch (bindingSnapshot.intent) {
    case 'ADMIN_MEMBER_PROVISIONING':
      return this.usersService.executeAdminMemberProvisioning(bindingSnapshot as any, actor);
    case 'ADMIN_ROLE_BINDING_CHANGE':
      return this.accessControlService.executeGovernedRoleBindingChange(
        bindingSnapshot as any,
        actor,
      );
    default:
      return null;
  }
}
```

With:
```typescript
private async dispatchFormalExecution(
  ticket: ChangeTicketRow,
  actor: ApprovalActorContext,
): Promise<void> {
  const binding = this.parseJson<ChangeTicketConsumedEvent['binding']>(ticket.bindingSnapshotJson) || {};

  const event: ChangeTicketConsumedEvent = {
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    traceId: ticket.traceId,
    actor: {
      actorType: actor.actorType,
      userId: actor.userId,
      userNo: actor.userNo,
      role: actor.role,
      roleCodes: actor.roleCodes,
    },
    binding,
  };

  await this.eventEmitter.emitAsync(CHANGE_TICKET_CONSUMED, event);
}
```

- [ ] **Step 4: Remove unused `forwardRef` import if no longer needed**

Check line 7 — `forwardRef` is still needed for `ApprovalsService`. No change required there.

- [ ] **Step 5: Run the change-tickets tests — expect failures on `consume success` tests**

```bash
PATH="/opt/homebrew/bin:$PATH" npx jest change-tickets 2>&1 | tail -20
```

Expected: `consume success dispatches admin member provisioning` and `consume success dispatches governed role binding replacement` both **FAIL** (they still assert on `usersService`/`accessControlService`). All other tests pass. This is the expected red state before fixing the spec in Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/modules/governance/change-tickets/change-tickets.service.ts
git commit -m "refactor(governance): replace dispatchFormalExecution direct calls with emitAsync event"
```

---

## Task 3: Clean up ChangeTicketsModule imports

**Files:**
- Modify: `src/modules/governance/change-tickets/change-tickets.module.ts`

**Context:** The module currently imports `UsersModule` and `AccessControlModule` with `forwardRef`. Since the service no longer injects those services, these imports become dead dependencies.

- [ ] **Step 1: Remove identity module imports from module file**

Replace the full file content:
```typescript
import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ChangeTicketsController } from './change-tickets.controller';
import { ChangeTicketsService } from './change-tickets.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ApprovalsModule),
  ],
  controllers: [ChangeTicketsController],
  providers: [ChangeTicketsService],
  exports: [ChangeTicketsService],
})
export class ChangeTicketsModule {}
```

- [ ] **Step 2: Verify no compile errors**

```bash
PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --skipLibCheck 2>&1 | grep "change-tickets.module" || echo "module OK"
```

Expected: `module OK`

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/change-tickets/change-tickets.module.ts
git commit -m "refactor(governance): remove identity module imports from ChangeTicketsModule"
```

---

## Task 4: Create GovernedExecutionListener and module

**Files:**
- Create: `src/modules/identity/governed-execution/governed-execution.listener.ts`
- Create: `src/modules/identity/governed-execution/governed-execution.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the listener**

```typescript
// src/modules/identity/governed-execution/governed-execution.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';
import { UsersService } from '../users/users.service';
import { AccessControlService } from '../access-control/access-control.service';

@Injectable()
export class GovernedExecutionListener {
  constructor(
    private readonly usersService: UsersService,
    private readonly accessControlService: AccessControlService,
  ) {}

  @OnEvent(CHANGE_TICKET_CONSUMED)
  async handleChangeTicketConsumed(event: ChangeTicketConsumedEvent): Promise<void> {
    const { binding, actor } = event;

    switch (binding.intent) {
      case 'ADMIN_MEMBER_PROVISIONING':
        await this.usersService.executeAdminMemberProvisioning(binding as any, actor);
        break;
      case 'ADMIN_ROLE_BINDING_CHANGE':
        await this.accessControlService.executeGovernedRoleBindingChange(binding as any, actor);
        break;
      default:
        break;
    }
  }
}
```

- [ ] **Step 2: Create the module**

```typescript
// src/modules/identity/governed-execution/governed-execution.module.ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { GovernedExecutionListener } from './governed-execution.listener';

@Module({
  imports: [UsersModule, AccessControlModule],
  providers: [GovernedExecutionListener],
})
export class GovernedExecutionModule {}
```

- [ ] **Step 3: Register in AppModule**

In `src/app.module.ts`, add the import at the top:
```typescript
import { GovernedExecutionModule } from './modules/identity/governed-execution/governed-execution.module';
```

And add `GovernedExecutionModule` to the `imports` array (near the other identity modules, e.g. after `AccessControlModule`):
```typescript
GovernedExecutionModule,
```

- [ ] **Step 4: Verify no compile errors**

```bash
PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "governed-execution|GovernedExecution" || echo "listener OK"
```

Expected: `listener OK`

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/governed-execution/governed-execution.listener.ts \
        src/modules/identity/governed-execution/governed-execution.module.ts \
        src/app.module.ts
git commit -m "feat(identity): add GovernedExecutionListener to handle change-ticket.consumed events"
```

---

## Task 5: Update ChangeTicketsService spec

**Files:**
- Modify: `src/modules/governance/change-tickets/change-tickets.service.spec.ts`

**Context:** The spec currently injects `usersService` and `accessControlService` into the service constructor (lines 130–144) and asserts on them in the `consume success` tests (lines 550–708). These must be replaced with assertions on `eventEmitter.emitAsync`.

- [ ] **Step 1: Remove identity service mock variables and constructor injection**

In the `describe` block variable declarations, remove:
```typescript
let usersService: any;
let accessControlService: any;
```

In `beforeEach`, remove the mock setup:
```typescript
usersService = {
  executeAdminMemberProvisioning: jest.fn(),
};
accessControlService = {
  executeGovernedRoleBindingChange: jest.fn(),
};
```

Update the `service = new ChangeTicketsService(...)` call — remove `usersService` and `accessControlService`:
```typescript
service = new ChangeTicketsService(
  prisma,
  approvalsService,
  auditLogsService,
  eventEmitter,
);
```

- [ ] **Step 2: Add the event import to the spec file**

Add at the top of the spec file:
```typescript
import {
  CHANGE_TICKET_CONSUMED,
} from './events/change-ticket-consumed.event';
```

- [ ] **Step 3: Update `consume success dispatches admin member provisioning` test (line 550)**

Replace the assertion block:
```typescript
expect(usersService.executeAdminMemberProvisioning).toHaveBeenCalledWith(bindingSnapshot, actor);
expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
```

With:
```typescript
expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
  CHANGE_TICKET_CONSUMED,
  expect.objectContaining({
    ticketId: 'ticket-1',
    binding: expect.objectContaining({
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_ADMIN'],
    }),
    actor: expect.objectContaining({ userId: actor.userId }),
  }),
);
```

Also remove:
```typescript
usersService.executeAdminMemberProvisioning.mockResolvedValue({
  userNo: 'ADM2604030001',
  inviteStatus: 'PENDING',
  inviteExpiresAt: '2026-04-04T00:00:00.000Z',
  inviteLink: 'http://localhost:3001/admin/activate?token=abc',
});
```
(This mock setup is no longer needed — `emitAsync` is already mocked to resolve.)

- [ ] **Step 4: Update `consume success dispatches governed role binding replacement` test (line 610)**

Replace:
```typescript
expect(accessControlService.executeGovernedRoleBindingChange).toHaveBeenCalledWith(
  bindingSnapshot,
  actor,
);
expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
```

With:
```typescript
expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
  CHANGE_TICKET_CONSUMED,
  expect.objectContaining({
    ticketId: 'ticket-1',
    binding: expect.objectContaining({
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: 'user-123',
      roleCodes: ['DPO'],
    }),
    actor: expect.objectContaining({ userId: actor.userId }),
  }),
);
```

Also remove:
```typescript
accessControlService.executeGovernedRoleBindingChange.mockResolvedValue({
  userId: 'user-123',
  userNo: 'USR-123',
  roles: ['DPO'],
  warnings: [],
});
```

- [ ] **Step 5: Update `consume failure` test (line 678) — remove identity service assertions**

Remove:
```typescript
expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
```

Replace with:
```typescript
expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
```

- [ ] **Step 6: Update `rejects consuming a FAILED ticket` test — remove identity assertions if any**

Check lines 710–730. If that test has `usersService` / `accessControlService` assertions, replace them with `expect(eventEmitter.emitAsync).not.toHaveBeenCalled()`. If none present, no change needed.

- [ ] **Step 7: Run change-tickets tests — expect all green**

```bash
PATH="/opt/homebrew/bin:$PATH" npx jest change-tickets 2>&1 | tail -15
```

Expected: `22 passed` (same count as baseline).

- [ ] **Step 8: Commit**

```bash
git add src/modules/governance/change-tickets/change-tickets.service.spec.ts
git commit -m "test(governance): update change-tickets spec to assert emitAsync instead of identity service calls"
```

---

## Task 6: Create GovernedExecutionListener spec

**Files:**
- Create: `src/modules/identity/governed-execution/governed-execution.listener.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
// src/modules/identity/governed-execution/governed-execution.listener.spec.ts
import { GovernedExecutionListener } from './governed-execution.listener';
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';

const makeEvent = (bindingOverrides: Record<string, unknown> = {}): ChangeTicketConsumedEvent => ({
  ticketId: 'ticket-1',
  ticketNo: 'CT2604060001',
  traceId: 'trace-abc',
  actor: {
    actorType: 'ADMIN',
    userId: 'admin-1',
    userNo: 'ADM-001',
    role: 'TECH_ADMIN',
    roleCodes: ['TECH_ADMIN'],
  },
  binding: bindingOverrides,
});

describe('GovernedExecutionListener', () => {
  let listener: GovernedExecutionListener;
  let usersService: { executeAdminMemberProvisioning: jest.Mock };
  let accessControlService: { executeGovernedRoleBindingChange: jest.Mock };

  beforeEach(() => {
    usersService = {
      executeAdminMemberProvisioning: jest.fn().mockResolvedValue({ userNo: 'ADM-NEW' }),
    };
    accessControlService = {
      executeGovernedRoleBindingChange: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    };
    listener = new GovernedExecutionListener(
      usersService as any,
      accessControlService as any,
    );
  });

  it('routes ADMIN_MEMBER_PROVISIONING intent to usersService', async () => {
    const event = makeEvent({
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'new-admin@fiatx.com',
      roleCodes: ['CISO', 'TECH_ADMIN'],
    });

    await listener.handleChangeTicketConsumed(event);

    expect(usersService.executeAdminMemberProvisioning).toHaveBeenCalledWith(
      event.binding,
      event.actor,
    );
    expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
  });

  it('routes ADMIN_ROLE_BINDING_CHANGE intent to accessControlService', async () => {
    const event = makeEvent({
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: 'user-123',
      roleCodes: ['DPO'],
    });

    await listener.handleChangeTicketConsumed(event);

    expect(accessControlService.executeGovernedRoleBindingChange).toHaveBeenCalledWith(
      event.binding,
      event.actor,
    );
    expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
  });

  it('does not call any service for unknown intent', async () => {
    const event = makeEvent({ intent: 'FUTURE_WAVE_INTENT', someField: 'value' });

    await listener.handleChangeTicketConsumed(event);

    expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
    expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
  });

  it('does not call any service when intent is absent', async () => {
    const event = makeEvent({});

    await listener.handleChangeTicketConsumed(event);

    expect(usersService.executeAdminMemberProvisioning).not.toHaveBeenCalled();
    expect(accessControlService.executeGovernedRoleBindingChange).not.toHaveBeenCalled();
  });

  it('propagates errors from usersService to the caller', async () => {
    usersService.executeAdminMemberProvisioning.mockRejectedValue(
      new Error('provisioning failed'),
    );
    const event = makeEvent({
      intent: 'ADMIN_MEMBER_PROVISIONING',
      email: 'fail@fiatx.com',
      roleCodes: ['CISO'],
    });

    await expect(listener.handleChangeTicketConsumed(event)).rejects.toThrow('provisioning failed');
  });

  it('propagates errors from accessControlService to the caller', async () => {
    accessControlService.executeGovernedRoleBindingChange.mockRejectedValue(
      new Error('role binding failed'),
    );
    const event = makeEvent({
      intent: 'ADMIN_ROLE_BINDING_CHANGE',
      targetUserId: 'user-1',
      roleCodes: ['DPO'],
    });

    await expect(listener.handleChangeTicketConsumed(event)).rejects.toThrow('role binding failed');
  });
});
```

- [ ] **Step 2: Run the new listener spec**

```bash
PATH="/opt/homebrew/bin:$PATH" npx jest governed-execution 2>&1 | tail -15
```

Expected: `6 passed`

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
PATH="/opt/homebrew/bin:$PATH" npx jest 2>&1 | tail -10
```

Expected: all tests pass (baseline 933 + 6 new = 939 total).

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/governed-execution/governed-execution.listener.spec.ts
git commit -m "test(identity): add GovernedExecutionListener routing spec (6 cases)"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|-------------|------------|
| Remove governance → identity direct dependency | Task 2 + Task 3 |
| Event carries frozen binding snapshot | Task 1 (type) + Task 2 (emit) |
| Error propagation preserved via `emitAsync` | Task 4 (listener is `async`, `@OnEvent` + `emitAsync` ensures rejection propagates) |
| `as any` casts move from governance to identity | Task 2 removes old casts; Task 4 listener has `as any` co-located with identity |
| `GovernedExecutionActor` duplication NOT addressed | Out of scope (separate cleanup) |
| Tests updated for changed assertions | Task 5 |
| New listener fully tested | Task 6 |

**Placeholder scan:** None found.

**Type consistency:** `ChangeTicketConsumedEvent` defined in Task 1, imported in Task 2, Task 4, Task 5, Task 6 — consistent. `CHANGE_TICKET_CONSUMED` constant used in Task 2 (emit), Task 4 (`@OnEvent`), Task 5 (assertion), Task 6 (reference) — consistent.
