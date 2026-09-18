# Admin First Login Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Admin First Login ceremony (身份确认 → TOTP MFA 绑定 → 安全须知确认 → 完成) and enforce TOTP verification on all subsequent logins.

**Architecture:** Backend uses a restricted `firstLoginToken` (JWT scope `first_login`) issued instead of the normal access token when `firstLoginStatus ≠ COMPLETED`. A new `FirstLoginWorkflowService` (Layer 3, no approval gate) orchestrates step transitions and audit logging. Every subsequent normal login also requires TOTP verification via a short-lived `mfaSessionToken`. Frontend adds a single wizard page at `/admin/first-login` and detects the new login response shapes in `AdminLogin.tsx`.

**Tech Stack:** NestJS + Prisma + SQLite (backend), `otplib` (TOTP), `qrcode` (QR data URL generation server-side), React + TypeScript (frontend, no new frontend library needed).

---

## File Map

**New — backend:**
- `src/modules/identity/users/first-login-workflow.service.ts` — Layer 3, step transitions + audit
- `src/modules/identity/users/first-login-workflow.service.spec.ts` — unit tests
- `src/modules/identity/auth/guards/first-login.guard.ts` — validates `scope === 'first_login'`
- `src/modules/identity/auth/guards/mfa-session.guard.ts` — validates `scope === 'mfa_session'`
- `src/modules/identity/auth/first-login.controller.ts` — routes `/admin/auth/first-login/*` and `/admin/auth/mfa/verify`
- `src/modules/identity/auth/dto/first-login.dto.ts` — DTOs for all steps
- `src/common/utils/mfa-crypto.util.ts` — AES-256-GCM encrypt/decrypt for TOTP secret

**Modified — backend:**
- `prisma/schema.prisma` — new enum `FirstLoginStatus`, new fields on `User`
- `src/modules/audit-logging/constants/audit-actions.constant.ts` — add `ADMIN_FIRST_LOGIN` entries
- `src/modules/identity/users/users.domain.service.ts` — add 5 first-login write methods
- `src/modules/identity/auth/auth.service.ts` — login() branches on firstLoginStatus and mfaEnabled
- `src/modules/identity/auth/jwt.strategy.ts` — attach `scope` to `request.user`
- `src/modules/identity/access-control/admin-permission.guard.ts` — reject `scope === 'first_login'`
- `src/modules/identity/users/users.module.ts` — register FirstLoginWorkflowService
- `src/modules/identity/auth/auth.module.ts` — register guards and FirstLoginController
- `prisma/seed.base.ts` — set `firstLoginStatus = 'COMPLETED'` for seed ACTIVE accounts

**New — frontend:**
- `admin-web/src/pages/AdminFirstLoginPage.tsx` — 4-step wizard

**Modified — frontend:**
- `admin-web/src/pages/AdminLogin.tsx` — handle `FIRST_LOGIN_REQUIRED` and `MFA_REQUIRED`
- `admin-web/src/App.tsx` — add `/admin/first-login` route

---

## Task 1: Install backend dependencies + Prisma schema

