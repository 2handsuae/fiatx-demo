import { Test, TestingModule } from '@nestjs/testing';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';

describe('DepositTransactionsController', () => {
  let controller: DepositTransactionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepositTransactionsController],
      providers: [
        {
          provide: DepositTransactionsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            updateStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DepositTransactionsController>(
      DepositTransactionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
