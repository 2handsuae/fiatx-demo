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
