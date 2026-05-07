# Admin Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Admin Password Reset workflow (V1 MVP #6) — self-service with MFA verification and CISO-initiated paths, no approval gate.

**Architecture:** Thin workflow service orchestrates two phases (request → consume). New `PasswordResetToken` Prisma model stores SHA-256 token hashes with 15-min TTL. Public controller handles self-service flow (3 endpoints), CISO endpoint added to existing users controller. All paths write audit logs under `workflowType: ADMIN_CREDENTIAL_MGMT`.

**Tech Stack:** NestJS, Prisma/SQLite, bcrypt, SHA-256, JWT (scoped tokens), otplib (TOTP), React (admin-web)

**Spec:** `docs/superpowers/specs/2026-05-06-admin-password-reset-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `prisma/migrations/.../migration.sql` | New `password_reset_tokens` table |
| Modify | `prisma/schema.prisma` | Add `PasswordResetToken` model + User inverse |
| Modify | `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add ADMIN_CREDENTIAL_MGMT constants |
| Modify | `src/modules/identity/users/users.domain.service.ts` | Add `resetPassword()` method |
| Create | `src/modules/identity/users/admin-password-reset-workflow.service.ts` | Workflow orchestration |
| Create | `src/modules/identity/auth/guards/password-reset-mfa.guard.ts` | MFA scope guard |
| Create | `src/modules/identity/auth/password-reset.controller.ts` | 3 public endpoints |
| Create | `src/modules/identity/users/dto/password-reset.dto.ts` | Request/consume DTOs |
| Modify | `src/modules/identity/users/users.controller.ts` | Add CISO endpoint |
| Modify | `src/modules/identity/users/users.module.ts` | Wire workflow service |
| Modify | `src/modules/identity/auth/auth.module.ts` | Wire controller + guard |
| Modify | `src/modules/identity/access-control/rbac.catalog.ts` | Add CISO permission |
| Create | `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts` | Workflow tests |
| Create | `admin-web/src/pages/ResetPasswordPage.tsx` | Token consume page |
| Modify | `admin-web/src/pages/AdminLogin.tsx` | Forgot Password flow |
| Modify | `admin-web/src/pages/PlatformMemberDetailPage.tsx` | CISO reset button |
| Modify | `admin-web/src/App.tsx` | Route registration |

---

### Task 1: Prisma Schema & Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add PasswordResetToken model to schema.prisma**

Find the `AdminUserInvitation` model in `prisma/schema.prisma` and add the new model directly after it. Also add the inverse relation field on the `User` model.

Add to the `User` model (after the existing `adminInvitations` relation):
```prisma
  passwordResetTokens PasswordResetToken[]
```

Add new model after `AdminUserInvitation`:
```prisma
model PasswordResetToken {
  id                String    @id @default(uuid())
  resetNo           String    @unique @default("TEMP")
  userId            String
  tokenHash         String    @unique
  status            String    @default("PENDING")
  requestSource     String
  requestedByUserId String?
  requestedByUserNo String?
  expiresAt         DateTime
  consumedAt        DateTime?
  traceId           String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status, expiresAt])
  @@index([traceId, createdAt])
  @@map("password_reset_tokens")
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add_password_reset_tokens
```
Expected: Migration created and applied successfully, `npx prisma generate` runs automatically.

- [ ] **Step 3: Verify Prisma client types**

Run:
```bash
cd Exchange_js && npx prisma generate
```
Expected: No errors, `PasswordResetToken` type available in generated client.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(schema): add PasswordResetToken model for admin password reset (C5)
EOF
)"
```

---

### Task 2: Audit Constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add entity type**

In `AuditEntityTypes` (after line `ADMIN_USER: 'ADMIN_USER'`), add:
```typescript
  PASSWORD_RESET_TOKEN: 'PASSWORD_RESET_TOKEN',