**Files:**
- Modify: `package.json`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_first_login_status/migration.sql` (auto-generated)

- [ ] **Step 1: Install otplib and qrcode**

```bash
cd Exchange_js
npm install otplib qrcode
npm install --save-dev @types/qrcode
```

Expected: packages added to `node_modules` and `package.json`.

- [ ] **Step 2: Add FirstLoginStatus enum and new User fields in schema.prisma**

Open `prisma/schema.prisma`. After the existing `model User {` block's last field (before the closing `@@index` lines), add the new fields. Also add the enum **outside** any model block (e.g., at the bottom of the file):

```prisma
// Add these 7 fields inside model User { ... }, before @@index([deletedAt])
  firstLoginStatus     String    @default("PENDING_IDENTITY_CONFIRM")
  mfaSecret            String?
  mfaEnabledAt         DateTime?
  mfaVerifyFailCount   Int       @default(0)
  mfaVerifyLockedUntil DateTime?
  securityAckAt        DateTime?
  firstLoginTraceId    String?
```

> Note: SQLite does not enforce enum types at DB level; Prisma stores as TEXT. No separate `enum` block is needed in the schema.

- [ ] **Step 3: Generate and apply migration**

```bash
cd Exchange_js
npx prisma migrate dev --name add_first_login_mfa_fields
```

Expected output: `✔  Generated Prisma Client`, migration file created in `prisma/migrations/`.

- [ ] **Step 4: Backfill existing ACTIVE users in the generated migration SQL**

Open the newly created `prisma/migrations/<timestamp>_add_first_login_mfa_fields/migration.sql`. Append at the end:

```sql
-- Backfill: existing ACTIVE accounts skip the first-login ceremony
UPDATE "users"
SET "firstLoginStatus" = 'COMPLETED'
WHERE "status" IN ('ACTIVE', 'SUSPENDED', 'INVITE_SENT');
```

Then re-apply (the migration file was already applied once; for a clean rebuild this runs automatically):

```bash
npx prisma migrate dev
```

Expected: no new migration created (file unchanged), `npx prisma db push` skipped.

- [ ] **Step 5: Verify schema change**

```bash
npx prisma studio
# or:
npx ts-node -e "const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient(); p.user.findFirst().then(u => { console.log(Object.keys(u)); p.\$disconnect(); })"
```

Expected output includes: `firstLoginStatus`, `mfaSecret`, `mfaEnabledAt`, `mfaVerifyFailCount`, `mfaVerifyLockedUntil`, `securityAckAt`, `firstLoginTraceId`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ package.json package-lock.json
git commit -m "feat(schema): add firstLoginStatus and MFA fields to User model"
```

---

## Task 2: Audit constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add ADMIN_FIRST_LOGIN to AuditWorkflowTypes**

In `audit-actions.constant.ts`, find the `AuditWorkflowTypes` block. After `AUDIT_EVIDENCE_PACKAGE_DELETION`:

```typescript
  // C3c — Admin First Login
  ADMIN_FIRST_LOGIN: 'ADMIN_FIRST_LOGIN',
```

- [ ] **Step 2: Add ADMIN_FIRST_LOGIN to AuditGovernanceActions**

Find the `AuditGovernanceActions` block. After the `ADMIN_SUSPENSION` entry, add:

```typescript
  // C3c — Admin First Login
  ADMIN_FIRST_LOGIN: {
    IDENTITY_CONFIRMED:       'FIRST_LOGIN_IDENTITY_CONFIRMED',
    MFA_BINDING_INITIATED:    'FIRST_LOGIN_MFA_BINDING_INITIATED',
    MFA_VERIFY_FAILED:        'FIRST_LOGIN_MFA_VERIFY_FAILED',
    MFA_BINDING_COMPLETED:    'FIRST_LOGIN_MFA_BINDING_COMPLETED',
    POLICY_ACKNOWLEDGED:      'FIRST_LOGIN_POLICY_ACKNOWLEDGED',
    FIRST_LOGIN_COMPLETED:    'FIRST_LOGIN_COMPLETED',
    MFA_VERIFY_LOCKED:        'FIRST_LOGIN_MFA_VERIFY_LOCKED',
    // Normal login (post-first-login)
    MFA_LOGIN_VERIFIED:       'MFA_LOGIN_VERIFIED',
    MFA_LOGIN_VERIFY_FAILED:  'MFA_LOGIN_VERIFY_FAILED',
  },
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.build.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(audit): add ADMIN_FIRST_LOGIN workflow type and governance actions"
```

---

## Task 3: MFA crypto utility

**Files:**
- Create: `src/common/utils/mfa-crypto.util.ts`

- [ ] **Step 1: Create the utility**

Create `src/common/utils/mfa-crypto.util.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // bytes for AES-256

function getKey(): Buffer {
  const hex = process.env.MFA_ENCRYPTION_KEY || '';
  if (hex.length !== 64) {
    throw new Error('MFA_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a TOTP secret for storage.
 * Output format: `iv_hex:authTag_hex:ciphertext_hex`
 */
export function encryptMfaSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a stored TOTP secret.
 */
export function decryptMfaSecret(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid encrypted MFA secret format');
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 2: Set MFA_ENCRYPTION_KEY in dev environment**

Open `Exchange_js/.env` (create if absent):

```bash
# Generate a 32-byte hex key for dev (run once, keep in .env)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env`:
```
MFA_ENCRYPTION_KEY=<paste 64-char hex output>
MFA_ISSUER=Exchange Admin
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.build.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/common/utils/mfa-crypto.util.ts
git commit -m "feat(utils): add AES-256-GCM encrypt/decrypt for MFA TOTP secrets"
```

---

## Task 4: UsersDomainService — first-login write methods

**Files:**
- Modify: `src/modules/identity/users/users.domain.service.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/identity/users/users.domain.service.firstlogin.spec.ts`:

```typescript
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UsersDomainService } from './users.domain.service';

describe('UsersDomainService — first-login methods', () => {
  let service: UsersDomainService;
  let prisma: any;

  const baseUser = {
    id: 'u1',
    userNo: 'ADM-001',
    email: 'a@b.com',
    status: 'ACTIVE',
    role: 'CISO',
    firstLoginStatus: 'PENDING_IDENTITY_CONFIRM',
    mfaVerifyFailCount: 0,
    mfaVerifyLockedUntil: null,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new UsersDomainService(prisma);
  });

  describe('setFirstLoginStatus', () => {
    it('throws NotFoundException when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.setFirstLoginStatus('u1', 'MFA_BINDING')).rejects.toThrow(NotFoundException);
    });

    it('updates status when user exists', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      prisma.user.update.mockResolvedValue({ ...baseUser, firstLoginStatus: 'MFA_BINDING' });
      await service.setFirstLoginStatus('u1', 'MFA_BINDING');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ firstLoginStatus: 'MFA_BINDING' }) }),
      );
    });
  });

  describe('incrementMfaVerifyFail', () => {
    it('increments fail count and returns updated count', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 2 });
      prisma.user.update.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 3 });
      const result = await service.incrementMfaVerifyFail('u1');
      expect(result.newCount).toBe(3);
      expect(result.locked).toBe(false);
    });

    it('sets mfaVerifyLockedUntil when count reaches 5', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 4 });
      prisma.user.update.mockResolvedValue({ ...baseUser, mfaVerifyFailCount: 5, mfaVerifyLockedUntil: new Date() });
      const result = await service.incrementMfaVerifyFail('u1');
      expect(result.newCount).toBe(5);
      expect(result.locked).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mfaVerifyLockedUntil: expect.any(Date) }),
        }),
      );
    });
  });

  describe('completeFirstLogin', () => {
    it('sets firstLoginStatus COMPLETED, securityAckAt, clears failCount', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      prisma.user.update.mockResolvedValue({ ...baseUser, firstLoginStatus: 'COMPLETED' });
      await service.completeFirstLogin('u1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstLoginStatus: 'COMPLETED',
            securityAckAt: expect.any(Date),
            mfaVerifyFailCount: 0,
            mfaVerifyLockedUntil: null,
          }),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js
npx jest users.domain.service.firstlogin.spec.ts --no-coverage
```

Expected: FAIL — `service.setFirstLoginStatus is not a function`.

- [ ] **Step 3: Add methods to UsersDomainService**

Open `src/modules/identity/users/users.domain.service.ts`. Add these methods to the class (after `reactivateUser`):

```typescript
async setFirstLoginStatus(
  userId: string,
  status: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx || this.prisma;
  const user = await client.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new NotFoundException('User not found');
  await client.user.update({ where: { id: userId }, data: { firstLoginStatus: status } });
}

async storeMfaSecret(
  userId: string,
  encryptedSecret: string,
  traceId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx || this.prisma;
  await client.user.update({
    where: { id: userId },
    data: { mfaSecret: encryptedSecret, firstLoginTraceId: traceId },
  });
}

async completeMfaBinding(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx || this.prisma;
  await client.user.update({
    where: { id: userId },
    data: {
      firstLoginStatus: 'POLICY_ACK_PENDING',
      mfaEnabledAt: new Date(),
      mfaVerifyFailCount: 0,
      mfaVerifyLockedUntil: null,
    },
  });
}

async incrementMfaVerifyFail(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ newCount: number; locked: boolean }> {
  const client = tx || this.prisma;
  const user = await client.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, mfaVerifyFailCount: true },
  });
  if (!user) throw new NotFoundException('User not found');

  const newCount = (user.mfaVerifyFailCount ?? 0) + 1;
  const locked = newCount >= 5;
  await client.user.update({
    where: { id: userId },
    data: {
      mfaVerifyFailCount: newCount,
      ...(locked ? { mfaVerifyLockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : {}),
    },
  });
  return { newCount, locked };
}

async completeFirstLogin(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx || this.prisma;
  await client.user.update({
    where: { id: userId },
    data: {
      firstLoginStatus: 'COMPLETED',
      securityAckAt: new Date(),
      mfaVerifyFailCount: 0,
      mfaVerifyLockedUntil: null,
    },
  });
}

async findFirstLoginState(userId: string): Promise<{
  id: string;
  userNo: string;
  email: string;
  role: string;
  firstLoginStatus: string;
  firstLoginTraceId: string | null;
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
  mfaVerifyFailCount: number;
  mfaVerifyLockedUntil: Date | null;
} | null> {
  return this.prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      userNo: true,
      email: true,
      role: true,
      firstLoginStatus: true,
      firstLoginTraceId: true,
      mfaSecret: true,
      mfaEnabledAt: true,
      mfaVerifyFailCount: true,
      mfaVerifyLockedUntil: true,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd Exchange_js
npx jest users.domain.service.firstlogin.spec.ts --no-coverage
```

Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/users.domain.service.ts \
        src/modules/identity/users/users.domain.service.firstlogin.spec.ts
git commit -m "feat(users): add first-login write methods to UsersDomainService"
```

---

## Task 5: FirstLoginWorkflowService (Layer 3)

**Files:**
- Create: `src/modules/identity/users/first-login-workflow.service.ts`
- Create: `src/modules/identity/users/first-login-workflow.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/identity/users/first-login-workflow.service.spec.ts`:

```typescript
import { ForbiddenException, TooManyRequestsException } from '@nestjs/common';
import { FirstLoginWorkflowService } from './first-login-workflow.service';

describe('FirstLoginWorkflowService', () => {
  let service: FirstLoginWorkflowService;
  let usersDomainService: any;
  let auditLogsService: any;
  let jwtService: any;

  const baseState = {
    id: 'u1',
    userNo: 'ADM-001',
    email: 'a@b.com',
    role: 'CISO',
    firstLoginStatus: 'PENDING_IDENTITY_CONFIRM',
    firstLoginTraceId: null,
    mfaSecret: null,
    mfaEnabledAt: null,
    mfaVerifyFailCount: 0,
    mfaVerifyLockedUntil: null,
  };

  beforeEach(() => {
    usersDomainService = {
      findFirstLoginState: jest.fn(),
      setFirstLoginStatus: jest.fn().mockResolvedValue(undefined),
      storeMfaSecret: jest.fn().mockResolvedValue(undefined),
      completeMfaBinding: jest.fn().mockResolvedValue(undefined),
      incrementMfaVerifyFail: jest.fn(),
      completeFirstLogin: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('full-access-token'),
    };
    service = new FirstLoginWorkflowService(usersDomainService, auditLogsService, jwtService);
  });

  describe('confirmIdentity', () => {
    it('throws ForbiddenException when status is not PENDING_IDENTITY_CONFIRM', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue({ ...baseState, firstLoginStatus: 'MFA_BINDING' });
      await expect(service.confirmIdentity('u1')).rejects.toThrow(ForbiddenException);
    });

    it('transitions to MFA_BINDING and writes audit log', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue(baseState);
      await service.confirmIdentity('u1');
      expect(usersDomainService.setFirstLoginStatus).toHaveBeenCalledWith('u1', 'MFA_BINDING', undefined);
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FIRST_LOGIN_IDENTITY_CONFIRMED' }),
        expect.any(Object),
      );
    });
  });

  describe('verifyMfaBind', () => {
    it('throws TooManyRequestsException when MFA verify locked', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue({
        ...baseState,
        firstLoginStatus: 'MFA_BINDING',
        mfaSecret: 'enc:tag:ct',
        mfaVerifyLockedUntil: new Date(Date.now() + 60000),
      });
      await expect(service.verifyMfaBind('u1', '123456')).rejects.toThrow(TooManyRequestsException);
    });

    it('throws ForbiddenException when status is not MFA_BINDING', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue({ ...baseState, firstLoginStatus: 'POLICY_ACK_PENDING' });
      await expect(service.verifyMfaBind('u1', '123456')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('acknowledgePolicy', () => {
    it('throws ForbiddenException when status is not POLICY_ACK_PENDING', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue({ ...baseState, firstLoginStatus: 'MFA_BINDING' });
      await expect(service.acknowledgePolicy('u1')).rejects.toThrow(ForbiddenException);
    });

    it('completes first login and returns full token info', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue({
        ...baseState,
        firstLoginStatus: 'POLICY_ACK_PENDING',
        firstLoginTraceId: 'trace-123',
      });
      const result = await service.acknowledgePolicy('u1');
      expect(usersDomainService.completeFirstLogin).toHaveBeenCalledWith('u1', undefined);
      expect(result).toHaveProperty('accessToken');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js
npx jest first-login-workflow.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './first-login-workflow.service'`.

- [ ] **Step 3: Create FirstLoginWorkflowService**

Create `src/modules/identity/users/first-login-workflow.service.ts`:

```typescript
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TooManyRequestsException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditGovernanceActions,
  AuditWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { UsersDomainService } from './users.domain.service';
import { encryptMfaSecret, decryptMfaSecret } from '../../../common/utils/mfa-crypto.util';

const MFA_ISSUER = process.env.MFA_ISSUER || 'Exchange Admin';
const MAX_VERIFY_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class FirstLoginWorkflowService {
  constructor(
    private readonly usersDomainService: UsersDomainService,
    private readonly auditLogsService: AuditLogsService,
    private readonly jwtService: JwtService,
  ) {}

  private auditActor(user: { id: string; userNo: string; role: string }) {
    return { actorType: 'ADMIN' as const, actorId: user.id, actorNo: user.userNo, actorRole: user.role };
  }

  async getStatus(userId: string): Promise<{ currentStep: string }> {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    return { currentStep: user.firstLoginStatus };
  }

  async getIdentityPreview(userId: string) {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    return { userNo: user.userNo, email: user.email, role: user.role, currentStep: user.firstLoginStatus };
  }

  async confirmIdentity(userId: string) {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.firstLoginStatus !== 'PENDING_IDENTITY_CONFIRM') {
      throw new ForbiddenException(`Cannot confirm identity in status: ${user.firstLoginStatus}`);
    }

    const traceId = randomUUID();
    await this.usersDomainService.setFirstLoginStatus(userId, 'MFA_BINDING');
    // Persist traceId for the sequence
    await this.usersDomainService.storeMfaSecret(userId, user.mfaSecret || '', traceId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.IDENTITY_CONFIRMED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        result: AuditResult.SUCCESS,
        requestId: `FIRST_LOGIN_IDENTITY_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.auditActor(user),
    );

    return { nextStep: 'MFA_BINDING', traceId };
  }

  async initMfaBind(userId: string) {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.firstLoginStatus !== 'MFA_BINDING') {
      throw new ForbiddenException(`Cannot init MFA in status: ${user.firstLoginStatus}`);
    }

    const secret = authenticator.generateSecret();
    const otpauthUri = authenticator.keyuri(user.email, MFA_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    const encryptedSecret = encryptMfaSecret(secret);

    const traceId = user.firstLoginTraceId || randomUUID();
    await this.usersDomainService.storeMfaSecret(userId, encryptedSecret, traceId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_BINDING_INITIATED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        result: AuditResult.SUCCESS,
        requestId: `FIRST_LOGIN_MFA_INIT_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.auditActor(user),
    );

    // manualKey: groups of 4 chars for readability
    const manualKey = secret.replace(/(.{4})/g, '$1 ').trim();
    return { qrDataUrl, manualKey, otpauthUri };
  }

  async verifyMfaBind(userId: string, code: string) {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.firstLoginStatus !== 'MFA_BINDING') {
      throw new ForbiddenException(`Cannot verify MFA in status: ${user.firstLoginStatus}`);
    }
    if (!user.mfaSecret) {
      throw new ForbiddenException('MFA not initialized. Call /mfa/init first.');
    }

    // Check lock
    if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil > new Date()) {
      const retryAfterMs = user.mfaVerifyLockedUntil.getTime() - Date.now();
      throw new TooManyRequestsException({
        message: 'Too many failed attempts. Try again later.',
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      });
    }

    const traceId = user.firstLoginTraceId || randomUUID();
    const secret = decryptMfaSecret(user.mfaSecret);
    const isValid = authenticator.verify({ token: code, secret });

    if (!isValid) {
      const { newCount, locked } = await this.usersDomainService.incrementMfaVerifyFail(userId);
      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_VERIFY_FAILED,
          entityType: AuditEntityTypes.ADMIN_USER,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
          traceId,
          result: AuditResult.FAILED,
          reason: 'Invalid TOTP code',
          metadata: { attemptCount: newCount, locked },
          requestId: `FIRST_LOGIN_MFA_FAIL_${user.userNo}_${newCount}`,
          sourcePlatform: 'ADMIN_API',
        },
        this.auditActor(user),
      );

      if (locked) {
        throw new TooManyRequestsException({
          message: 'Too many failed attempts. Account locked for 15 minutes.',
          retryAfterSeconds: LOCK_DURATION_MS / 1000,
        });
      }

      throw new ForbiddenException({
        message: 'Invalid TOTP code.',
        attemptsRemaining: MAX_VERIFY_ATTEMPTS - newCount,
      });
    }

    await this.usersDomainService.completeMfaBinding(userId);
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_BINDING_COMPLETED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        result: AuditResult.SUCCESS,
        requestId: `FIRST_LOGIN_MFA_COMPLETE_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.auditActor(user),
    );

    return { nextStep: 'POLICY_ACK_PENDING' };
  }

  async acknowledgePolicy(userId: string) {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.firstLoginStatus !== 'POLICY_ACK_PENDING') {
      throw new ForbiddenException(`Cannot acknowledge policy in status: ${user.firstLoginStatus}`);
    }

    const traceId = user.firstLoginTraceId || randomUUID();
    await this.usersDomainService.completeFirstLogin(userId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.POLICY_ACKNOWLEDGED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        result: AuditResult.SUCCESS,
        requestId: `FIRST_LOGIN_POLICY_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.auditActor(user),
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.FIRST_LOGIN_COMPLETED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        result: AuditResult.SUCCESS,
        requestId: `FIRST_LOGIN_COMPLETED_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.auditActor(user),
    );

    // Issue full access token
    const accessToken = this.jwtService.sign({
      username: user.email,
      sub: user.id,
      userNo: user.userNo,
      role: user.role,
      roleCodes: [user.role],
      type: 'ADMIN',
    });

    return { accessToken };
  }

  async verifyMfaLogin(userId: string, code: string, roleCodes: string[], role: string, email: string, userNo: string) {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.mfaSecret) throw new ForbiddenException('MFA not set up');

    if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil > new Date()) {
      const retryAfterMs = user.mfaVerifyLockedUntil.getTime() - Date.now();
      throw new TooManyRequestsException({
        message: 'Too many failed MFA attempts. Try again later.',
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      });
    }

    const secret = decryptMfaSecret(user.mfaSecret);
    const isValid = authenticator.verify({ token: code, secret });

    if (!isValid) {
      const { newCount, locked } = await this.usersDomainService.incrementMfaVerifyFail(userId);
      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_LOGIN_VERIFY_FAILED,
          entityType: AuditEntityTypes.ADMIN_USER,
          entityId: userId,
          entityNo: userNo,
          workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
          traceId: randomUUID(),
          result: AuditResult.FAILED,
          reason: 'Invalid TOTP code on login',
          metadata: { attemptCount: newCount, locked },
          requestId: `MFA_LOGIN_FAIL_${userNo}_${newCount}`,
          sourcePlatform: 'ADMIN_API',
        },
        { actorType: 'ADMIN', actorId: userId, actorNo: userNo, actorRole: role },
      );
      if (locked) {
        throw new TooManyRequestsException({ message: 'Account locked for 15 minutes.', retryAfterSeconds: LOCK_DURATION_MS / 1000 });
      }
      throw new ForbiddenException({ message: 'Invalid TOTP code.', attemptsRemaining: MAX_VERIFY_ATTEMPTS - newCount });
    }

    // Reset fail count on success
    await this.usersDomainService.incrementMfaVerifyFail(userId); // We pass but actually reset
    // Actually use a direct reset — add clearMfaVerifyFail to domain service or inline:
    // We call completeFirstLogin-like logic but only reset counters
    // For now inline via storeMfaSecret workaround — add clearMfaVerifyFail to domain service in Task 4 addendum:
    // await this.usersDomainService.clearMfaVerifyFail(userId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_LOGIN_VERIFIED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: userId,
        entityNo: userNo,
        workflowType: AuditWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId: randomUUID(),
        result: AuditResult.SUCCESS,
        requestId: `MFA_LOGIN_OK_${userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      { actorType: 'ADMIN', actorId: userId, actorNo: userNo, actorRole: role },
    );

    const accessToken = this.jwtService.sign({
      username: email,
      sub: userId,
      userNo,
      role,
      roleCodes,
      type: 'ADMIN',
    });
    return { accessToken };
  }
}
```

> **Note — `verifyMfaLogin` fix:** The method above calls `incrementMfaVerifyFail` incorrectly on success. Before committing, also add `clearMfaVerifyFail` to `UsersDomainService`:
>
> ```typescript
> async clearMfaVerifyFail(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
>   const client = tx || this.prisma;
>   await client.user.update({
>     where: { id: userId },
>     data: { mfaVerifyFailCount: 0, mfaVerifyLockedUntil: null },
>   });
> }
> ```
>
> Then in `verifyMfaLogin` success path, replace the workaround call with `await this.usersDomainService.clearMfaVerifyFail(userId)`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd Exchange_js
npx jest first-login-workflow.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/first-login-workflow.service.ts \
        src/modules/identity/users/first-login-workflow.service.spec.ts \
        src/modules/identity/users/users.domain.service.ts
git commit -m "feat(first-login): add FirstLoginWorkflowService and clearMfaVerifyFail"
```

