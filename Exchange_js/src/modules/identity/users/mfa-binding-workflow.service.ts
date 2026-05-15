import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { decryptMfaSecret, encryptMfaSecret } from '../../../common/utils/mfa-crypto.util';

// otplib v13 uses a functional API (no authenticator object); it is ESM-only.
// Dynamic import() resolves the ESM-under-CJS restriction at runtime.
// otplib v13 uses a functional API and is ESM-only.
// Dynamic import() resolves the ESM-under-CJS restriction at runtime.
// verifySync is used for synchronous TOTP code validation.
interface OtplibFunctions {
  generateSecret: () => string;
  generateURI: (opts: { secret: string; label: string; issuer: string }) => string;
  verifySync: (opts: { token: string; secret: string; window?: number }) => { valid: boolean };
}
let _otpFns: OtplibFunctions | null = null;
// Use new Function to prevent TypeScript (module:commonjs) from rewriting
// import() to require(). otplib v13 is ESM-only; require() of its CJS shim
// fails because @scure/base is a pure-ESM transitive dep. Native import()
// uses the "import" export condition and avoids that path.
const _dynamicImport = new Function('s', 'return import(s)');
async function getOtp(): Promise<OtplibFunctions> {
  if (!_otpFns) {
    const m = await _dynamicImport('otplib') as any;
    _otpFns = {
      generateSecret: m.generateSecret,
      generateURI: m.generateURI,
      verifySync: m.verifySync,
    };
  }
  return _otpFns as OtplibFunctions;
}
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { UsersDomainService } from './users.domain.service';

const MFA_ISSUER = process.env.MFA_ISSUER || 'Exchange Admin';

/**
 * Local TooManyRequestsException — @nestjs/common does not ship one.
 */