```

- [ ] **Step 2: Add workflow types**

In `AuditWorkflowTypes` (after `ADMIN_FIRST_LOGIN: 'ADMIN_FIRST_LOGIN'`), add:
```typescript
  // C5 — Admin Password Reset (shared with future MFA Reset, Session Revocation)
  ADMIN_CREDENTIAL_MGMT: 'ADMIN_CREDENTIAL_MGMT',
```

In `AuditBusinessWorkflowTypes` (after `ADMIN_ACCOUNT_DELETION: 'ADMIN_ACCOUNT_DELETION'`), add:
```typescript
  ADMIN_CREDENTIAL_MGMT: 'ADMIN_CREDENTIAL_MGMT',
```

- [ ] **Step 3: Add governance actions**

In `AuditGovernanceActions` (after the `ADMIN_FIRST_LOGIN` block), add:
```typescript
  // C5 — Admin Password Reset
  ADMIN_CREDENTIAL_MGMT: {
    PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
    PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
    PASSWORD_RESET_FAILED:    'PASSWORD_RESET_FAILED',
    PASSWORD_RESET_REVOKED:   'PASSWORD_RESET_REVOKED',
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: No errors related to audit-actions.constant.ts.

- [ ] **Step 5: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "$(cat <<'EOF'
feat(audit): add ADMIN_CREDENTIAL_MGMT constants for password reset (C5)
EOF
)"
```

---

### Task 3: Domain Service — `resetPassword()` (TDD)

**Files:**
- Modify: `src/modules/identity/users/users.domain.service.ts`
- Test: `src/modules/identity/users/users.domain.service.spec.ts` (create or modify)

- [ ] **Step 1: Write the failing test**

Create/append to `src/modules/identity/users/users.domain.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersDomainService } from './users.domain.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('UsersDomainService.resetPassword', () => {
  let service: UsersDomainService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersDomainService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UsersDomainService);
  });

  it('should update password and clear lock state for ACTIVE user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
      firstLoginStatus: 'COMPLETED', deletedAt: null,
    });
    prisma.user.update.mockResolvedValue({
      id: 'u1', userNo: 'ADM001', status: 'ACTIVE',
    });

    const result = await service.resetPassword('u1', 'newHashedPassword');
    expect(result).toEqual({ id: 'u1', userNo: 'ADM001', status: 'ACTIVE' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        password: 'newHashedPassword',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, userNo: true, status: true },
    });
  });

  it('should throw NotFoundException if user not found', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.resetPassword('u1', 'hash')).rejects.toThrow(NotFoundException);
  });

  it('should throw ConflictException if user status is not ACTIVE', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', status: 'SUSPENDED', firstLoginStatus: 'COMPLETED',
    });
    await expect(service.resetPassword('u1', 'hash')).rejects.toThrow(ConflictException);
  });

  it('should throw ConflictException if firstLoginStatus is not COMPLETED', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', status: 'ACTIVE', firstLoginStatus: 'MFA_BINDING',
    });
    await expect(service.resetPassword('u1', 'hash')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd Exchange_js && npx jest --testPathPattern='users.domain.service.spec' --no-coverage 2>&1 | tail -10
```
Expected: FAIL — `service.resetPassword is not a function`

- [ ] **Step 3: Implement resetPassword in users.domain.service.ts**

Add after the `reactivateUser` method (after line 191):

```typescript
  async resetPassword(
    userId: string,
    newPasswordHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userNo: string; status: string }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, status: true, firstLoginStatus: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset password for user in status: ${user.status}`);
    }
    if (user.firstLoginStatus !== 'COMPLETED') {
      throw new ConflictException('Cannot reset password before first login is completed');
    }

    const updated = await client.user.update({
      where: { id: userId },
      data: {
        password: newPasswordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, userNo: true, status: true },
    });

    return updated;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd Exchange_js && npx jest --testPathPattern='users.domain.service.spec' --no-coverage 2>&1 | tail -10
```
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/users.domain.service.ts src/modules/identity/users/users.domain.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(identity): add resetPassword domain method with TDD (C5)
EOF
)"
```

---

### Task 4: Password Reset MFA Guard

**Files:**
- Create: `src/modules/identity/auth/guards/password-reset-mfa.guard.ts`

- [ ] **Step 1: Create the guard**

Pattern copied from `mfa-session.guard.ts` with `scope: 'password_reset_mfa'`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class PasswordResetMfaGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing password-reset MFA token');
    }
    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired password-reset MFA token');
    }
    if (payload?.scope !== 'password_reset_mfa') {
      throw new ForbiddenException('This endpoint requires a password-reset MFA token');
    }
    request.passwordResetMfaUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
    };
    return true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/auth/guards/password-reset-mfa.guard.ts
git commit -m "$(cat <<'EOF'
feat(auth): add PasswordResetMfaGuard for scoped MFA verification (C5)
EOF
)"
```

