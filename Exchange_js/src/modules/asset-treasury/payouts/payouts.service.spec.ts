import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutsService } from './payouts.service';
import {
  PayoutAction,
  PayoutStatus,
  PayoutType,
} from './dto/payout.dto';
import { PayoutEvents } from './constants/payout-events.constant';

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('PayoutsService', () => {
  let service: PayoutsService;
  let prisma: any;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      payout: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payoutAuditLog: {
        create: jest.fn(),
      },
      withdrawTransaction: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    service = new PayoutsService(prisma, eventEmitter as unknown as EventEmitter2);
    jest.clearAllMocks();
  });

  it('should emit payout failed event after commit', async () => {
    prisma.payout.findUnique.mockResolvedValue({
      id: 'PO_1',
      withdrawId: 'WD_1',
      type: PayoutType.FIAT,
      status: PayoutStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: null,
    });
    prisma.payout.update.mockResolvedValue({
      id: 'PO_1',
      status: PayoutStatus.FAILED,
    });
    prisma.payoutAuditLog.create.mockResolvedValue({ id: 'audit_1' });

    const updated = await service.updateStatus(
      'PO_1',
      { action: PayoutAction.FAIL },
      'SYSTEM',
    );

    expect(updated.status).toBe(PayoutStatus.FAILED);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      PayoutEvents.EVT_PAYOUT_FAILED,
      expect.objectContaining({
        payoutId: 'PO_1',
        withdrawId: 'WD_1',
        status: PayoutStatus.FAILED,
      }),
    );
  });

  it('should not emit payout events when external tx is provided', async () => {
    const txClient: any = {
      payout: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'PO_2',
          withdrawId: 'WD_2',
          type: PayoutType.FIAT,
          status: PayoutStatus.CONFIRMED,
          statusHistory: '[]',
          sentAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({
          id: 'PO_2',
          status: PayoutStatus.RETURNED,
        }),
      },
      payoutAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_2' }),
      },
    };

    const updated = await service.updateStatus(
      'PO_2',
      { action: PayoutAction.RETURN },
      'SYSTEM',
      txClient,
    );

    expect(updated.status).toBe(PayoutStatus.RETURNED);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should populate ownerId from withdraw when creating payout', async () => {
    prisma.payout.findUnique.mockResolvedValue(null);
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'WD_3',
      ownerId: 'CUST_3',
    });
    prisma.payout.create.mockResolvedValue({
      id: 'PO_3',
      payoutNo: 'PO0003',
      ownerId: 'CUST_3',
      withdrawId: 'WD_3',
    });
    prisma.payoutAuditLog.create.mockResolvedValue({ id: 'audit_3' });

    await service.create(
      {
        withdrawId: 'WD_3',
        type: PayoutType.CRYPTO,
        amount: 100,
        assetId: 'AST_1',
      },
      'SYSTEM',
    );

    expect(prisma.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'CUST_3',
        }),
      }),
    );
  });

  it('should return existing payout for same withdrawId', async () => {
    const existing = {
      id: 'PO_EXIST',
      withdrawId: 'WD_EXIST',
    };
    prisma.payout.findUnique.mockResolvedValue(existing);

    const created = await service.create(
      {
        withdrawId: 'WD_EXIST',
        type: PayoutType.FIAT,
        amount: 10,
        assetId: 'AST_2',
      },
      'SYSTEM',
    );

    expect(created).toBe(existing);
    expect(prisma.payout.create).not.toHaveBeenCalled();
  });
});
