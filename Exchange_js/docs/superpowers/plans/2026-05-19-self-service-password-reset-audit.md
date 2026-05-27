# Self-Service Password Reset Audit Log Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audit log coverage to the 3 uncovered steps of the self-service password reset path, and propagate a shared traceId across all 3 steps.

**Architecture:** Add 4 new action constants, generate traceId in step 1 and embed in MFA JWT, extract in guard, thread through controller → workflow, write `recordByActor` at each step. `consumeResetToken` covers both self-service and admin paths.

**Tech Stack:** NestJS, Prisma, `AuditLogsService`, JWT (`@nestjs/jwt`), Jest

**Spec:** `docs/superpowers/specs/2026-05-19-self-service-password-reset-audit-design.md`

---

### Task 1: Add audit action constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts:464-473`

- [ ] **Step 1: Add 4 new action constants to `AuditGovernanceActions.ADMIN_PASSWORD_RESET`**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, find the `ADMIN_PASSWORD_RESET` block and add 4 entries after `RESET_CANCELLED`:

```typescript
  ADMIN_PASSWORD_RESET: {
    RESET_REQUESTED:   'RESET_REQUESTED',
    APPROVAL_GRANTED:  'APPROVAL_GRANTED',
    APPROVAL_DECLINED: 'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:  'APPROVAL_EXPIRED',
    RESET_EXECUTED:    'RESET_EXECUTED',
    RESET_FAILED:      'RESET_FAILED',
    RESET_CANCELLED:   'RESET_CANCELLED',
    // Self-service path (2026-05-19)
    SELF_RESET_REQUESTED:     'SELF_RESET_REQUESTED',
    SELF_RESET_TOKEN_CREATED: 'SELF_RESET_TOKEN_CREATED',
    SELF_RESET_COMPLETED:     'SELF_RESET_COMPLETED',
    RESET_CONSUMED:           'RESET_CONSUMED',
  },
```

- [ ] **Step 2: Verify build**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(audit): add self-service password reset audit action constants"
```

---

### Task 2: Propagate traceId through MFA JWT and guard

**Files:**
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:71-96` (requestSelfServiceReset)
- Modify: `src/modules/identity/auth/guards/password-reset-mfa.guard.ts:32-36`

- [ ] **Step 1: Write failing test — traceId present in JWT sign payload**

In `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts`, update the existing `should return MFA_REQUIRED with token for valid active user` test to also assert traceId is passed to JWT sign:

```typescript
    it('should return MFA_REQUIRED with token for valid active user', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      const result = await service.requestSelfServiceReset('a@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED', mfaSessionToken: 'mock-mfa-token' });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'password_reset_mfa',
          traceId: expect.any(String),
        }),
        { expiresIn: '5m' },
      );
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -20`
Expected: FAIL — `traceId: expect.any(String)` not matched because current code doesn't include traceId in JWT payload.

- [ ] **Step 3: Add traceId generation to `requestSelfServiceReset`**

In `src/modules/identity/users/admin-password-reset-workflow.service.ts`, modify `requestSelfServiceReset` to generate a traceId and include it in the JWT payload:

```typescript
  async requestSelfServiceReset(email: string): Promise<{ status: string; mfaSessionToken?: string }> {
    const user = await this.usersService.findByIdentifier(email);

    // Anti-enumeration: same response shape whether user exists or not
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.firstLoginStatus !== 'COMPLETED' ||
      !user.mfaEnabledAt
    ) {
      return { status: 'MFA_REQUIRED' };
    }

    const traceId = randomUUID();

    const mfaSessionToken = this.jwtService.sign(
      {
        sub: user.id,
        username: user.email,
        userNo: user.userNo,
        scope: 'password_reset_mfa',
        type: 'ADMIN',
        traceId,
      },
      { expiresIn: '5m' },
    );

    return { status: 'MFA_REQUIRED', mfaSessionToken };
  }
```

- [ ] **Step 4: Update guard to extract traceId from JWT**

In `src/modules/identity/auth/guards/password-reset-mfa.guard.ts`, add `traceId` to the extracted user object:

```typescript
    request.passwordResetMfaUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
      traceId: payload.traceId,
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/auth/guards/password-reset-mfa.guard.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts
git commit -m "feat(auth): propagate traceId through password-reset MFA JWT and guard"
```

---

### Task 3: Thread traceId through controller and `createResetTokenForSelf`

