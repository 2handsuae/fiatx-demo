import { ForbiddenException } from '@nestjs/common';
import {
  FirstLoginWorkflowService,
  TooManyRequestsException,
} from './first-login-workflow.service';

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
      clearMfaVerifyFail: jest.fn().mockResolvedValue(undefined),
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
      expect(auditLogsService.recordByActor).toHaveBeenCalled();
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

    it('completes first login and returns accessToken', async () => {
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
