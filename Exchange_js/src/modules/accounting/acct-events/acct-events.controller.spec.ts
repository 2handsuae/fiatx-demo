import { Test, TestingModule } from '@nestjs/testing';
import { AcctEventsController } from './acct-events.controller';
import { AcctEventsService } from './acct-events.service';

describe('AcctEventsController', () => {
  let controller: AcctEventsController;

  const acctEventsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AcctEventsController],
      providers: [
        { provide: AcctEventsService, useValue: acctEventsService },
      ],
    }).compile();

    controller = module.get<AcctEventsController>(AcctEventsController);
    jest.clearAllMocks();
  });

  it('keeps read endpoints available after fake-write route deletion', async () => {
    acctEventsService.findAll.mockResolvedValue([{ eventCode: 'EVT_DEPOSIT_SUCCESS__CRYPTO' }]);
    acctEventsService.findOne.mockResolvedValue({ eventCode: 'EVT_DEPOSIT_SUCCESS__CRYPTO' });

    await controller.findAll({ keyword: 'deposit' } as any);
    await controller.findOne('EVT_DEPOSIT_SUCCESS__CRYPTO');

    expect(acctEventsService.findAll).toHaveBeenCalledWith({ keyword: 'deposit' });
    expect(acctEventsService.findOne).toHaveBeenCalledWith('EVT_DEPOSIT_SUCCESS__CRYPTO');
  });
});