---

## Task 6: JWT scope guards

**Files:**
- Create: `src/modules/identity/auth/guards/first-login.guard.ts`
- Create: `src/modules/identity/auth/guards/mfa-session.guard.ts`
- Modify: `src/modules/identity/access-control/admin-permission.guard.ts`
- Modify: `src/modules/identity/auth/jwt.strategy.ts`

- [ ] **Step 1: Create FirstLoginGuard**

Create `src/modules/identity/auth/guards/first-login.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class FirstLoginGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing first-login token');
    }
    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired first-login token');
    }
    if (payload?.scope !== 'first_login') {
      throw new ForbiddenException('This endpoint requires a first-login token');
    }
    request.firstLoginUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
      role: payload.role,
    };
    return true;
  }
}
```

- [ ] **Step 2: Create MfaSessionGuard**

Create `src/modules/identity/auth/guards/mfa-session.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class MfaSessionGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing MFA session token');
    }
    const token = authHeader.slice(7);
    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA session token');
    }
    if (payload?.scope !== 'mfa_session') {
      throw new ForbiddenException('This endpoint requires an MFA session token');
    }
    request.mfaSessionUser = {
      userId: payload.sub,
      userNo: payload.userNo,
      email: payload.username,
      role: payload.role,
      roleCodes: payload.roleCodes,
    };
    return true;
  }
}
```

