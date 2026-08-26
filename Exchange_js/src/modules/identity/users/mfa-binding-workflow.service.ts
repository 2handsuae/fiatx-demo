import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
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

/**
 * DOMAIN_EVENTS.ADMIN_LOGIN_CONSECUTIVE_FAILURE 的 payload 形状——
 * auth.service.ts#validateUser 判定"连续失败达阈值"后 emit，本文件接住写审计。
 */
export interface AdminLoginConsecutiveFailureEvent {
  userId: string;
  userNo: string;
  failedLoginAttempts: number;
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

    // ADMIN_ACCOUNT_LOCK_RELEASED：15 分钟封锁到期后的第一次尝试，惰性发现并解封——
    // 镜像 auth.service.ts 里另一套锁定机制（lockedUntil）已有的"下次登录时自动解锁"
    // 写法（那套是 Task 9 的活，见该文件 TODO；这套 mfaVerifyLockedUntil 是本任务的活）。
    // 顺带清零 mfaVerifyFailCount，否则"已解封"这条记录本身会说谎——不清零的话下一次
    // 答错就会带着陈旧计数立即再次触发锁定，而不是真的重新给满 5 次机会。
    if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil <= new Date()) {
      await this.usersDomainService.clearMfaVerifyFail(userId);
      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_ACCOUNT_LOCK_RELEASED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ADMIN_USER,
          primarySubjectNo: user.userNo,
          // INHERIT：User 表没有为"账号锁定"单独开一列 correlationId/traceId——借用
          // 同一次首登旅程的 firstLoginTraceId 承载（该值在 firstLoginStatus==='MFA_BINDING'
          // 时必非空，见 confirmIdentity）。注意这不是 APPLIED 铸造的那个值本身：APPLIED
          // 按 START 语义现铸一个新 UUID（见下方），两条记录不共享字面相同的 correlationId，
          // 但都挂在同一个 primarySubjectNo 下，靠它仍可查出该账号完整的封锁/解封历史。
          correlationId: user.firstLoginTraceId || undefined,
          fromStatus: 'LOCKED',
          toStatus: 'ACTIVE',
          reason: 'MFA verify lockout expired',
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        this.buildActor(user),
      ).catch(() => undefined);
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
        // 连续失败触发锁定改变了访问能力，是另一件事——单独写一条 ADMIN_ACCOUNT_LOCK_APPLIED。
        // 本次失败尝试本身已由上面那条 MFA_BOUND(FAILED) 记录，这条只记"锁定被施加"这件事。
        // START：这次封锁是独立事件的起点，现铸新 UUID（不复用 firstLoginTraceId——
        // 那条线是首登旅程本身的，被锁定不等于首登旅程结束，两者语义不同一件事）。
        // .catch() 兜底：审计侧问题不能盖过即将抛出的 429，锁定本身必须照常生效。
        await this.auditLogsService.recordByActor(
          {
            action: 'ADMIN_ACCOUNT_LOCK_APPLIED',
            actionDomain: 'IAM',
            category: AuditCategory.GOVERNANCE,
            primarySubjectType: AuditEntityTypes.ADMIN_USER,
            primarySubjectNo: user.userNo,
            correlationId: randomUUID(),
            reasonCode: 'MFA_VERIFY_LOCKOUT',
            fromStatus: 'ACTIVE',
            toStatus: 'LOCKED',
            metadata: { failCount: newCount },
            requestId: randomUUID(),
            sourcePlatform: 'ADMIN_API',
          },
          this.buildActor(user, 'TOTP'),
        ).catch(() => undefined);

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

  /**
   * ADMIN_ACCOUNT_LOCK_APPLIED —— 常规密码登录连续失败达阈值锁定（区别于本文件其余
   * 方法处理的 MFA 校验锁定）。触发判定留在 auth.service.ts#validateUser（域服务层，
   * 只有它知道"这次是第几次失败"）；audit 写入上收到这里（编排层）——Task 9。
   *
   * recordSystem 而非 recordByActor：这是异步事件消费（@OnEvent），已经脱离了触发
   * 那次 HTTP 请求的 actor 上下文，锁定本质是系统对失败模式的自动反应，同 CRON 定期
   * 任务一样按 SYSTEM 记。
   *
   * correlationId 走 START（ADMIN_ACCOUNT_LOCK_APPLIED 声明 correlationMode=S）：
   * 现铸新 UUID——同 verifyMfaBind() 里 MFA 锁定那处一致的模板（Task 7）。
   */
  @OnEvent(DomainEventNames.ADMIN_LOGIN_CONSECUTIVE_FAILURE, { async: true })
  async handleConsecutiveAuthFailure(
    event: AdminLoginConsecutiveFailureEvent,
  ): Promise<void> {
    await this.auditLogsService
      .recordSystem({
        action: 'ADMIN_ACCOUNT_LOCK_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: event.userNo,
        correlationId: randomUUID(),
        reasonCode: 'CONSECUTIVE_AUTH_FAILURE',
        fromStatus: 'ACTIVE',
        toStatus: 'LOCKED',
        metadata: { failedLoginAttempts: event.failedLoginAttempts },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_AUTH_API',
      })
      // 审计侧问题不能拖累锁定本身已经生效这件事——同文件里其余系统写入点一致的兜底。
      .catch(() => undefined);
  }
}