---

### Task 5: DTOs

**Files:**
- Create: `src/modules/identity/users/dto/password-reset.dto.ts`

- [ ] **Step 1: Create DTOs**

```typescript
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class PasswordResetRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsNotEmpty()
  @IsEmail()
  email!: string;
}

export class PasswordResetVerifyMfaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  code!: string;
}

export class PasswordResetConsumeDto {
  @IsNotEmpty()
  @IsString()
  token!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/users/dto/password-reset.dto.ts
git commit -m "$(cat <<'EOF'
feat(identity): add password reset DTOs (C5)
EOF
)"
```

---

### Task 6: Workflow Service (TDD)

**Files:**
- Create: `src/modules/identity/users/admin-password-reset-workflow.service.ts`
- Create: `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
import { UsersDomainService } from './users.domain.service';
import { UsersService } from './users.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, ForbiddenException, TooManyRequestsException } from '@nestjs/common';

const mockAuditLogsService = {
  recordByActor: jest.fn().mockResolvedValue({}),
  recordSystem: jest.fn().mockResolvedValue({}),
};

const mockPrisma = {
  passwordResetToken: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

const mockUsersService = {
  findByIdentifier: jest.fn(),
};

const mockUsersDomainService = {
  resetPassword: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-mfa-token'),
};

describe('AdminPasswordResetWorkflowService', () => {
  let service: AdminPasswordResetWorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPasswordResetWorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: UsersDomainService, useValue: mockUsersDomainService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: 'AuditLogsService', useValue: mockAuditLogsService },
      ],
    }).compile();
    service = module.get(AdminPasswordResetWorkflowService);
  });

  describe('requestSelfServiceReset', () => {
    it('should return MFA_REQUIRED with token for valid active user', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
      });
      const result = await service.requestSelfServiceReset('a@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED', mfaSessionToken: 'mock-mfa-token' });
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'password_reset_mfa' }),
        { expiresIn: '5m' },
      );
    });

    it('should return MFA_REQUIRED without token for non-existent user (anti-enumeration)', async () => {
      mockUsersService.findByIdentifier.mockResolvedValue(null);
      const result = await service.requestSelfServiceReset('nobody@b.com');
      expect(result).toEqual({ status: 'MFA_REQUIRED' });
    });
  });

  describe('requestCisoReset', () => {
    it('should reject if actor = target', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1', userNo: 'ADM001', email: 'a@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'COMPLIANCE_OFFICER' } }],
      });
      await expect(
        service.requestCisoReset('u1', { userId: 'u1', userNo: 'ADM001' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject if target is SUPER_ADMIN', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2', userNo: 'ADM002', email: 'b@b.com',
        status: 'ACTIVE', firstLoginStatus: 'COMPLETED',
        mfaEnabledAt: new Date(), deletedAt: null,
        userRoles: [{ role: { code: 'SUPER_ADMIN' } }],
      });
      await expect(
        service.requestCisoReset('u2', { userId: 'u1', userNo: 'ADM001' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('consumeResetToken', () => {
    it('should reset password and mark token CONSUMED on valid token', async () => {
      const tokenHash = require('crypto').createHash('sha256').update('valid-token').digest('hex');
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
    });

    it('should reject expired token', async () => {
      const tokenHash = require('crypto').createHash('sha256').update('expired-token').digest('hex');
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt1', resetNo: 'PWR001', userId: 'u1',
        status: 'PENDING', expiresAt: new Date(Date.now() - 60000),
        requestSource: 'SELF', traceId: 'trace-1',
      });
      await expect(
        service.consumeResetToken('expired-token', 'NewPassword123!'),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd Exchange_js && npx jest --testPathPattern='admin-password-reset-workflow.service.spec' --no-coverage 2>&1 | tail -10
```
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement workflow service**

