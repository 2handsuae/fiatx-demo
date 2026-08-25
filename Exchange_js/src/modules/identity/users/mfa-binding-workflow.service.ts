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
import { AuditCategory, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
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

  private buildActor(user: MfaBindingUserState, authnMethod?: string) {
    return {
      actorType: 'ADMIN',
      actorNo: user.userNo,
      actorDisplayName: user.userNo,
      actorRolesAtTime: [user.role],
      // 落库到 actor 快照那份 authnMethod；DTO 上还要单独传一份给 assertActionSpec
      // 校验必填（见 audit-log.dto.ts 里 authnMethod 字段的注释）。
      ...(authnMethod ? { authnMethod } : {}),
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

    // START：该行政员这次首登旅程的 correlationId。firstLoginTraceId 是 User 表上现成的
    // 承载列（专为首登流程起的名字），同一次 update 里跟状态一起写回，供后续三步 INHERIT 读回。
    const correlationId = randomUUID();
    await this.usersDomainService.setFirstLoginStatus(userId, 'MFA_BINDING', undefined, correlationId);

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        correlationId,
        // 这步是"确认身份"本身：走到这里之前已经用密码登录过一次拿到了 mfa-binding
        // 专用的临时令牌（MfaBindingGuard 把关），本步没有独立再认证一次，如实记 PASSWORD。
        authnMethod: 'PASSWORD',
        outcome: AuditOutcome.SUCCESS,
        fromStatus: 'PENDING_IDENTITY_CONFIRM',
        toStatus: 'MFA_BINDING',
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user, 'PASSWORD'),
    );

    return { nextStep: 'MFA_BINDING', traceId: correlationId };
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
    // storeMfaSecret 的 traceId 入参是既有业务落库行为（写回同一列，幂等），保留原有兜底；
    // 但审计 correlationId 严格 INHERIT 读 user.firstLoginTraceId 本身，不做 ?? randomUUID()
    // 兜底——confirmIdentity 早已把它和 MFA_BINDING 状态一起写回，这里读不到就是真的有问题。
    const traceId = user.firstLoginTraceId || randomUUID();
    await this.usersDomainService.storeMfaSecret(userId, encryptedSecret, traceId, undefined);

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_FIRST_LOGIN_MFA_INITIATED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        correlationId: user.firstLoginTraceId || undefined,
        outcome: AuditOutcome.SUCCESS,
        metadata: { issuer: MFA_ISSUER },
        // 每次调用独立 nonce——这一步允许重复触发（例如用户刷新二维码页面重新生成密钥），
        // 若沿用固定的 correlationId 系 requestId，幂等键会撞车、第二次调用被静默吞掉。
        requestId: randomUUID(),
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

      // 同一个动作码 ADMIN_FIRST_LOGIN_MFA_BOUND，失败与成功只靠 outcome 区分——
      // 退役码 FIRST_LOGIN_MFA_VERIFY_FAILED 收编到这里，不再另起一个 _FAILED 后缀码。
      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_FIRST_LOGIN_MFA_BOUND',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ADMIN_USER,
          primarySubjectNo: user.userNo,
          correlationId: user.firstLoginTraceId || undefined,
          authnMethod: 'TOTP',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'INVALID_CODE',
          metadata: { failCount: newCount, locked },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        this.buildActor(user, 'TOTP'),
      );

      if (locked) {
        // TODO(Task 7): 连续失败触发锁定改变了访问能力，是另一件事——应另写一条
        // ADMIN_ACCOUNT_LOCK_APPLIED（domain: IAM, correlationMode: START,
        // requiredFields: reasonCode/fromStatus/toStatus，声明已在 V1_AUDIT_ACTIONS 里）。
        // 退役码 FIRST_LOGIN_MFA_VERIFY_LOCKED 的写入点原样删除，不在本任务实装新码，
        // 只留这条注释指向 Task 7；本次失败尝试本身已由上面那条 MFA_BOUND(FAILED) 记录。
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
        action: 'ADMIN_FIRST_LOGIN_MFA_BOUND',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        correlationId: user.firstLoginTraceId || undefined,
        authnMethod: 'TOTP',
        outcome: AuditOutcome.SUCCESS,
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user, 'TOTP'),
    );

    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_FIRST_LOGIN_COMPLETED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        correlationId: user.firstLoginTraceId || undefined,
        outcome: AuditOutcome.SUCCESS,
        fromStatus: 'MFA_BINDING',
        toStatus: 'COMPLETED',
        metadata: { userNo: user.userNo, role: user.role },
        requestId: randomUUID(),
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
          primarySubjectType: AuditEntityTypes.ADMIN_USER,
          primarySubjectNo: user.userNo,
          traceId: loginTraceId,
          outcome: AuditOutcome.FAILED,
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
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        traceId: loginTraceId,
        outcome: AuditOutcome.SUCCESS,
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
