import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';

describe('WithdrawTransactionsController', () => {
  let controller: WithdrawTransactionsController;
  let withdrawService: { setSlaDeadlineByNo: jest.Mock };
  let workflowService: Record<string, jest.Mock>;

  beforeEach(async () => {
    withdrawService = {
      setSlaDeadlineByNo: jest.fn(),
    };
    workflowService = {
      onBounce: jest.fn(),
      initiateUnfreeze: jest.fn(),
      initiateRefund: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WithdrawTransactionsController],
      providers: [
        { provide: WithdrawTransactionsService, useValue: withdrawService },
        { provide: WithdrawWorkflowService, useValue: workflowService },
      ],
    }).compile();

    controller = module.get<WithdrawTransactionsController>(
      WithdrawTransactionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('simulateSlaTimeout rejects a CUSTOMER token with ForbiddenException (no self-service SLA reset)', () => {
    expect(() =>
      controller.simulateSlaTimeout({ user: { type: 'CUSTOMER', userId: 'c1' } }, 'WDR0001'),
    ).toThrow(ForbiddenException);
    expect(withdrawService.setSlaDeadlineByNo).not.toHaveBeenCalled();
  });

  it('simulateSlaTimeout forwards the withdrawNo + a past Date + the admin actor to the service', async () => {
    withdrawService.setSlaDeadlineByNo.mockResolvedValue({});
    const mockReq = { user: { type: 'ADMIN', userId: 'admin-1', role: 'OPERATOR' } };

    await controller.simulateSlaTimeout(mockReq, 'WDR0001');

    expect(withdrawService.setSlaDeadlineByNo).toHaveBeenCalledWith(
      'WDR0001',
      expect.any(Date),
      expect.objectContaining({ actorId: 'admin-1', actorRole: 'OPERATOR' }),
    );
    const passed = withdrawService.setSlaDeadlineByNo.mock.calls[0][1];
    expect(passed.getTime()).toBeLessThan(Date.now());
  });
});