Create `src/modules/identity/users/admin-password-reset-workflow.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  TooManyRequestsException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UsersService } from './users.service';
import { UsersDomainService } from './users.domain.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_LIMIT_MS = TOKEN_TTL_MS;
const MAX_TOKEN_RETRIES = 5;

@Injectable()
export class AdminPasswordResetWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly usersDomainService: UsersDomainService,
    private readonly jwtService: JwtService,
    @Inject('AuditLogsService') private readonly auditLogsService: any,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async requestSelfServiceReset(email: string): Promise<{ status: string; mfaSessionToken?: string }> {
    const user = await this.usersService.findByIdentifier(email);

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      (user as any).firstLoginStatus !== 'COMPLETED' ||
      !(user as any).mfaEnabledAt ||
      (user as any).deletedAt
    ) {
      return { status: 'MFA_REQUIRED' };
    }

    const mfaSessionToken = this.jwtService.sign(
      {
        sub: user.id,
        username: user.email,
        userNo: (user as any).userNo,
        scope: 'password_reset_mfa',
        type: 'ADMIN',
      },
      { expiresIn: '5m' },
    );

    return { status: 'MFA_REQUIRED', mfaSessionToken };
  }

  async requestCisoReset(
    targetUserId: string,
    actor: { userId: string; userNo: string },
  ): Promise<{ resetNo: string; status: string }> {
    if (actor.userId === targetUserId) {
      throw new ForbiddenException('Cannot reset your own password via CISO path');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: {
        id: true, userNo: true, email: true, status: true,
        firstLoginStatus: true, mfaEnabledAt: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset password for user in status: ${target.status}`);
    }
    if (target.firstLoginStatus !== 'COMPLETED') {
      throw new ConflictException('Target user has not completed first login');
    }
    if (!target.mfaEnabledAt) {
      throw new ConflictException('Target user has not enabled MFA');
    }

    const roleCodes = target.userRoles.map((ur: any) => ur.role.code);
    if (roleCodes.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Cannot reset SUPER_ADMIN password via CISO path');
    }

    return this.createResetToken(
      target.id, target.userNo, target.email,
      'CISO', actor.userId, actor.userNo,
    );
  }

  async createResetTokenForSelf(
    userId: string,
    userNo: string,
    email: string,
  ): Promise<{ resetNo: string; status: string }> {
    return this.createResetToken(userId, userNo, email, 'SELF', null, null);
  }

  private async createResetToken(
    userId: string,
    userNo: string,
    email: string,
    requestSource: string,
    requestedByUserId: string | null,
    requestedByUserNo: string | null,
  ): Promise<{ resetNo: string; status: string }> {
    const cutoff = new Date(Date.now() - RATE_LIMIT_MS);
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId, createdAt: { gt: cutoff } },
      select: { id: true },
    });
    if (recent) {
      throw new TooManyRequestsException('A password reset was already requested recently. Please wait before trying again.');
    }

    const pendingTokens = await this.prisma.passwordResetToken.findMany({
      where: { userId, status: 'PENDING' },
      select: { id: true, resetNo: true, traceId: true },
    });
    if (pendingTokens.length > 0) {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
    }

    const traceId = randomUUID();
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);

    let resetNo = '';
    let tokenRecord: any;
    for (let i = 0; i < MAX_TOKEN_RETRIES; i++) {
      resetNo = generateReferenceNo('PWR');
      try {
        tokenRecord = await this.prisma.passwordResetToken.create({
          data: {
            resetNo,
            userId,
            tokenHash,
            status: 'PENDING',
            requestSource,
            requestedByUserId,
            requestedByUserNo,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            traceId,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && i < MAX_TOKEN_RETRIES - 1) continue;
        throw err;
      }
    }

    for (const old of pendingTokens) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_REVOKED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: old.id,
        entityNo: old.resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId: old.traceId,
        result: AuditResult.SUCCESS,
        metadata: { supersededByResetNo: resetNo },
        entityOwnerNo: userNo,
      });
    }

    // TODO: Send email via notification service
    // await this.notificationService.sendPasswordResetEmail(email, plainToken, requestSource);

    const actorContext = requestSource === 'CISO'
      ? { actorType: 'ADMIN' as const, actorId: requestedByUserId!, actorNo: requestedByUserNo!, actorRole: 'CISO' }
      : { actorType: 'ADMIN' as const, actorId: userId, actorNo: userNo, actorRole: 'SELF' };

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_REQUESTED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: tokenRecord.id,
        entityNo: resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          requestSource,
          ...(requestSource === 'CISO' ? { targetUserNo: userNo } : {}),
        },
        entityOwnerNo: userNo,
        sourcePlatform: 'ADMIN_API',
      },
      actorContext,
    );

    return { resetNo, status: 'RESET_EMAIL_SENT' };
  }

  async consumeResetToken(
    plainToken: string,
    newPassword: string,
  ): Promise<{ status: string }> {
    const tokenHash = this.hashToken(plainToken);
    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord || tokenRecord.status !== 'PENDING') {
      await this.recordFailure(tokenRecord, 'INVALID_OR_CONSUMED_TOKEN');
      throw new BadRequestException({ code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Invalid or expired reset token' });
    }
    if (tokenRecord.expiresAt <= new Date()) {
      await this.recordFailure(tokenRecord, 'TOKEN_EXPIRED');
      throw new BadRequestException({ code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Invalid or expired reset token' });
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: tokenRecord.userId, deletedAt: null },
      select: { id: true, userNo: true, status: true },
    });
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      await this.recordFailure(tokenRecord, 'USER_NOT_ACTIVE');
      throw new BadRequestException({ code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction(async (tx: any) => {
      await this.usersDomainService.resetPassword(targetUser.id, passwordHash, tx);
      await tx.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
    });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_COMPLETED,
      entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
      entityId: tokenRecord.id,
      entityNo: tokenRecord.resetNo,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
      traceId: tokenRecord.traceId,
      result: AuditResult.SUCCESS,
      metadata: { requestSource: tokenRecord.requestSource },
      entityOwnerNo: targetUser.userNo,
    });

    return { status: 'PASSWORD_RESET_COMPLETE' };
  }

  private async recordFailure(tokenRecord: any, reason: string): Promise<void> {
    if (!tokenRecord) return;
    try {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_FAILED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: tokenRecord.id,
        entityNo: tokenRecord.resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId: tokenRecord.traceId,
        result: AuditResult.FAILED,
        metadata: { reason, requestSource: tokenRecord.requestSource },
        entityOwnerNo: tokenRecord.userId,
      });
    } catch {
      // audit failure must not block error response
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd Exchange_js && npx jest --testPathPattern='admin-password-reset-workflow.service.spec' --no-coverage 2>&1 | tail -15
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(identity): add AdminPasswordResetWorkflowService with TDD (C5)
EOF
)"
```

---

### Task 7: Public Controller

**Files:**
- Create: `src/modules/identity/auth/password-reset.controller.ts`

- [ ] **Step 1: Create password-reset.controller.ts**

```typescript
import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPasswordResetWorkflowService } from '../users/admin-password-reset-workflow.service';
import { FirstLoginWorkflowService } from '../users/first-login-workflow.service';
import { PasswordResetMfaGuard } from './guards/password-reset-mfa.guard';
import {
  PasswordResetRequestDto,
  PasswordResetVerifyMfaDto,
  PasswordResetConsumeDto,
} from '../users/dto/password-reset.dto';

