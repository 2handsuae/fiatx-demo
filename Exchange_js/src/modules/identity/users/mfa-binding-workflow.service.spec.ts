import { ForbiddenException } from '@nestjs/common';
import {
  MfaBindingWorkflowService,
  TooManyRequestsException,
} from './mfa-binding-workflow.service';

describe('MfaBindingWorkflowService', () => {
  let service: MfaBindingWorkflowService;
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
      clearMfaVerifyFail: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('full-access-token'),
    };
    service = new MfaBindingWorkflowService(usersDomainService, auditLogsService, jwtService);
  });

  describe('confirmIdentity', () => {
    it('throws ForbiddenException when status is COMPLETED', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue({ ...baseState, firstLoginStatus: 'COMPLETED' });
      await expect(service.confirmIdentity('u1')).rejects.toThrow(ForbiddenException);
    });

    it('transitions to MFA_BINDING and writes audit log', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue(baseState);
      await service.confirmIdentity('u1');
      expect(usersDomainService.setFirstLoginStatus).toHaveBeenCalledWith(
        'u1',
        'MFA_BINDING',
        undefined,
        expect.any(String),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalled();
    });
  });

  describe('第一批 · 首次登录 4 码', () => {
    it('confirmIdentity 写 ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED：START，correlationId 与 setFirstLoginStatus 写回同一个 traceId，带 authnMethod/fromStatus/toStatus', async () => {
      usersDomainService.findFirstLoginState.mockResolvedValue(baseState);

      const { traceId } = await service.confirmIdentity('u1');

      expect(usersDomainService.setFirstLoginStatus).toHaveBeenCalledWith(
        'u1',
        'MFA_BINDING',
        undefined,
        traceId,
      );

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED',
      );
      expect(call).toBeDefined();
      expect(call[0].actionDomain).toBe('IAM');
      expect(call[0].correlationId).toBe(traceId);
      expect(call[0].authnMethod).toBe('PASSWORD');
      expect(call[0].fromStatus).toBe('PENDING_IDENTITY_CONFIRM');
      expect(call[0].toStatus).toBe('MFA_BINDING');
      // authnMethod 同时落到 actor 快照（第二个参数），不是只满足 DTO 校验就完事。
      expect(call[1].authnMethod).toBe('PASSWORD');
    });

    // ADMIN_FIRST_LOGIN_MFA_INITIATED / ADMIN_FIRST_LOGIN_MFA_BOUND / ADMIN_FIRST_LOGIN_COMPLETED
    // 三码的写入点都在 getOtp() 之后（initMfaBind 全程、verifyMfaBind 过完早退守卫之后）。
    // getOtp() 用 `new Function('s','return import(s)')` 真·动态 import 纯 ESM 的 otplib——
    // 这是刻意设计（otplib v13 全 ESM，其依赖链 require() 会直接抛 ERR_REQUIRE_ESM，见文件顶部
    // 注释），但代价是在本项目 jest 配置（testEnvironment:'node'，未开
    // --experimental-vm-modules）下，任何真正跑到这一行的用例都会抛
    // "TypeError: A dynamic import callback was invoked without --experimental-vm-modules"——
    // 已在本任务实测复现（含现有两条 verifyMfaBind 用例都刻意只测 getOtp() 之前的守卫分支，
    // 同样绕不过这堵墙）。三码的写入逻辑已按同一模板人工复核（见
    // mfa-binding-workflow.service.ts 内对应注释），但本文件测不出来——如实记 todo，
    // 不假装用一个测不到真实分支的用例把它们盖住。
    it.todo('ADMIN_FIRST_LOGIN_MFA_INITIATED — 阻于 getOtp() 动态 import，本 jest 配置下不可测（见上方注释）');
    it.todo('ADMIN_FIRST_LOGIN_MFA_BOUND（SUCCESS/FAILED 两种 outcome）— 阻于 getOtp()，不可测');
    it.todo('ADMIN_FIRST_LOGIN_COMPLETED — 阻于 getOtp()，不可测');
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
      usersDomainService.findFirstLoginState.mockResolvedValue({ ...baseState, firstLoginStatus: 'COMPLETED' });
      await expect(service.verifyMfaBind('u1', '123456')).rejects.toThrow(ForbiddenException);
    });
  });
});