**Files:**
- Modify: `src/modules/identity/auth/password-reset.controller.ts:39-45`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:197-203` (createResetTokenForSelf)
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:319-387` (createResetToken)

- [ ] **Step 1: Update `createResetTokenForSelf` to accept and forward traceId**

In `src/modules/identity/users/admin-password-reset-workflow.service.ts`, change `createResetTokenForSelf`:

```typescript
  async createResetTokenForSelf(
    userId: string,
    userNo: string,
    email: string,
    traceId?: string,
  ): Promise<{ resetNo: string; status: string }> {
    return this.createResetToken(userId, userNo, email, 'SELF', null, null, traceId);
  }
```

- [ ] **Step 2: Update `createResetToken` to accept optional traceId**

Change the signature and the traceId assignment inside `createResetToken`:

```typescript
  private async createResetToken(
    userId: string,
    userNo: string,
    email: string,
    requestSource: string,
    requestedByUserId: string | null,
    requestedByUserNo: string | null,
    externalTraceId?: string,
  ): Promise<{ resetNo: string; status: string }> {
```

And replace the line `const traceId = randomUUID();` (line 352) with:

```typescript
    const traceId = externalTraceId || randomUUID();
```

- [ ] **Step 3: Update controller to pass traceId**

In `src/modules/identity/auth/password-reset.controller.ts`, update the `verifyMfa` method:

```typescript
  @Post('verify-mfa')
  @UseGuards(PasswordResetMfaGuard)
  @ApiOperation({ summary: 'Verify MFA for self-service password reset (C5)' })
  async verifyMfa(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetVerifyMfaDto,
  ) {
    const { userId, userNo, email, traceId } = req.passwordResetMfaUser;
    await this.mfaBindingWorkflow.verifyMfaCode(userId, body.code);
    return this.passwordResetWorkflow.createResetTokenForSelf(userId, userNo, email, traceId);
  }
```

- [ ] **Step 4: Verify build**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -20`
Expected: PASS (new optional parameter doesn't break existing callers)

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/auth/password-reset.controller.ts
git commit -m "feat(auth): thread traceId through controller to createResetToken"
```

---

### Task 4: Audit Call 1 — `requestSelfServiceReset`

**Files:**
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:69-96`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts`

- [ ] **Step 1: Write failing test — audit log written for valid user**

Add a new test in the `requestSelfServiceReset` describe block:

```typescript
    it('should write SELF_RESET_REQUESTED audit log for valid user', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      await service.requestSelfServiceReset('a@b.com');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SELF_RESET_REQUESTED',
          entityType: 'ADMIN_USER',
          entityId: 'u1',
          entityNo: 'ADM001',
          workflowType: 'ADMIN_PASSWORD_RESET',
          traceId: expect.any(String),
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u1',
          actorNo: 'ADM001',
          actorRole: 'SELF',
        }),
      );
    });

    it('should NOT write audit log when user not found', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue(null);
      await service.requestSelfServiceReset('nobody@b.com');
      expect(mockAuditLogsService.recordByActor).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -30`
Expected: FAIL — `SELF_RESET_REQUESTED` audit call not made.

- [ ] **Step 3: Add audit call to `requestSelfServiceReset`**

In `requestSelfServiceReset`, after generating traceId and before signing the JWT, add:

```typescript
    const traceId = randomUUID();

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.SELF_RESET_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { email: user.email, requestSource: 'SELF' },
        requestId: `SELF_RESET_REQUESTED_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: user.id,
        actorNo: user.userNo,
        actorRole: 'SELF',
      },
    );

    const mfaSessionToken = this.jwtService.sign(
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts
git commit -m "feat(audit): add SELF_RESET_REQUESTED audit log to requestSelfServiceReset"
```

---

### Task 5: Audit Call 2 — `createResetToken` (SELF path only)

**Files:**
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:319-387`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts`

- [ ] **Step 1: Write failing test**

Add a new describe block for `createResetTokenForSelf`:

```typescript
  describe('createResetTokenForSelf', () => {
    beforeEach(() => {
      mockPrisma.passwordResetToken.findFirst.mockResolvedValue(null);
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', status: 'PENDING',
      });
    });

    it('should write SELF_RESET_TOKEN_CREATED audit log', async () => {
      await service.createResetTokenForSelf('u1', 'ADM001', 'a@b.com', 'trace-abc');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SELF_RESET_TOKEN_CREATED',
          entityType: 'ADMIN_USER',
          entityId: 'u1',
          entityNo: 'ADM001',
          workflowType: 'ADMIN_PASSWORD_RESET',
          traceId: 'trace-abc',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u1',
          actorNo: 'ADM001',
          actorRole: 'SELF',
        }),
      );
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -30`
Expected: FAIL — `SELF_RESET_TOKEN_CREATED` audit call not made.

- [ ] **Step 3: Add audit call to `createResetToken`**

In `createResetToken`, after the token creation loop (after line 381 `}`), before the `// TODO: Send email` comment, add:

```typescript
    if (requestSource === 'SELF') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.SELF_RESET_TOKEN_CREATED,
          entityType: AuditEntityTypes.ADMIN_USER,
          entityId: userId,
          entityNo: userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
          traceId,
          result: AuditResult.SUCCESS,
          metadata: { resetNo, requestSource: 'SELF' },
          requestId: `SELF_RESET_TOKEN_CREATED_${userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: userId,
          actorNo: userNo,
          actorRole: 'SELF',
        },
      );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts
git commit -m "feat(audit): add SELF_RESET_TOKEN_CREATED audit log to createResetToken"
```

---

### Task 6: Audit Call 3 — `consumeResetToken` (both paths)

**Files:**
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:391-435`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts`

- [ ] **Step 1: Update existing test + add new test for admin path**

Replace the existing `consumeResetToken` test assertion (line 188-189 expects `recordSystem` with `PASSWORD_RESET_COMPLETED`, which is stale) and add a second test for admin-path token consumption:

```typescript
  describe('consumeResetToken', () => {
    it('should reset password and write SELF_RESET_COMPLETED audit for self-service token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR2605060001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
      });
      mockUsersDomainService.resetPassword.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});

      const result = await service.consumeResetToken('valid-token', 'NewPassword123!');
      expect(result).toEqual({ status: 'PASSWORD_RESET_COMPLETE' });
      expect(mockUsersDomainService.resetPassword).toHaveBeenCalled();
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SELF_RESET_COMPLETED',
          entityId: 'u1',
          entityNo: 'ADM001',
          traceId: 'trace-1',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u1',
          actorNo: 'ADM001',
          actorRole: 'SELF',
        }),
      );
    });

    it('should write RESET_CONSUMED audit for admin-initiated token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt2', resetNo: 'PWR002', userId: 'u2',
        status: 'PENDING', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'CISO', traceId: 'trace-2',
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', status: 'ACTIVE',
      });
      mockUsersDomainService.resetPassword.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', status: 'ACTIVE',
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});

      await service.consumeResetToken('admin-token', 'NewPassword123!');
      expect(mockAuditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESET_CONSUMED',
          entityId: 'u2',
          entityNo: 'ADM002',
          traceId: 'trace-2',
        }),
        expect.objectContaining({
          actorType: 'ADMIN',
          actorId: 'u2',
          actorNo: 'ADM002',
          actorRole: 'SELF',
        }),
      );
    });

    it('should reject expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() - 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      await expect(
        service.consumeResetToken('expired-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });

    it('should reject already consumed token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'CONSUMED', expiresAt: new Date(Date.now() + 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      await expect(
        service.consumeResetToken('used-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });

    it('should reject if token not found', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(
        service.consumeResetToken('bad-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -30`
Expected: FAIL — `SELF_RESET_COMPLETED` / `RESET_CONSUMED` audit calls not made.

- [ ] **Step 3: Add audit call to `consumeResetToken`**

In `consumeResetToken`, after the `$transaction` block and before `return`, add:

```typescript
    const consumeAction = tokenRecord.requestSource === 'SELF'
      ? AuditGovernanceActions.ADMIN_PASSWORD_RESET.SELF_RESET_COMPLETED
      : AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_CONSUMED;

    await this.auditLogsService.recordByActor(
      {
        action: consumeAction,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUser.id,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId: tokenRecord.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          resetNo: tokenRecord.resetNo,
          requestSource: tokenRecord.requestSource,
        },
        requestId: `PASSWORD_RESET_CONSUMED_${targetUser.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: targetUser.id,
        actorNo: targetUser.userNo,
        actorRole: 'SELF',
      },
    );

    return { status: 'PASSWORD_RESET_COMPLETE' };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest --testPathPattern="admin-password-reset-workflow" --verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd Exchange_js && npx jest --verbose 2>&1 | tail -30`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts
git commit -m "feat(audit): add audit log to consumeResetToken for both self-service and admin paths"
```