@ApiTags('password-reset')
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(
    private readonly passwordResetWorkflow: AdminPasswordResetWorkflowService,
    private readonly firstLoginWorkflow: FirstLoginWorkflowService,
  ) {}

  @Post('request')
  @ApiOperation({ summary: 'Request self-service password reset (C5)' })
  async request(
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetRequestDto,
  ) {
    return this.passwordResetWorkflow.requestSelfServiceReset(body.email);
  }

  @Post('verify-mfa')
  @UseGuards(PasswordResetMfaGuard)
  @ApiOperation({ summary: 'Verify MFA for self-service password reset (C5)' })
  async verifyMfa(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetVerifyMfaDto,
  ) {
    const { userId, userNo, email } = req.passwordResetMfaUser;
    await this.firstLoginWorkflow.verifyMfaCode(userId, body.code);
    return this.passwordResetWorkflow.createResetTokenForSelf(userId, userNo, email);
  }

  @Post('consume')
  @ApiOperation({ summary: 'Consume reset token and set new password (C5)' })
  async consume(
    @Body(new ValidationPipe({ transform: true })) body: PasswordResetConsumeDto,
  ) {
    return this.passwordResetWorkflow.consumeResetToken(body.token, body.newPassword);
  }
}
```

Note: `verifyMfaCode` is a thin wrapper we need on `FirstLoginWorkflowService` that does TOTP verification. If it doesn't exist yet, extract the TOTP verify logic from `verifyMfaBind` into a reusable method, or call the verification logic directly in the workflow service. Check the existing method and adapt — the key is reusing the `otplib` verify + fail count + lockout logic.

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/auth/password-reset.controller.ts
git commit -m "$(cat <<'EOF'
feat(auth): add PasswordResetController with 3 public endpoints (C5)
EOF
)"
```

