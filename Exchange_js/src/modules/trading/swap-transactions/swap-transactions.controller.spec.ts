import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';

describe('SwapTransactionsController', () => {
  let controller: SwapTransactionsController;
  let swapService: { setSlaDeadlineByNo: jest.Mock };

  beforeEach(async () => {
    swapService = {
      setSlaDeadlineByNo: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SwapTransactionsController],
      providers: [
        { provide: SwapTransactionsService, useValue: swapService },
        { provide: SwapQuoteService, useValue: {} },
        { provide: SwapWorkflowService, useValue: {} },
      ],
    }).compile();

    controller = module.get<SwapTransactionsController>(SwapTransactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('simulateSlaTimeout rejects a CUSTOMER token with ForbiddenException (no self-service SLA reset)', () => {
    expect(() =>
      controller.simulateSlaTimeout('SWP0001', { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(swapService.setSlaDeadlineByNo).not.toHaveBeenCalled();
  });

  it('simulateSlaTimeout forwards the swapNo + a past Date + the admin actor to the service', async () => {
    swapService.setSlaDeadlineByNo.mockResolvedValue({});
    const mockReq = { user: { type: 'ADMIN', userId: 'admin-1', userNo: 'ADM0001', role: 'OPERATOR' } };

    await controller.simulateSlaTimeout('SWP0001', mockReq);

    expect(swapService.setSlaDeadlineByNo).toHaveBeenCalledWith(
      'SWP0001',
      expect.any(Date),
      expect.objectContaining({ actorId: 'admin-1', actorRole: 'OPERATOR' }),
    );
    const passed = swapService.setSlaDeadlineByNo.mock.calls[0][1];
    expect(passed.getTime()).toBeLessThan(Date.now());
  });
});