- [ ] **Step 3: Modify JwtStrategy to attach scope to request.user**

In `src/modules/identity/auth/jwt.strategy.ts`, in the `validate` method's return object, add `scope`:

```typescript
    return {
      userId: payload.sub,
      username: payload.username,
      userNo: payload.userNo,
      role: payload.role,
      roleCodes,
      type: payload.type,
      scope: payload.scope ?? null,  // <-- add this line
    };
```

- [ ] **Step 4: Modify AdminPermissionGuard to reject first_login scope**

In `src/modules/identity/access-control/admin-permission.guard.ts`, at the start of `canActivate`, after `if (!user) { return true; }`, add:

```typescript
    // Reject restricted-scope tokens on normal admin routes
    if (user?.scope === 'first_login' || user?.scope === 'mfa_session') {
      throw new ForbiddenException('Restricted token cannot access this endpoint');
    }
```

- [ ] **Step 5: Verify TypeScript compilation**

```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.build.json
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/auth/guards/ \
        src/modules/identity/auth/jwt.strategy.ts \
        src/modules/identity/access-control/admin-permission.guard.ts
git commit -m "feat(auth): add FirstLoginGuard, MfaSessionGuard; block restricted scopes in AdminPermissionGuard"
```

---

## Task 7: DTOs + FirstLoginController

**Files:**
- Create: `src/modules/identity/auth/dto/first-login.dto.ts`
- Create: `src/modules/identity/auth/first-login.controller.ts`

- [ ] **Step 1: Create DTOs**