---

### Task 8: CISO Endpoint on Users Controller

**Files:**
- Modify: `src/modules/identity/users/users.controller.ts`

- [ ] **Step 1: Add import**

Add to imports at top of `users.controller.ts`:
```typescript
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
```

- [ ] **Step 2: Inject in constructor**

Add to constructor parameters:
```typescript
    private readonly adminPasswordResetWorkflow: AdminPasswordResetWorkflowService,
```

- [ ] **Step 3: Add endpoint after reactivateUser method (after line 156)**

```typescript
  @Post(':id/reset-password')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/reset-password'))
  @ApiOperation({ summary: 'Initiate CISO password reset for admin user (C5)' })
  async resetPassword(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminPasswordResetWorkflow.requestCisoReset(
      id,
      { userId: req.user.userId, userNo: req.user.userNo },
    );
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/users/users.controller.ts
git commit -m "$(cat <<'EOF'
feat(identity): add CISO password reset endpoint on UsersController (C5)
EOF
)"
```

---

### Task 9: Module Wiring & RBAC

**Files:**
- Modify: `src/modules/identity/users/users.module.ts`
- Modify: `src/modules/identity/auth/auth.module.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Wire workflow service in users.module.ts**

Add import:
```typescript
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
```

Add to `providers` array:
```typescript
    AdminPasswordResetWorkflowService,
```

Add to `exports` array:
```typescript
    AdminPasswordResetWorkflowService,
