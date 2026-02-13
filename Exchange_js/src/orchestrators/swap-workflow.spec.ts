import { Test, TestingModule } from '@nestjs/testing';
import { SwapWorkflowService } from './swap-workflow.service';
import { SwapTransactionsService } from '../modules/trading/swap-transactions/swap-transactions.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { SwapEvents } from '../modules/trading/swap-transactions/constants/swap-events.constant';
import { SwapTransactionStatus } from '../modules/trading/swap-transactions/dto/swap-transaction.dto';

describe('SwapWorkflowService', () => {
  let service: SwapWorkflowService;
  let swapService: SwapTransactionsService;
  let journalService: JournalsService;

  const mockSwap = {
    id: 'swap-123',
    swapNo: 'SW_20240127_000001',
    ownerId: 'user-1',
    ownerType: 'CUSTOMER',
    fromAssetId: 'asset-1',
    toAssetId: 'asset-2',
    fromAmount: { toString: () => '100' },
    toAmount: { toString: () => '200' },
    exchangeRate: { toString: () => '2' },
  };

  const mockSwapService = {
    findOne: jest.fn().mockResolvedValue(mockSwap),
  };

  const mockJournalService = {
    triggerEvent: jest.fn().mockResolvedValue({ id: 'journal-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapWorkflowService,
        { provide: SwapTransactionsService, useValue: mockSwapService },
        { provide: JournalsService, useValue: mockJournalService },
      ],
    }).compile();

    service = module.get<SwapWorkflowService>(SwapWorkflowService);
    swapService = module.get<SwapTransactionsService>(SwapTransactionsService);
    journalService = module.get<JournalsService>(JournalsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should trigger accounting on EVT_SWAP_CREATED', async () => {
    await service.handleSwapCreated({ swapId: 'swap-123' });

    expect(swapService.findOne).toHaveBeenCalledWith('swap-123');
    expect(journalService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        toStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        sourceId: 'swap-123',
      }),
    );
  });

  it('should trigger accounting on EVT_SWAP_SUCCESS', async () => {
    await service.handleSwapSuccess({
      swapId: 'swap-123',
      oldStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
    });

    expect(journalService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        fromStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        toStatus: SwapTransactionStatus.SUCCESS,
      }),
    );
  });

  it('should trigger accounting on EVT_SWAP_REJECTED', async () => {
    await service.handleSwapRejected({
      swapId: 'swap-123',
      oldStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
      reason: 'test',
    });

    expect(journalService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'SWAP',
        fromStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
        toStatus: SwapTransactionStatus.REJECTED,
      }),
    );
  });
});