Create `src/modules/identity/auth/dto/first-login.dto.ts`:

```typescript
import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MfaVerifyDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}
```

- [ ] **Step 2: Create FirstLoginController**

Create `src/modules/identity/auth/first-login.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FirstLoginGuard } from './guards/first-login.guard';
import { MfaSessionGuard } from './guards/mfa-session.guard';
import { FirstLoginWorkflowService } from '../users/first-login-workflow.service';
import { MfaVerifyDto } from './dto/first-login.dto';

@ApiTags('first-login')
@Controller('auth')
export class FirstLoginController {
  constructor(private readonly firstLoginWorkflowService: FirstLoginWorkflowService) {}

  /** GET /admin/auth/first-login/status — Returns current step (for page refresh recovery) */
  @Get('first-login/status')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current first-login step' })
  async getStatus(@Req() req: any) {
    return this.firstLoginWorkflowService.getStatus(req.firstLoginUser.userId);
  }

  /** GET /admin/auth/first-login/me — Returns identity preview for step 1 */
  @Get('first-login/me')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get identity preview for first-login step 1' })
  async getIdentityPreview(@Req() req: any) {
    return this.firstLoginWorkflowService.getIdentityPreview(req.firstLoginUser.userId);
  }

  /** POST /admin/auth/first-login/confirm-identity */
  @Post('first-login/confirm-identity')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm identity (step 1 → MFA_BINDING)' })
  async confirmIdentity(@Req() req: any) {
    return this.firstLoginWorkflowService.confirmIdentity(req.firstLoginUser.userId);
  }

  /** POST /admin/auth/first-login/mfa/init — Generate TOTP secret + QR code */
  @Post('first-login/mfa/init')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize TOTP MFA binding (returns QR data URL)' })
  async initMfaBind(@Req() req: any) {
    return this.firstLoginWorkflowService.initMfaBind(req.firstLoginUser.userId);
  }

  /** POST /admin/auth/first-login/mfa/verify — Verify TOTP code (MFA_BINDING → POLICY_ACK_PENDING) */
  @Post('first-login/mfa/verify')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code to complete MFA binding' })
  async verifyMfaBind(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) body: MfaVerifyDto,
  ) {
    return this.firstLoginWorkflowService.verifyMfaBind(req.firstLoginUser.userId, body.code);
  }

  /** POST /admin/auth/first-login/policy/acknowledge — (POLICY_ACK_PENDING → COMPLETED, returns accessToken) */
  @Post('first-login/policy/acknowledge')
  @UseGuards(FirstLoginGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge security policy (completes first login, returns full access token)' })
  async acknowledgePolicy(@Req() req: any) {
    return this.firstLoginWorkflowService.acknowledgePolicy(req.firstLoginUser.userId);
  }

  /** POST /admin/auth/mfa/verify — Normal login TOTP step (uses mfaSessionToken) */
  @Post('mfa/verify')
  @UseGuards(MfaSessionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code on normal login (returns full access token)' })
  async verifyMfaLogin(
    @Req() req: any,
    @Body(new ValidationPipe({ whitelist: true })) body: MfaVerifyDto,
  ) {
    const { userId, userNo, email, role, roleCodes } = req.mfaSessionUser;
    return this.firstLoginWorkflowService.verifyMfaLogin(userId, body.code, roleCodes, role, email, userNo);
  }
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.build.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/auth/dto/first-login.dto.ts \
        src/modules/identity/auth/first-login.controller.ts
git commit -m "feat(first-login): add FirstLoginController and MfaVerifyDto"
```

---

## Task 8: Modify AuthService.login() — branching logic

**Files:**
- Modify: `src/modules/identity/auth/auth.service.ts`

- [ ] **Step 1: Modify login() to branch on firstLoginStatus**

Open `src/modules/identity/auth/auth.service.ts`. Replace the `login` method:

```typescript
  async login(user: any) {
    const resolvedRoleCodes = this.accessControlService
      ? await this.accessControlService.getUserRoleCodes(user.id)
      : [];
    const roleCodes = Array.from(
      new Set(
        [...resolvedRoleCodes, String(user.role || '').trim().toUpperCase()].filter(Boolean),
      ),
    );
    const primaryRole = getPrimaryRoleCode(roleCodes) || user.role || 'ADMIN';

    // --- First Login gate ---
    const firstLoginStatus = user.firstLoginStatus ?? 'COMPLETED';
    if (firstLoginStatus !== 'COMPLETED') {
      const firstLoginToken = this.jwtService.sign(
        {
          username: user.email,
          sub: user.id,
          userNo: user.userNo,
          role: primaryRole,
          scope: 'first_login',
          type: 'ADMIN',
        },
        { expiresIn: '15m' },
      );
      return { status: 'FIRST_LOGIN_REQUIRED', firstLoginToken };
    }

    // --- MFA gate (normal login after first login complete) ---
    if (user.mfaEnabledAt) {
      const mfaSessionToken = this.jwtService.sign(
        {
          username: user.email,
          sub: user.id,
          userNo: user.userNo,
          role: primaryRole,
          roleCodes,
          scope: 'mfa_session',
          type: 'ADMIN',
        },
        { expiresIn: '15m' },
      );
      return { status: 'MFA_REQUIRED', mfaSessionToken };
    }

    // --- Normal JWT (no MFA set up — legacy seed accounts) ---
    const payload = {
      username: user.email,
      sub: user.id,
      userNo: user.userNo,
      role: primaryRole,
      roleCodes,
      type: 'ADMIN',
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        userNo: user.userNo,
        email: user.email,
        role: primaryRole,
        roles: roleCodes,
        lastLoginAt: user.lastLoginAt,
      },
    };
  }
```

- [ ] **Step 2: Update validateUser to return firstLoginStatus and mfaEnabledAt**

In `auth.service.ts`, find the `validateUser` method. The success path does:
```typescript
const { password: _, ...result } = user;
return result;
```

The `user` object comes from `usersService.findByIdentifier`. Ensure that service returns `firstLoginStatus` and `mfaEnabledAt`. Open `src/modules/identity/users/users.service.ts` and find `findByIdentifier`. Update its `select` to include:

```typescript
firstLoginStatus: true,
mfaEnabledAt: true,
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.build.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/auth/auth.service.ts \
        src/modules/identity/users/users.service.ts
git commit -m "feat(auth): branch login() on firstLoginStatus and mfaEnabledAt"
```

---

## Task 9: Module wiring

**Files:**
- Modify: `src/modules/identity/users/users.module.ts`
- Modify: `src/modules/identity/auth/auth.module.ts`

- [ ] **Step 1: Register FirstLoginWorkflowService in UsersModule**

In `users.module.ts`, add to `providers`:

```typescript
import { FirstLoginWorkflowService } from './first-login-workflow.service';
// ...
providers: [
  UsersService,
  UsersDomainService,
  AdminInvitationsService,
  AdminInviteApprovalService,
  AdminInviteWorkflowService,
  AdminRoleBindingChangeApprovalService,
  AdminRoleBindingChangeWorkflowService,
  AdminSuspensionApprovalService,
  AdminSuspensionWorkflowService,
  FirstLoginWorkflowService,   // <-- add
],
exports: [UsersService, UsersDomainService, AdminInvitationsService, FirstLoginWorkflowService],  // <-- add to exports
```

- [ ] **Step 2: Register guards and FirstLoginController in AuthModule**

In `auth.module.ts`:

```typescript
import { FirstLoginController } from './first-login.controller';
import { FirstLoginGuard } from './guards/first-login.guard';
import { MfaSessionGuard } from './guards/mfa-session.guard';
// ...
@Module({
  imports: [
    UsersModule,
    AccessControlModule,
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  providers: [AuthService, CustomerAuthService, JwtStrategy, FirstLoginGuard, MfaSessionGuard],
  controllers: [CustomerAuthController, AuthController, FirstLoginController],
})
export class AuthModule {}
```

> `AuditLogsService` is already provided globally via `AuditLogsModule` — no extra import needed.

- [ ] **Step 3: Verify app starts**

```bash
cd Exchange_js
npm run dev:start
# Wait ~5 seconds, then:
curl -s http://localhost:3500/api | grep -c "swagger"
```

Expected: returns `1` (Swagger JSON reachable).

- [ ] **Step 4: Smoke test login response shapes**

```bash
# Test 1: seed account (COMPLETED status) → should return MFA_REQUIRED (mfaEnabledAt not set in seed yet → returns legacy token)
curl -s -X POST http://localhost:3500/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq .

# Test 2: try first-login endpoint without token → should 401
curl -s http://localhost:3500/auth/first-login/status | jq .
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/users.module.ts \
        src/modules/identity/auth/auth.module.ts
git commit -m "feat(modules): wire FirstLoginWorkflowService, FirstLoginGuard, MfaSessionGuard"
```

---

## Task 10: Update seed data

**Files:**
- Modify: `prisma/seed.base.ts`

- [ ] **Step 1: Set firstLoginStatus = COMPLETED for seed accounts**

Open `prisma/seed.base.ts`. Find where admin `User` records are created (look for `user.create` or `user.upsert` calls for seed accounts). Add `firstLoginStatus: 'COMPLETED'` to their `data` objects.

If seed accounts use `upsert`, also add it to the `update` block:

```typescript
data: {
  // ...existing fields...
  firstLoginStatus: 'COMPLETED',
  // mfaEnabledAt left null so login returns legacy token (no MFA prompt in dev)
},
```

- [ ] **Step 2: Apply seed**

```bash
cd Exchange_js
npm run dev:rebuild
```

Expected: no errors, seed completes.

- [ ] **Step 3: Verify seed accounts bypass first-login**

```bash
curl -s -X POST http://localhost:3500/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq '.status // .access_token'
```

Expected: response has `access_token` (not `FIRST_LOGIN_REQUIRED`), since seed account has `firstLoginStatus = COMPLETED` and `mfaEnabledAt = null`.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.base.ts
git commit -m "feat(seed): set firstLoginStatus=COMPLETED for seed admin accounts"
```

---

## Task 11: End-to-end backend smoke test

**Files:** No new files — manual test via curl.

- [ ] **Step 1: Create a test admin user with PENDING_IDENTITY_CONFIRM status**

```bash
# Register a new invite (using existing flow) or directly via Prisma studio:
# Open Prisma studio and set firstLoginStatus = 'PENDING_IDENTITY_CONFIRM' on a test user
# OR: use sqlite3 directly:
sqlite3 /tmp/exchange_js_branch/dev.db \
  "UPDATE users SET firstLoginStatus='PENDING_IDENTITY_CONFIRM', mfaSecret=NULL, mfaEnabledAt=NULL WHERE email='sm@fiatx.com';"
```

- [ ] **Step 2: Login should return FIRST_LOGIN_REQUIRED**

```bash
curl -s -X POST http://localhost:3500/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sm@fiatx.com","password":"123456"}' | jq .
```

Expected: `{ "status": "FIRST_LOGIN_REQUIRED", "firstLoginToken": "eyJ..." }`.

- [ ] **Step 3: Walk through the first-login flow**

```bash
TOKEN="<paste firstLoginToken from step 2>"

# Get status
curl -s http://localhost:3500/auth/first-login/status \
  -H "Authorization: Bearer $TOKEN" | jq .
# Expected: { "currentStep": "PENDING_IDENTITY_CONFIRM" }

# Confirm identity
curl -s -X POST http://localhost:3500/auth/first-login/confirm-identity \
  -H "Authorization: Bearer $TOKEN" | jq .
# Expected: { "nextStep": "MFA_BINDING", "traceId": "..." }

# Init MFA binding
curl -s -X POST http://localhost:3500/auth/first-login/mfa/init \
  -H "Authorization: Bearer $TOKEN" | jq '{manualKey: .manualKey}'
# Expected: { "manualKey": "XXXX XXXX XXXX ..." } + qrDataUrl (long)
```

- [ ] **Step 4: Open Google Authenticator, add account manually using the manualKey, enter the 6-digit code**

```bash
TOTP_CODE="<6-digit code from Authenticator>"

# Verify MFA binding
curl -s -X POST http://localhost:3500/auth/first-login/mfa/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TOTP_CODE\"}" | jq .
# Expected: { "nextStep": "POLICY_ACK_PENDING" }

# Acknowledge policy
curl -s -X POST http://localhost:3500/auth/first-login/policy/acknowledge \
  -H "Authorization: Bearer $TOKEN" | jq '{accessToken: (.accessToken | split(".")[1])}'
# Expected: accessToken present
```

- [ ] **Step 5: Verify next login requires MFA**

```bash
curl -s -X POST http://localhost:3500/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sm@fiatx.com","password":"123456"}' | jq .
# Expected: { "status": "MFA_REQUIRED", "mfaSessionToken": "..." }
```

- [ ] **Step 6: Commit backend complete checkpoint**

```bash
git add .
git commit -m "test(first-login): backend E2E smoke tested — full first-login flow and MFA login verified"
```

---

## Task 12: Frontend — AdminFirstLoginPage

**Files:**
- Create: `admin-web/src/pages/AdminFirstLoginPage.tsx`

- [ ] **Step 1: Create the wizard page**

Create `admin-web/src/pages/AdminFirstLoginPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifyAdminAuthChanged } from '../contexts/AdminSessionContext';

const API = import.meta.env.VITE_API_URL;