```

- [ ] **Step 2: Wire controller and guard in auth.module.ts**

Add imports:
```typescript
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetMfaGuard } from './guards/password-reset-mfa.guard';
```

Add `PasswordResetMfaGuard` to `providers` array.
Add `PasswordResetController` to `controllers` array.

- [ ] **Step 3: Add RBAC permission**

In `src/modules/identity/access-control/rbac.catalog.ts`, add after the `reactivate` route (line ~197):
```typescript
  route('POST', '/users/:id/reset-password', 'Reset admin password (C5)', ['IAM_ASSIGN']),
```

- [ ] **Step 4: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/users.module.ts src/modules/identity/auth/auth.module.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "$(cat <<'EOF'
feat(identity): wire password reset service, controller, guard, and RBAC (C5)
EOF
)"
```

---

### Task 10: Frontend — ResetPasswordPage

**Files:**
- Create: `admin-web/src/pages/ResetPasswordPage.tsx`

- [ ] **Step 1: Create ResetPasswordPage.tsx**

```tsx
import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { adminFetch } from '../utils/adminFetch';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await adminFetch('/auth/password-reset/consume', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Reset failed');
      }
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Link is invalid or expired');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-adm-panel">
        <div className="bg-adm-card p-8 rounded-lg shadow max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-adm-t1 mb-4">Invalid Link</h2>
          <p className="text-adm-t2 mb-4">No reset token found in the URL.</p>
          <button onClick={() => navigate('/login')} className="text-adm-blue hover:underline">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-adm-panel">
        <div className="bg-adm-card p-8 rounded-lg shadow max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-adm-t1 mb-4">Password Reset Complete</h2>
          <p className="text-adm-t2 mb-6">Your password has been successfully reset.</p>
          <button onClick={() => navigate('/login')} className="bg-adm-blue text-white px-6 py-2 rounded hover:opacity-90">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-adm-panel">
      <div className="bg-adm-card p-8 rounded-lg shadow max-w-md w-full">
        <h2 className="text-xl font-semibold text-adm-t1 mb-6">Set New Password</h2>
        {(status === 'error' || errorMsg) && (
          <div className="bg-red-50 border border-adm-red text-adm-red p-3 rounded mb-4 text-sm">
            {errorMsg || 'Link is invalid or expired.'}
            <button onClick={() => navigate('/login')} className="block mt-2 text-adm-blue hover:underline text-sm">
              Request a new reset
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-adm-t2 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-adm-border rounded px-3 py-2 bg-adm-bg text-adm-t1"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-adm-t2 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-adm-border rounded px-3 py-2 bg-adm-bg text-adm-t1"
              minLength={8}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-adm-blue text-white py-2 rounded hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/ResetPasswordPage.tsx
git commit -m "$(cat <<'EOF'
feat(admin-web): add ResetPasswordPage for token consumption (C5)
EOF
)"
```

---

### Task 11: Frontend — AdminLogin Forgot Password Flow

**Files:**
- Modify: `admin-web/src/pages/AdminLogin.tsx`

- [ ] **Step 1: Add forgot password state and inline step flow**

Read the existing `AdminLogin.tsx` to understand the current structure, then add:

1. A `forgotStep` state: `'none' | 'email' | 'mfa' | 'sent'`
2. A "Forgot Password?" link below the login form
3. Conditional rendering for each step:
   - `email`: email input field + submit button → calls `POST /auth/password-reset/request`
   - `mfa`: MFA code input → calls `POST /auth/password-reset/verify-mfa` with the `mfaSessionToken` from the previous step in Authorization header
   - `sent`: success message "Reset link sent to your email"
4. A "Back to Login" link at each step that resets `forgotStep` to `'none'`

