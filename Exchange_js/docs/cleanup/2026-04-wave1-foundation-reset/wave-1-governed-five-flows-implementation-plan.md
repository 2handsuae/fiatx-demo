# Wave 1 Governed Five Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement five real operator flows so business pages create governance tickets/requests first and only `consume` produces the formal business effect.

**Architecture:** Keep `ChangeTicket` and `DeleteRequest` as the canonical governance tokens. Business pages become proposal sources; approved tickets/requests become `READY`; `consume` performs the real write. Existing business endpoints for admin-member creation and role replacement are redefined to create governance tickets instead of applying direct writes, so there is no admin-API bypass. `Admin Member Provisioning` is the only flow with a post-consume invitation/activation sub-flow, and its canonical link display moves into a `PlatformMembers` member-detail panel instead of email or a global banner.

**Tech Stack:** NestJS, Prisma, Jest, React, Vite, TypeScript

---

## File Structure Map

- `src/modules/governance/change-tickets/change-tickets.service.ts`
  - Build flow-specific binding snapshots and dispatch approved consume execution.
- `src/modules/governance/change-tickets/change-tickets.service.spec.ts`
  - Cover proposal creation, snapshot freezing, and consume execution.
- `src/modules/identity/users/users.controller.ts`
  - Change `POST /users` into governed proposal creation and add member detail read endpoint for invitation detail panel.
- `src/modules/identity/users/dto/create-admin-user.dto.ts`
  - Add `changeReason` so the business page can create a governed provisioning request through the existing route.
- `src/modules/identity/users/users.service.ts`
  - Expose member detail read model and an internal admin provisioning execution method used by `ChangeTicket.consume`.
- `src/modules/identity/users/users.controller.spec.ts`
  - Cover proposal-creation response contract and member detail endpoint.
- `src/modules/identity/users/users.service.spec.ts`
  - Cover member detail read model and provisioning execution behavior.
- `src/modules/identity/users/admin-invitations.service.spec.ts`
  - Lock resend/activation behavior against the new member-detail flow.
- `src/modules/identity/access-control/access-control.controller.ts`
  - Change `PUT /admin/iam/users/:id/roles` into governed proposal creation.
- `src/modules/identity/access-control/dto/update-user-roles.dto.ts`
  - Add `changeReason` so role-binding changes can create governed requests through the existing route.
- `src/modules/identity/access-control/access-control.service.ts`
  - Expose a role-binding execution path that can be called from `ChangeTicket.consume`.
- `src/modules/identity/access-control/access-control.controller.spec.ts`
  - Cover role-binding proposal responses if controller changes.
- `src/modules/identity/access-control/access-control.service.spec.ts`
  - Cover consume-driven role replacement.
- `src/modules/governance/delete-requests/delete-requests.service.spec.ts`
  - Add tests for admin-user delete flow entry expectations if snapshot or UI-facing response changes.
- `admin-web/src/pages/PlatformMembers.tsx`
  - Rework create/role-change actions into proposal creation, add member-detail panel, and move invitation display into the panel.
- `admin-web/src/pages/ChangeTicketDetailPage.tsx`
  - Add “request deletion” entry and better consume success navigation/messages for provisioning tickets.
- `admin-web/src/pages/ChangeTicketsPage.tsx`
  - Add list-level delete-request entry if kept in scope after implementation review.
- `admin-web/src/pages/EvidenceExportDetailPage.tsx`
  - Add “request deletion” entry for evidence packages.
- `admin-web/src/pages/EvidenceExportsPage.tsx`
  - Add list-level delete-request entry if kept in scope after implementation review.
- `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
  - Update to describe governance-preceded provisioning plus invitation child flow.
- `docs/specs/workflows/change-ticket-release-gate-workflow.md`
  - Update to include proposal-sourced business flows and consume effect points.
- `docs/specs/workflows/delete-request-soft-delete-workflow.md`
  - Update to reflect the three entry flows in active runtime.
- `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-governed-five-flows-design.md`
  - Keep as design baseline; only update if implementation reveals a spec inconsistency.

### Task 1: Turn Business Endpoints Into Governed Change-Ticket Proposal Creators

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/dto/create-admin-user.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/access-control.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/dto/update-user-roles.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.controller.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/access-control.controller.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.spec.ts`

- [x] **Step 1: Write the failing controller/service tests for governed proposal creation**