export class TooManyRequestsException extends HttpException {
  constructor(response: string | Record<string, any> = 'Too Many Requests') {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface MfaBindingUserState {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  firstLoginStatus: string;
  firstLoginTraceId: string | null;
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
  mfaVerifyFailCount: number;
  mfaVerifyLockedUntil: Date | null;
}

@Injectable()
export class MfaBindingWorkflowService {
  constructor(
    private readonly usersDomainService: UsersDomainService,
    private readonly auditLogsService: AuditLogsService,
    private readonly jwtService: JwtService,
  ) {}

  private async loadUser(userId: string): Promise<MfaBindingUserState> {
    const user = await this.usersDomainService.findFirstLoginState(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private buildActor(user: MfaBindingUserState) {
    return {
      actorType: 'ADMIN',
      actorId: user.id,
      actorNo: user.userNo,
      actorRole: user.role,
    };
  }

  private retryAfterSeconds(lockedUntil: Date | null | undefined): number {
    if (!lockedUntil) return 0;
    return Math.max(0, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  }

  async getStatus(userId: string): Promise<{ currentStep: string }> {
    const user = await this.loadUser(userId);
    return { currentStep: user.firstLoginStatus };
  }

  async getIdentityPreview(userId: string): Promise<{
    userNo: string;
    email: string;
    role: string;
    currentStep: string;
  }> {
    const user = await this.loadUser(userId);
    return {
      userNo: user.userNo,
      email: user.email,
      role: user.role,
      currentStep: user.firstLoginStatus,
    };
  }

  async confirmIdentity(userId: string): Promise<{ nextStep: string; traceId: string }> {
    const user = await this.loadUser(userId);
    // Idempotent: if already at MFA_BINDING (e.g. page crash mid-flow), let them continue
    if (user.firstLoginStatus === 'MFA_BINDING') {
      return { nextStep: 'MFA_BINDING', traceId: user.firstLoginTraceId || randomUUID() };
    }
    if (user.firstLoginStatus !== 'PENDING_IDENTITY_CONFIRM') {
      throw new ForbiddenException(
        `Cannot confirm identity in status: ${user.firstLoginStatus}`,
      );
    }

    const traceId = randomUUID();
    await this.usersDomainService.setFirstLoginStatus(userId, 'MFA_BINDING', undefined, traceId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.IDENTITY_CONFIRMED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        requestId: traceId,
        result: AuditResult.SUCCESS,
        metadata: { fromStatus: 'PENDING_IDENTITY_CONFIRM', toStatus: 'MFA_BINDING' },
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user),
    );

    return { nextStep: 'MFA_BINDING', traceId };
  }

  async initMfaBind(userId: string): Promise<{
    qrDataUrl: string;
    manualKey: string;
    otpauthUri: string;
  }> {
    const user = await this.loadUser(userId);
    if (user.firstLoginStatus !== 'MFA_BINDING') {
      throw new ForbiddenException(
        `Cannot init MFA binding in status: ${user.firstLoginStatus}`,
      );
    }

    const otp = await getOtp();
    const secret = otp.generateSecret();
    const otpauthUri = otp.generateURI({ secret, label: user.email, issuer: MFA_ISSUER });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);

    const encryptedSecret = encryptMfaSecret(secret);
    const traceId = user.firstLoginTraceId || randomUUID();
    await this.usersDomainService.storeMfaSecret(userId, encryptedSecret, traceId, undefined);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_BINDING_INITIATED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId,
        requestId: traceId,
        result: AuditResult.SUCCESS,
        metadata: { issuer: MFA_ISSUER },
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user),
    );

    return {
      qrDataUrl,
      manualKey: secret.replace(/(.{4})/g, '$1 ').trim(),
      otpauthUri,
    };
  }

  /**
   * Verify a TOTP code against the user's MFA secret.
   * Reusable across flows: first-login MFA bind, MFA login, password reset.
   * Handles fail count + lockout. Does NOT complete binding or generate tokens.
   */
  async verifyMfaCode(userId: string, code: string): Promise<void> {
    const user = await this.loadUser(userId);
    if (!user.mfaSecret) {
      throw new ForbiddenException('MFA not bound');
    }

    if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil > new Date()) {
      throw new TooManyRequestsException({
        message: 'MFA verification temporarily locked',
        retryAfterSeconds: this.retryAfterSeconds(user.mfaVerifyLockedUntil),
      });
    }

    const secret = decryptMfaSecret(user.mfaSecret);
    const otp = await getOtp();
    const verifyResult = otp.verifySync({ token: code, secret, window: 1 });
    const isValid = verifyResult.valid;

    if (!isValid) {
      const { newCount, locked } = await this.usersDomainService.incrementMfaVerifyFail(userId);

      if (locked) {
        throw new TooManyRequestsException({
          message: 'MFA verification locked due to too many failed attempts',
          retryAfterSeconds: 15 * 60,
        });
      }

      throw new ForbiddenException({
        message: 'Invalid MFA code',
        attemptsRemaining: Math.max(0, 5 - newCount),
      });
    }

    await this.usersDomainService.clearMfaVerifyFail(userId);
  }

  async verifyMfaBind(userId: string, code: string): Promise<{ accessToken: string }> {
    const user = await this.loadUser(userId);
    if (user.firstLoginStatus !== 'MFA_BINDING') {
      throw new ForbiddenException(
        `Cannot verify MFA in status: ${user.firstLoginStatus}`,
      );
    }
    if (!user.mfaSecret) {
      throw new ForbiddenException('MFA secret not initialized');
    }

    if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil > new Date()) {
      throw new TooManyRequestsException({
        message: 'MFA verification temporarily locked',
        retryAfterSeconds: this.retryAfterSeconds(user.mfaVerifyLockedUntil),
      });
    }

    const secret = decryptMfaSecret(user.mfaSecret);
    const otp = await getOtp();
    const verifyResult = otp.verifySync({ token: code, secret, window: 1 });
    const isValid = verifyResult.valid;