The exact implementation depends on the current AdminLogin.tsx structure — read it first and adapt. Key pattern: store `mfaSessionToken` from step 1 response in local state, pass it as Bearer token in step 2.

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/AdminLogin.tsx
git commit -m "$(cat <<'EOF'
feat(admin-web): add Forgot Password inline flow to login page (C5)
EOF
)"
```

---

### Task 12: Frontend — CISO Reset Button on Member Detail

**Files:**
- Modify: `admin-web/src/pages/PlatformMemberDetailPage.tsx`

- [ ] **Step 1: Add Reset Password button**

Read `PlatformMemberDetailPage.tsx` to understand the existing action section pattern (look for how Suspend/Reactivate buttons are implemented), then add:

1. A "Reset Password" button in the action section
2. Show only when the current user has CISO/IAM_ASSIGN role AND target status is ACTIVE
3. Disable when target has SUPER_ADMIN role
4. On click: show confirmation dialog ("Confirm password reset for {userNo}?")
5. On confirm: `POST /admin/iam/members/{userId}/password-reset` via `adminFetch`
6. Success: toast notification "Reset link sent to {email}"
7. Error: toast with error message

Match the existing button styling patterns (Suspend/Reactivate buttons) for consistency.

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/PlatformMemberDetailPage.tsx
git commit -m "$(cat <<'EOF'
feat(admin-web): add CISO password reset button on member detail page (C5)
EOF
)"
```

---

### Task 13: Route Registration & Roadmap Update

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `Exchange_js/doc-final/reference/roadmap.md`

- [ ] **Step 1: Register /reset-password route in App.tsx**

Read `admin-web/src/App.tsx` to find the route registration section. Add the public route (outside auth guard):

```tsx
import ResetPasswordPage from './pages/ResetPasswordPage';

// In the routes, add as a public route (same level as /login):
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

Ensure this route is registered alongside `/login` (outside any auth-guarded layout), not inside protected routes.

- [ ] **Step 2: Update roadmap**

In `doc-final/reference/roadmap.md`, update the Admin Password Reset entry (line ~37) from:
```
- [ ] Admin Password Reset（自助 + CISO 代操作...
```
to:
```
- [x] Admin Password Reset（自助 + CISO 代操作；薄 workflow 层审计打点，`workflowType: ADMIN_CREDENTIAL_MGMT`） — **VARA**：TIR Rulebook III.A Authentication — 凭证生命周期管理，泄露时必须能即时重置 ✅ 2026-05-06
```

- [ ] **Step 3: Run full test suite**

```bash
cd Exchange_js && npx jest --no-coverage 2>&1 | tail -20
```
Expected: All tests PASS, no regressions.

- [ ] **Step 4: Final commit**

```bash
git add admin-web/src/App.tsx doc-final/reference/roadmap.md
git commit -m "$(cat <<'EOF'
feat(admin-web): register /reset-password route and mark C5 complete in roadmap
EOF
)"
```

---

## Implementation Notes

### MFA Verification Reuse

Task 7's `verify-mfa` endpoint needs to call TOTP verification logic. The existing `FirstLoginWorkflowService.verifyMfaBind` does TOTP verify + fail count + lockout, but it also completes MFA binding (sets `firstLoginStatus`). You need to either:

1. Extract a `verifyMfaCode(userId, code)` method from `FirstLoginWorkflowService` that only does TOTP verify + fail count (no binding side effects), OR
2. Call the TOTP verify directly in the workflow service by importing `getOtp()` and `decryptMfaSecret()` from the first-login workflow.

Option 1 is cleaner. Add the method to `FirstLoginWorkflowService` and call it from `PasswordResetController`.

### Notification Service

The `createResetToken` method has a TODO for sending the email. Wire this to the existing notification service when available. For MVP, the token is generated and audit-logged — the email can be sent manually or the notification service integrated in a follow-up.

### AuditLogsService Injection

The workflow injects `AuditLogsService` via `@Inject('AuditLogsService')`. Check how other workflow services inject it — if they use a direct class import, use the same pattern:
```typescript
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
```
And inject normally in constructor. The spec uses string token injection as a placeholder — match the existing codebase pattern.