function firstLoginFetch(path: string, method = 'GET', body?: object) {
  const token = sessionStorage.getItem('firstLoginToken');
  return fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// ── Step 1: Identity Confirm ──────────────────────────────────────────────────
function IdentityConfirmStep({
  onNext,
}: {
  onNext: () => void;
}) {
  const [identity, setIdentity] = useState<{ email: string; role: string; userNo: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    firstLoginFetch('/auth/first-login/me')
      .then((r) => r.json())
      .then((d) => setIdentity(d))
      .catch(() => setError('Failed to load identity. Please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  const handleStart = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await firstLoginFetch('/auth/first-login/confirm-identity', 'POST');
      if (!res.ok) throw new Error((await res.json()).message || 'Failed');
      onNext();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-adm-t2 text-center py-10">Loading…</div>;

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-16 h-16 rounded-full bg-adm-bg border-2 border-indigo-500 flex items-center justify-center text-3xl">👤</div>
      <div className="text-center">
        <div className="text-adm-t1 font-semibold text-lg">{identity?.email}</div>
        <div className="text-adm-t3 text-sm mt-1">{identity?.role} · {identity?.userNo}</div>
      </div>
      <div className="bg-adm-bg rounded-lg p-4 text-adm-t2 text-sm leading-relaxed w-full max-w-sm text-center">
        首次登录需完成 <span className="text-adm-t1 font-medium">MFA 绑定</span> 和{' '}
        <span className="text-adm-t1 font-medium">安全须知确认</span>，预计耗时 2 分钟。
      </div>
      {error && <div className="text-red-400 text-sm">{error}</div>}
      <button
        onClick={handleStart}
        disabled={submitting}
        className="w-full max-w-sm bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg disabled:opacity-50"
      >
        {submitting ? '请稍候…' : '开始设置 →'}
      </button>
    </div>
  );
}

// ── Step 2: MFA Binding ───────────────────────────────────────────────────────
function MfaBindingStep({ onNext }: { onNext: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  useEffect(() => {
    firstLoginFetch('/auth/first-login/mfa/init', 'POST')
      .then((r) => r.json())
      .then((d) => {
        setQrDataUrl(d.qrDataUrl);
        setManualKey(d.manualKey);
      })
      .catch(() => setError('Failed to initialize MFA. Please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await firstLoginFetch('/auth/first-login/mfa/verify', 'POST', { code });
      if (res.ok) {
        onNext();
      } else {
        const data = await res.json();
        if (data.attemptsRemaining !== undefined) setAttemptsRemaining(data.attemptsRemaining);
        throw new Error(data.message || 'Verification failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-adm-t2 text-center py-10">正在生成二维码…</div>;

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-adm-t2 text-sm text-center">用 Google Authenticator 扫描下方二维码</p>
      {qrDataUrl && (
        <img src={qrDataUrl} alt="TOTP QR Code" className="w-40 h-40 rounded-lg border-2 border-adm-border" />
      )}
      <div className="bg-adm-bg rounded-lg p-3 text-center w-full max-w-sm">
        <div className="text-adm-t3 text-xs mb-1">无法扫码？手动输入密钥</div>
        <div className="font-mono text-indigo-400 text-sm tracking-wider">{manualKey}</div>
      </div>
      <div className="w-full max-w-sm">
        <label className="text-adm-t3 text-xs mb-1.5 block">输入 App 生成的 6 位验证码</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="_ _ _ _ _ _"
          className="w-full bg-adm-bg border border-adm-border rounded-lg px-4 py-2.5 text-center text-adm-t1 text-xl font-mono tracking-[0.5em] focus:outline-none focus:border-indigo-500"
        />
      </div>
      {error && (
        <div className="text-red-400 text-sm text-center">
          {error}
          {attemptsRemaining !== null && <span className="ml-1">（还有 {attemptsRemaining} 次机会）</span>}
        </div>
      )}
      <button
        onClick={handleVerify}
        disabled={code.length !== 6 || submitting}
        className="w-full max-w-sm bg-violet-600 hover:bg-violet-500 text-white font-medium py-2.5 rounded-lg disabled:opacity-50"
      >
        {submitting ? '验证中…' : '验证绑定'}
      </button>
    </div>
  );
}

// ── Step 3: Policy Ack ────────────────────────────────────────────────────────
const SECURITY_RULES = [
  '每次登录必须通过 MFA 验证',
  '密码每 90 天必须更换一次',
  '禁止共享账号或 MFA 设备',
  '所有操作均被系统审计记录',
  '发现安全异常须立即上报 CISO',
];

function PolicyAckStep({ onNext }: { onNext: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleAcknowledge = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await firstLoginFetch('/auth/first-login/policy/acknowledge', 'POST');
      if (!res.ok) throw new Error((await res.json()).message || 'Failed');
      const data = await res.json();
      // Replace firstLoginToken with full access token
      sessionStorage.removeItem('firstLoginToken');
      localStorage.setItem('admin_token', data.accessToken);
      notifyAdminAuthChanged();
      onNext();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-adm-t1 font-semibold text-sm">平台安全规则</h3>
      <div className="flex flex-col gap-2">
        {SECURITY_RULES.map((rule) => (
          <div key={rule} className="bg-adm-bg border-l-2 border-amber-500 rounded-r-lg px-3 py-2 text-adm-t2 text-sm">
            {rule}
          </div>
        ))}
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 accent-amber-500 w-4 h-4 flex-shrink-0"
        />
        <span className="text-adm-t2 text-sm">我已阅读并同意遵守上述安全规则</span>
      </label>
      {error && <div className="text-red-400 text-sm">{error}</div>}
      <button
        onClick={handleAcknowledge}
        disabled={!agreed || submitting}
        className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium py-2.5 rounded-lg disabled:opacity-50"
      >
        {submitting ? '确认中…' : '确认并进入系统'}
      </button>
    </div>
  );
}

// ── Step 4: Completion ────────────────────────────────────────────────────────
function CompletionStep({ onEnterDashboard }: { onEnterDashboard: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-6">
      <div className="text-6xl">✅</div>
      <div className="text-center">
        <div className="text-green-400 font-semibold text-lg">设置完成</div>
        <div className="text-adm-t3 text-sm mt-2">MFA 已绑定 · 安全须知已确认</div>
      </div>
      <button
        onClick={onEnterDashboard}
        className="bg-green-600 hover:bg-green-500 text-white font-medium py-2.5 px-8 rounded-lg"
      >
        进入管理台 →
      </button>
    </div>
  );
}

// ── STEPS CONFIG ─────────────────────────────────────────────────────────────
const STEP_LABELS = ['身份确认', 'MFA 绑定', '安全须知', '完成'];
const STEP_COLORS = ['bg-indigo-500', 'bg-violet-500', 'bg-amber-500', 'bg-green-500'];

type StepKey = 'PENDING_IDENTITY_CONFIRM' | 'MFA_BINDING' | 'POLICY_ACK_PENDING' | 'DONE';

const STATUS_TO_STEP: Record<string, number> = {
  PENDING_IDENTITY_CONFIRM: 0,
  MFA_BINDING: 1,
  POLICY_ACK_PENDING: 2,
  COMPLETED: 2, // acknowledged policy → show PolicyAck
};

// ── PAGE ─────────────────────────────────────────────────────────────────────
export default function AdminFirstLoginPage() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [initError, setInitError] = useState('');

  useEffect(() => {
    document.documentElement.classList.add('dark');
    const token = sessionStorage.getItem('firstLoginToken');
    if (!token) {
      navigate('/admin/login');
      return;
    }
    // Recover step from backend
    firstLoginFetch('/auth/first-login/status')
      .then((r) => r.json())
      .then((d) => {
        const idx = STATUS_TO_STEP[d.currentStep] ?? 0;
        setStepIndex(idx);
      })
      .catch(() => setInitError('Failed to load session. Please log in again.'));
  }, [navigate]);

  if (initError) {
    return (
      <div className="min-h-screen bg-adm-panel flex items-center justify-center text-red-400">
        {initError}
      </div>
    );
  }

  if (stepIndex === null) {
    return <div className="min-h-screen bg-adm-panel flex items-center justify-center text-adm-t2">加载中…</div>;
  }

  return (
    <div className="min-h-screen bg-adm-panel flex items-center justify-center p-4">
      <div className="bg-adm-card border border-adm-border rounded-2xl w-full max-w-md p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="text-adm-t1 font-bold text-xl">首次登录设置</div>
          <div className="text-adm-t3 text-sm mt-1">Exchange Admin</div>
        </div>

        {/* Progress bar */}
        {!done && (
          <div className="flex gap-1.5">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex-1 flex flex-col gap-1 items-center">
                <div
                  className={`h-1 w-full rounded-full transition-all ${
                    i <= stepIndex ? STEP_COLORS[i] : 'bg-adm-border'
                  }`}
                />
                <span className={`text-xs ${i === stepIndex ? 'text-adm-t1' : 'text-adm-t3'}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Step content */}
        {!done && stepIndex === 0 && (
          <IdentityConfirmStep onNext={() => setStepIndex(1)} />
        )}
        {!done && stepIndex === 1 && (
          <MfaBindingStep onNext={() => setStepIndex(2)} />
        )}
        {!done && stepIndex === 2 && (
          <PolicyAckStep onNext={() => setDone(true)} />
        )}
        {done && (
          <CompletionStep onEnterDashboard={() => navigate('/dashboard')} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd Exchange_js/admin-web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/AdminFirstLoginPage.tsx
git commit -m "feat(frontend): add AdminFirstLoginPage wizard (4-step first login)"
```

---

## Task 13: Frontend — Modify AdminLogin.tsx + App.tsx

**Files:**
- Modify: `admin-web/src/pages/AdminLogin.tsx`
- Modify: `admin-web/src/App.tsx`

- [ ] **Step 1: Handle FIRST_LOGIN_REQUIRED and MFA_REQUIRED in doLogin**

Open `admin-web/src/pages/AdminLogin.tsx`. Find the `doLogin` function. Replace the success block (`if (response.ok)`) with:

```tsx
      if (response.ok) {
        const data = await response.json();

        // First-login gate
        if (data.status === 'FIRST_LOGIN_REQUIRED') {
          sessionStorage.setItem('firstLoginToken', data.firstLoginToken);
          navigate('/admin/first-login');
          return;
        }

        // MFA gate
        if (data.status === 'MFA_REQUIRED') {
          sessionStorage.setItem('mfaSessionToken', data.mfaSessionToken);
          setShowMfaInput(true);
          return;
        }

        // Normal token
        const payload = decodeTokenPayload(data.access_token);
        if (!payload || payload.type !== 'ADMIN') {
          localStorage.removeItem('admin_token');
          notifyAdminAuthChanged();
          setError('Invalid admin token. Please contact support.');
          return;
        }
        localStorage.setItem('admin_token', data.access_token);
        notifyAdminAuthChanged();
        navigate('/dashboard');
      } else {
        const err = await response.json();
        setError(err.message || 'Login failed');
      }
```

- [ ] **Step 2: Add MFA input state and UI**

At the top of the `AdminLogin` component, add:

```tsx
const [showMfaInput, setShowMfaInput] = useState(false);
const [mfaCode, setMfaCode] = useState('');
const [mfaSubmitting, setMfaSubmitting] = useState(false);
```

Add a `handleMfaVerify` function after `handleQuickLogin`:

```tsx
  const handleMfaVerify = async () => {
    if (mfaCode.length !== 6) return;
    setMfaSubmitting(true);
    setError('');
    try {
      const token = sessionStorage.getItem('mfaSessionToken');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/mfa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: mfaCode }),
      });
      if (response.ok) {
        const data = await response.json();
        sessionStorage.removeItem('mfaSessionToken');
        localStorage.setItem('admin_token', data.accessToken);
        notifyAdminAuthChanged();
        navigate('/dashboard');
      } else {
        const err = await response.json();
        setError(err.message || 'MFA verification failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setMfaSubmitting(false);
    }
  };
```

In the JSX return, after the existing form closing tag, add the MFA overlay (conditionally rendered when `showMfaInput`):

```tsx
      {showMfaInput && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-80 flex flex-col gap-5">
            <div className="text-center">
              <div className="text-white font-semibold text-lg">双因素验证</div>
              <div className="text-slate-400 text-sm mt-1">请输入 Authenticator App 的 6 位验证码</div>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6 位验证码"
              className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-center text-xl font-mono tracking-[0.5em] focus:outline-none focus:border-indigo-500 w-full"
              autoFocus
            />
            {error && <div className="text-red-400 text-sm text-center">{error}</div>}
            <button
              onClick={handleMfaVerify}
              disabled={mfaCode.length !== 6 || mfaSubmitting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg disabled:opacity-50"
            >
              {mfaSubmitting ? '验证中…' : '验证'}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Add route in App.tsx**

Open `admin-web/src/App.tsx`. Find where other admin routes are registered. Add before the catch-all or existing login route:

```tsx
import AdminFirstLoginPage from './pages/AdminFirstLoginPage';
// ...
<Route path="/admin/first-login" element={<AdminFirstLoginPage />} />
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd Exchange_js/admin-web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/AdminLogin.tsx \
        admin-web/src/App.tsx
git commit -m "feat(frontend): handle FIRST_LOGIN_REQUIRED and MFA_REQUIRED in AdminLogin; add /admin/first-login route"
```

---

## Task 14: Full E2E validation

- [ ] **Step 1: Start the full stack**

```bash
cd Exchange_js
npm run dev:start
```

- [ ] **Step 2: Open admin portal and test first-login flow**

1. Open `http://localhost:3501/admin/login`
2. Log in with `sm@fiatx.com / 123456` (after resetting its status to `PENDING_IDENTITY_CONFIRM` via sqlite3)
3. Verify redirect to `/admin/first-login`
4. Step 1: Welcome screen shows name/role/email, click "开始设置"
5. Step 2: QR code appears, scan with Google Authenticator, enter 6-digit code, click "验证绑定"
6. Step 3: Security rules appear, check checkbox, click "确认并进入系统"
7. Step 4: Success screen, click "进入管理台", verify redirect to dashboard
8. Log out, log in again — verify MFA prompt appears
9. Enter TOTP code, verify access to dashboard

- [ ] **Step 3: Test error paths**

```bash
# Wrong TOTP code (repeat 5 times to trigger lock)
# Verify 429 response with retryAfterSeconds
# Verify "还有 N 次机会" message in UI
```

- [ ] **Step 4: Verify audit logs**

```bash
curl -s "http://localhost:3500/admin/audit-logs?workflowType=ADMIN_FIRST_LOGIN" \
  -H "Authorization: Bearer <admin_token>" | jq '[.items[].action]'
```

Expected actions in order: `FIRST_LOGIN_IDENTITY_CONFIRMED`, `FIRST_LOGIN_MFA_BINDING_INITIATED`, `FIRST_LOGIN_MFA_BINDING_COMPLETED`, `FIRST_LOGIN_POLICY_ACKNOWLEDGED`, `FIRST_LOGIN_COMPLETED`.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(v1): Admin First Login workflow complete — TOTP MFA binding, policy ack, audit coverage"
```

---

## Checklist — Spec Coverage

| Spec requirement | Task |
|---|---|
| firstLoginToken restricted JWT (scope: first_login) | Tasks 6, 8 |
| 4-step state machine with firstLoginStatus | Tasks 1, 4 |
| TOTP MFA binding via otplib | Task 5 |
| QR code data URL (server-side, qrcode lib) | Task 5 |
| AES-256-GCM secret encryption | Task 3 |
| 5-fail lock for 15 minutes | Tasks 4, 5 |
| Page refresh recovery via /first-login/status | Tasks 7, 12 |
| Full audit log coverage (6 actions) | Tasks 2, 5 |
| Normal login MFA gate (mfaSessionToken) | Tasks 5, 7, 8, 13 |
| AdminPermissionGuard blocks first_login scope | Task 6 |
| Seed accounts bypass first-login | Task 10 |
| Frontend 4-step wizard | Task 12 |
| Frontend MFA overlay on login page | Task 13 |