    if (!isValid) {
      const { newCount, locked } = await this.usersDomainService.incrementMfaVerifyFail(userId);

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_VERIFY_FAILED,
          entityType: AuditEntityTypes.ADMIN_USER,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_FIRST_LOGIN,
          traceId: user.firstLoginTraceId || undefined,
          requestId: user.firstLoginTraceId || randomUUID(),
          result: AuditResult.FAILED,
          metadata: { failCount: newCount, locked },
          sourcePlatform: 'ADMIN_API',
        },
        this.buildActor(user),
      );

      if (locked) {
        await this.auditLogsService.recordByActor(
          {
            action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_VERIFY_LOCKED,
            entityType: AuditEntityTypes.ADMIN_USER,
            entityId: user.id,
            entityNo: user.userNo,
            workflowType: AuditBusinessWorkflowTypes.ADMIN_FIRST_LOGIN,
            traceId: user.firstLoginTraceId || undefined,
            requestId: user.firstLoginTraceId || randomUUID(),
            result: AuditResult.FAILED,
            metadata: { failCount: newCount, lockoutMinutes: 15 },
            sourcePlatform: 'ADMIN_API',
          },
          this.buildActor(user),
        );

        throw new TooManyRequestsException({
          message: 'MFA verification locked due to too many failed attempts',
          retryAfterSeconds: 15 * 60,
        });
      }

      throw new ForbiddenException({
        message: 'Invalid MFA code',
        attemptsRemaining: Math.max(0, 5 - newCount),
      });
    }

    await this.usersDomainService.completeMfaBinding(userId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_BINDING_COMPLETED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId: user.firstLoginTraceId || undefined,
        requestId: user.firstLoginTraceId || randomUUID(),
        result: AuditResult.SUCCESS,
        metadata: { fromStatus: 'MFA_BINDING', toStatus: 'COMPLETED' },
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user),
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.FIRST_LOGIN_COMPLETED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_FIRST_LOGIN,
        traceId: user.firstLoginTraceId || undefined,
        requestId: user.firstLoginTraceId || randomUUID(),
        result: AuditResult.SUCCESS,
        metadata: { userNo: user.userNo, role: user.role },
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user),
    );

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

  async verifyMfaLogin(
    userId: string,
    code: string,
    roleCodes: string[],
    role: string,
    email: string,
    userNo: string,
    loginTraceId?: string,
    ctx: { requestId?: string; sourceIp?: string } = {},
  ): Promise<{ accessToken: string }> {
    const user = await this.loadUser(userId);

    // Status gate: reject SUSPENDED and LOCKED users
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account has been suspended');
    }
    if (user.status === 'LOCKED') {
      throw new ForbiddenException('Account is locked');
    }

    if (!user.mfaSecret) {
      throw new ForbiddenException('MFA not bound');
    }

    if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil > new Date()) {
      throw new TooManyRequestsException({
        message: 'MFA verification temporarily locked',
        retryAfterSeconds: this.retryAfterSeconds(user.mfaVerifyLockedUntil),
      });
    }

    const secret = decryptMfaSecret(user.mfaSecret);
    const otp = await getOtp();
    const verifyResult = otp.verifySync({ token: code, secret, window: 1 });
    const isValid = verifyResult.valid;

    if (!isValid) {
      const { newCount, locked } = await this.usersDomainService.incrementMfaVerifyFail(userId);

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_LOGIN_VERIFY_FAILED,
          entityType: AuditEntityTypes.ADMIN_USER,
          entityId: user.id,
          entityNo: user.userNo,
          traceId: loginTraceId,
          workflowType: loginTraceId ? AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS : undefined,
          result: AuditResult.FAILED,
          metadata: { failCount: newCount, locked },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: 'ADMIN_API',
        },
        this.buildActor(user),
      );

      if (locked) {
        throw new TooManyRequestsException({
          message: 'MFA verification locked due to too many failed attempts',
          retryAfterSeconds: 15 * 60,
        });
      }

      throw new ForbiddenException({
        message: 'Invalid MFA code',
        attemptsRemaining: Math.max(0, 5 - newCount),
      });
    }

    await this.usersDomainService.clearMfaVerifyFail(userId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_FIRST_LOGIN.MFA_LOGIN_VERIFIED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: user.id,
        entityNo: user.userNo,
        traceId: loginTraceId,
        workflowType: loginTraceId ? AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS : undefined,
        result: AuditResult.SUCCESS,
        metadata: { userNo },
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user),
    );

    const accessToken = this.jwtService.sign({
      username: email,
      sub: user.id,
      userNo,
      role,
      roleCodes,
      type: 'ADMIN',
    });

    return { accessToken };
  }
}