```ts
it('POST /users creates an admin member provisioning ticket instead of a user', async () => {
  changeTicketsService.createAdminMemberProvisioningTicket = jest.fn();

  await controller.create(
    adminReq,
    { email: 'new-admin@fiatx.com', roleCodes: ['OPS_ADMIN'], changeReason: 'new ops joiner' },
  );

  expect(changeTicketsService.createAdminMemberProvisioningTicket).toHaveBeenCalledWith(
    {
      email: 'new-admin@fiatx.com',
      roleCodes: ['OPS_ADMIN'],
      changeReason: 'new ops joiner',
    },
    expect.objectContaining({ userId: adminReq.user.userId, userNo: adminReq.user.userNo }),
  );
});

it('PUT /admin/iam/users/:id/roles creates a role-binding change ticket instead of replacing roles directly', async () => {
  changeTicketsService.createAdminRoleBindingChangeTicket = jest.fn();

  await controller.replaceUserRoles(
    adminReq,
    'user-1',
    { roleCodes: ['OPS_ADMIN', 'AUDITOR'], changeReason: 'rotation' },
  );

  expect(changeTicketsService.createAdminRoleBindingChangeTicket).toHaveBeenCalledWith(
    'user-1',
    {
      roleCodes: ['OPS_ADMIN', 'AUDITOR'],
      changeReason: 'rotation',
    },
    expect.objectContaining({ userId: adminReq.user.userId, userNo: adminReq.user.userNo }),
  );
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/users.controller.spec.ts src/modules/identity/access-control/access-control.controller.spec.ts src/modules/governance/change-tickets/change-tickets.service.spec.ts --runInBand
```

Expected: FAIL with current controllers still returning direct-write semantics and missing proposal helpers.

- [x] **Step 3: Rewire business controllers so they create tickets**

```ts
@Post()
async create(
  @Req() req: any,
  @Body(new ValidationPipe({ transform: true })) body: CreateAdminUserDto,
) {
  return this.changeTicketsService.createAdminMemberProvisioningTicket(
    {
      email: body.email,
      roleCodes: body.roleCodes,
      changeReason: body.changeReason,
    },
    this.ensureAdmin(req),
  );
}
```

- [x] **Step 4: Implement proposal builders in `ChangeTicketsService`**

```ts
async createAdminMemberProvisioningTicket(
  input: { email: string; roleCodes: string[]; changeReason: string },
  actor: ApprovalActorContext,
) {
  const bindingSnapshot = {
    intent: 'CREATE_ADMIN_MEMBER',
    email: String(input.email || '').trim().toLowerCase(),
    roleCodes: Array.from(new Set((input.roleCodes || []).map((item) => String(item).trim().toUpperCase()))).sort(),
    changeReason: String(input.changeReason || '').trim(),
    requestedByUserId: actor.userId,
    requestedByUserNo: actor.userNo,
  };

  return this.create(
    {
      changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
      scopeSummary: `${bindingSnapshot.email} -> ${bindingSnapshot.roleCodes.join(', ')}`,
      changeReason: bindingSnapshot.changeReason,
      testEvidenceRef: 'PENDING_CONSUME',
      rollbackPlanRef: 'DELETE_PENDING_MEMBER',
      traceId: undefined,
      bindingSnapshotJson: JSON.stringify(bindingSnapshot),
    },
    actor,
  );
}
```

- [x] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/users.controller.spec.ts src/modules/identity/access-control/access-control.controller.spec.ts src/modules/governance/change-tickets/change-tickets.service.spec.ts --runInBand
```

Expected: PASS, including snapshot contents for both proposal flows.

- [x] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/identity/users/users.controller.ts src/modules/identity/users/dto/create-admin-user.dto.ts src/modules/identity/access-control/access-control.controller.ts src/modules/identity/access-control/dto/update-user-roles.dto.ts src/modules/governance/change-tickets/change-tickets.service.ts src/modules/identity/users/users.controller.spec.ts src/modules/identity/access-control/access-control.controller.spec.ts src/modules/governance/change-tickets/change-tickets.service.spec.ts && git commit -m "feat: gate member and role changes behind change tickets"
```

