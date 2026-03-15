import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChangeTicketsController } from './change-tickets.controller';
import { ChangeTicketsService } from './change-tickets.service';
import { ReleaseGatesService } from './release-gates.service';

describe('ChangeTicketsController', () => {
  let controller: ChangeTicketsController;
  const changeTicketsService = {
    create: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    submit: jest.fn(),
    resubmit: jest.fn(),
    close: jest.fn(),
  };
  const releaseGatesService = {
    listGateRuns: jest.fn(),
    runGateCheck: jest.fn(),
    markDeployStatus: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'tech-admin-1',
      userNo: 'ADM-001',
      role: 'TECH_ADMIN',
      roleCodes: ['TECH_ADMIN'],
    },
  };
  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChangeTicketsController],
      providers: [
        { provide: ChangeTicketsService, useValue: changeTicketsService },
        { provide: ReleaseGatesService, useValue: releaseGatesService },
      ],
    }).compile();

    controller = module.get<ChangeTicketsController>(ChangeTicketsController);
    jest.clearAllMocks();
  });

  it('delegates gate check with admin actor context', async () => {
    releaseGatesService.runGateCheck.mockResolvedValue({ id: 'run-1', status: 'PASSED' });

    await controller.gateCheck(
      adminReq,
      'ticket-1',
      {
        targetEnv: 'UAT',
        releaseVersion: 'v1.0.0',
        reason: 'preflight',
      } as any,
    );

    expect(releaseGatesService.runGateCheck).toHaveBeenCalledWith(
      'ticket-1',
      {
        targetEnv: 'UAT',
        releaseVersion: 'v1.0.0',
        reason: 'preflight',
      },
      {
        actorType: 'ADMIN',
        userId: 'tech-admin-1',
        userNo: 'ADM-001',
        role: 'TECH_ADMIN',
        roleCodes: ['TECH_ADMIN'],
      },
    );
  });

  it('rejects non-admin change ticket access', () => {
    expect(() => controller.list(customerReq, {} as any)).toThrow(ForbiddenException);
  });
});