### Task 2: Dispatch Formal Business Execution From Change-Ticket Consume

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/access-control.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/access-control.service.spec.ts`

- [x] **Step 1: Write the failing consume-dispatch tests**

```ts
it('consumes admin member provisioning by creating inactive user, roles, and first invitation', async () => {
  usersService.executeAdminMemberProvisioning = jest.fn().mockResolvedValue({
    userId: 'user-1',
    userNo: 'ADM0001',
    inviteStatus: 'PENDING',
  });

  await service.consume(ticketId, { success: true }, actor);

  expect(usersService.executeAdminMemberProvisioning).toHaveBeenCalledWith(
    expect.objectContaining({
      email: 'new-admin@fiatx.com',
      roleCodes: ['OPS_ADMIN'],
    }),
    actor,
  );
});

it('consumes admin role binding change by replacing the target user role bindings', async () => {
  accessControlService.executeGovernedRoleBindingChange = jest.fn();

  await service.consume(ticketId, { success: true }, actor);

  expect(accessControlService.executeGovernedRoleBindingChange).toHaveBeenCalledWith(
    expect.objectContaining({ targetUserId: 'user-1', roleCodes: ['OPS_ADMIN', 'AUDITOR'] }),
    actor,
  );
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts --runInBand
```

Expected: FAIL with missing execution methods and missing consume dispatch.

- [x] **Step 3: Add explicit execution methods in identity services**

```ts
async executeAdminMemberProvisioning(
  binding: { email: string; roleCodes: string[]; changeReason: string },
  actor: { actorId: string; actorRole: string; actorNo?: string },
) {
  return this.createAdminUser({
    email: binding.email,
    roleCodes: binding.roleCodes,
    actor,
  });
}

async executeGovernedRoleBindingChange(
  binding: { targetUserId: string; roleCodes: string[] },
  actor: { actorId: string; actorRole: string; actorNo?: string },
) {
  return this.replaceUserRoles(binding.targetUserId, binding.roleCodes, actor);
}
```

- [x] **Step 4: Dispatch from `ChangeTicketsService.consume()` using `changeType + bindingSnapshotJson`**

```ts
const binding = this.parseJson<Record<string, unknown>>(ticket.bindingSnapshotJson) || {};

if (input.success && ticket.changeType === ChangeTicketTypes.ADMIN_ACCESS_CHANGE) {
  executionMetadata = await this.usersService.executeAdminMemberProvisioning(
    {
      email: String(binding.email),
      roleCodes: Array.isArray(binding.roleCodes) ? binding.roleCodes.map(String) : [],
      changeReason: String(binding.changeReason || ''),
    },
    {
      actorId: actor.userId,
      actorRole: actor.role || 'ADMIN',
      actorNo: actor.userNo,
    },
  );
}
```

- [x] **Step 5: Re-run focused tests and verify they pass**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts --runInBand
```

Expected: PASS with consume now producing the formal business effect only on successful consume.

- [x] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/change-tickets/change-tickets.service.ts src/modules/identity/users/users.service.ts src/modules/identity/access-control/access-control.service.ts src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts && git commit -m "feat: execute governed change flows on consume"
```

### Task 3: Add Member Detail Panel And Move Invitation Display Into PlatformMembers

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/PlatformMembers.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.controller.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.spec.ts`

- [x] **Step 1: Write the failing user-detail tests**

```ts
it('returns member detail with invitation summary for inactive admin users', async () => {
  prisma.user.findFirst.mockResolvedValue({
    id: 'user-1',
    userNo: 'ADM0001',
    email: 'new-admin@fiatx.com',
    status: 'INACTIVE',
    adminInvitations: [
      { id: 'invite-1', expiresAt: new Date('2026-04-10T00:00:00Z'), consumedAt: null, revokedAt: null },
    ],
  });

  const detail = await service.getMemberDetail('user-1');

  expect(detail.inviteStatus).toBe('PENDING');
  expect(detail.inviteExpiresAt).toBe('2026-04-10T00:00:00.000Z');
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/users.controller.spec.ts src/modules/identity/users/users.service.spec.ts --runInBand
```

Expected: FAIL with missing `getMemberDetail()` and `GET /users/:id`.

- [x] **Step 3: Add member detail read model to backend**

```ts
async getMemberDetail(userId: string) {
  const user = await this.prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      userRoles: { include: { role: { select: { code: true, name: true } } } },
      adminInvitations: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { expiresAt: true, consumedAt: true, revokedAt: true },
      },
    },
  });

  const latestInvitation = user?.adminInvitations?.[0] ?? null;
  return {
    id: user.id,
    userNo: user.userNo,
    email: user.email,
    status: user.status,
    roles: user.userRoles.map((item: any) => item.role.code),
    inviteStatus: latestInvitation ? (latestInvitation.consumedAt ? 'CONSUMED' : latestInvitation.revokedAt ? 'REVOKED' : 'PENDING') : null,
    inviteExpiresAt: latestInvitation?.expiresAt?.toISOString() ?? null,
  };
}
```

- [x] **Step 4: Rework `PlatformMembers` into proposal-first actions plus member detail panel**

```tsx
const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);

const submitCreateMember = async () => {
  const payload = await fetchJson<CreatedTicketResponse>(
    `${import.meta.env.VITE_API_URL}/users`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        roleCodes: createRoleCodes,
        changeReason: createReason,
      }),
    },
  );

  setNotice(`Access change request ${payload.ticketNo} created.`);
  navigate(`/dashboard/control-gates/change-tickets/${payload.id}`);
};

const submitRoleChanges = async () => {
  const payload = await fetchJson<CreatedTicketResponse>(
    `${import.meta.env.VITE_API_URL}/admin/iam/users/${selectedMember!.id}/roles`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleCodes: selectedRoleCodes,
        changeReason: roleChangeReason,
      }),
    },
  );

  setNotice(`Role binding change request ${payload.ticketNo} created.`);
  navigate(`/dashboard/control-gates/change-tickets/${payload.id}`);
};
```

- [x] **Step 5: Re-run focused user tests and front-end build**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/users.controller.spec.ts src/modules/identity/users/users.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected: user tests PASS; front-end build PASS with `PlatformMembers` now proposal-first and invitation panel ready.

- [x] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/identity/users/users.controller.ts src/modules/identity/users/users.service.ts src/modules/identity/users/users.controller.spec.ts src/modules/identity/users/users.service.spec.ts admin-web/src/pages/PlatformMembers.tsx && git commit -m "feat: add governed platform member panel and invitation detail"
```

### Task 4: Wire Delete-Request Entry Points Into The Three Source Flows

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/PlatformMembers.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/EvidenceExportDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/EvidenceExportsPage.tsx`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.spec.ts`

- [x] **Step 1: Write the failing delete-request entry tests**

```ts
it('creates an admin-user delete request by targetNo', async () => {
  prisma.user.findFirst.mockResolvedValue({
    id: 'user-1',
    userNo: 'ADM0001',
    email: 'new-admin@fiatx.com',
    status: 'INACTIVE',
    deletedAt: null,
  });

  const created = await service.create(
    { targetType: 'ADMIN_USER', targetNo: 'ADM0001', deleteReason: 'duplicate member' },
    actor,
  );

  expect(created.targetType).toBe('ADMIN_USER');
  expect(created.targetNo).toBe('ADM0001');
});
```

- [x] **Step 2: Run test to verify it fails if new UI entry assumptions are not covered**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/delete-requests/delete-requests.service.spec.ts --runInBand
```

Expected: If current coverage already passes, keep the new case and treat this step as regression lock-in rather than red-first.

- [x] **Step 3: Add UI actions that create delete requests and then navigate to the created request**

```tsx
const createDeleteRequest = async (payload: {
  targetType: 'CHANGE_TICKET' | 'ADMIN_USER' | 'AUDIT_EVIDENCE_PACKAGE';
  targetNo: string;
  deleteReason: string;
}) => {
  const created = await fetchJson<DeleteRequestDetail>(
    `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  navigate(`/dashboard/control-gates/delete-requests/${created.id}`);
};
```

- [x] **Step 4: Re-run delete-request tests and front-end build**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/delete-requests/delete-requests.controller.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected: PASS, and the three source pages now create delete requests instead of deleting directly.

- [x] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add admin-web/src/pages/PlatformMembers.tsx admin-web/src/pages/ChangeTicketDetailPage.tsx admin-web/src/pages/ChangeTicketsPage.tsx admin-web/src/pages/EvidenceExportDetailPage.tsx admin-web/src/pages/EvidenceExportsPage.tsx src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/delete-requests/delete-requests.controller.spec.ts && git commit -m "feat: wire governed delete-request entry points"
```

### Task 5: Align Invitation Child Flow With The New Member-Detail Canonical View

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/PlatformMembers.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/AdminInviteActivate.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/admin-invitations.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.spec.ts`

- [x] **Step 1: Add failing regression tests for resend/activate continuity**

```ts
it('resend keeps invitation in the child flow and does not require a new change ticket', async () => {
  const result = await service.resendInvitationForUser({
    userId: 'user-1',
    actor: { actorId: 'admin-1', actorRole: 'OPS_ADMIN', actorNo: 'ADM0009' },
  });

  expect(result.inviteStatus).toBe('PENDING');
  expect(result.inviteLink).toContain('/admin/activate?token=');
});
```

- [x] **Step 2: Run the invitation tests to verify the safety net**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/users/users.service.spec.ts --runInBand
```

Expected: PASS or targeted FAIL only if the new member-detail assumptions require fixture updates.

- [x] **Step 3: Simplify UI so the global invite banner becomes short-lived feedback only**

```tsx
setNotice(`Invitation refreshed for ${formatMemberIdentity(member)}.`);
setTimeout(() => {
  setInvitePayload(null);
}, 5000);

// canonical long-lived display remains in memberDetail.inviteStatus / inviteExpiresAt / inviteLink
```

- [x] **Step 4: Verify build and focused tests**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/users/users.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected: PASS; resend and activation remain intact while canonical invitation display moves into the member-detail panel.

- [x] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add admin-web/src/pages/PlatformMembers.tsx admin-web/src/pages/AdminInviteActivate.tsx src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/users/users.service.spec.ts && git commit -m "feat: align invitation child flow with member detail view"
```

### Task 6: Update Durable Docs And Run Final Verification

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/admin-member-auth-boundary-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/change-ticket-release-gate-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/delete-request-soft-delete-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/cleanup/2026-04-wave1-foundation-reset/README.md`

- [x] **Step 1: Update durable workflow docs to match the implemented behavior**

```md
- `PlatformMembers` no longer creates admin users directly.
- `PlatformMembers` now creates `Admin Member Provisioning` change tickets.
- Only `ChangeTicket.consume` creates the `INACTIVE` member and first invitation.
- Invitation resend remains in the invitation child flow and does not require a new governance ticket.
```

- [x] **Step 2: Run focused regression and build checks**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/change-tickets/change-tickets.controller.spec.ts src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/delete-requests/delete-requests.controller.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/users.controller.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts src/modules/identity/access-control/access-control.controller.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run build
```

Expected:
- Jest: PASS for all focused suites
- Front-end build: PASS
- Back-end build: either PASS or fail only on known unrelated workspace dependency gaps; if it fails for a new reason, fix before claiming completion

- [x] **Step 3: Record acceptance notes if behavior shifted during implementation**

```md
- Final runtime shape:
  - business page creates governance proposal
  - approval moves ticket/request to READY
  - consume performs the formal write
- Canonical invitation display:
  - `PlatformMembers -> member detail -> Invitation & Activation`
```

- [x] **Step 4: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add docs/specs/workflows/admin-member-auth-boundary-workflow.md docs/specs/workflows/change-ticket-release-gate-workflow.md docs/specs/workflows/delete-request-soft-delete-workflow.md docs/cleanup/2026-04-wave1-foundation-reset/README.md && git commit -m "docs: align governed five flows workflow docs"
```

## Self-Review

### Spec Coverage

- Unified governance gate model
  - Covered by Tasks 1, 2, 3, and 4
- Two change flows
  - Covered by Tasks 1, 2, and 3
- Three delete flows
  - Covered by Task 4
- Invitation/activation child flow
  - Covered by Tasks 2, 3, and 5
- Canonical invitation display in `PlatformMembers` member detail
  - Covered by Task 3 and Task 5
- Delivery order
  - Reflected in task order

### Placeholder Scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- All commands use exact repo paths.
- Every code-changing task includes concrete code shapes.

### Type Consistency

- `ADMIN_ACCESS_CHANGE` and `RBAC_CATALOG_CHANGE` are used consistently as the two change flows.
- `CHANGE_TICKET`, `ADMIN_USER`, and `AUDIT_EVIDENCE_PACKAGE` are used consistently as delete targets.
- `bindingSnapshotJson` remains the frozen execution contract for change-ticket consume.
