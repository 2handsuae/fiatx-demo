import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { 
  PayoutQueryDto, 
  PayoutStatus, 
  UpdatePayoutStatusDto,
  CreatePayoutDto,
  PayoutType,
  PayoutAction
} from './dto/payout.dto';

const CRYPTO_TRANSITIONS: Record<string, Partial<Record<PayoutAction, PayoutStatus>>> = {
  [PayoutStatus.CREATED]: { [PayoutAction.SIGN]: PayoutStatus.SIGNING },
  [PayoutStatus.SIGNING]: { 
    [PayoutAction.BROADCAST]: PayoutStatus.BROADCASTED,
    [PayoutAction.SIGN_FAIL]: PayoutStatus.FAILED 
  },
  [PayoutStatus.BROADCASTED]: { 
    [PayoutAction.SEEN_IN_MEMPOOL]: PayoutStatus.CONFIRMING,
    [PayoutAction.DROP]: PayoutStatus.FAILED,
    [PayoutAction.TIMEOUT]: PayoutStatus.TIMEOUT
  },
  [PayoutStatus.CONFIRMING]: { 
    [PayoutAction.CONFIRM]: PayoutStatus.CONFIRMED,
    [PayoutAction.TIMEOUT]: PayoutStatus.TIMEOUT,
    [PayoutAction.FAIL]: PayoutStatus.FAILED
  },
  [PayoutStatus.CONFIRMED]: { [PayoutAction.CLEAR]: PayoutStatus.CLEAR },
  [PayoutStatus.FAILED]: {},
  [PayoutStatus.TIMEOUT]: {},
  [PayoutStatus.CLEAR]: {},
  [PayoutStatus.RETURNED]: {},
};

const FIAT_TRANSITIONS: Record<string, Partial<Record<PayoutAction, PayoutStatus>>> = {
  [PayoutStatus.CREATED]: { [PayoutAction.SUBMIT]: PayoutStatus.CONFIRMING },
  [PayoutStatus.CONFIRMING]: { 
    [PayoutAction.CONFIRM]: PayoutStatus.CONFIRMED,
    [PayoutAction.FAIL]: PayoutStatus.FAILED,
    [PayoutAction.TIMEOUT]: PayoutStatus.TIMEOUT
  },
  [PayoutStatus.CONFIRMED]: { 
    [PayoutAction.CLEAR]: PayoutStatus.CLEAR,
    [PayoutAction.RETURN]: PayoutStatus.RETURNED
  },
  [PayoutStatus.CLEAR]: { [PayoutAction.RETURN]: PayoutStatus.RETURNED },
  [PayoutStatus.FAILED]: {},
  [PayoutStatus.TIMEOUT]: {},
  [PayoutStatus.RETURNED]: {},
};
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PayoutEvents } from './constants/payout-events.constant';
import { WithdrawEvents } from '../../trading/withdraw-transactions/constants/withdraw-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(private prisma: PrismaService, private eventEmitter: EventEmitter2) {}

  private generatePayoutId(): string {
    return `PO_${uuidv4()}`;
  }

  async findAll(query: PayoutQueryDto) {
    const { skip, take, withdrawId, status, type, assetId } = query;
    const where: any = {};

    if (withdrawId) where.withdrawId = withdrawId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (assetId) where.assetId = assetId;

    const [items, total] = await Promise.all([
      (this.prisma as any).payout.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          withdraw: true,
          customer: true,
        },
      }),
      (this.prisma as any).payout.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).payout.findUnique({
      where: { id },
      include: {
        asset: true,
        withdraw: true,
        customer: true,
        clearings: {
          include: {
            lines: true
          }
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundException('Payout not found');
    return item;
  }

  async create(dto: CreatePayoutDto, operatorId: string, tx?: Prisma.TransactionClient) {
    const { withdrawId, type, amount, assetId, toWalletId, toAddress, toIban } = dto;

    const payoutId = this.generatePayoutId();

    const executeCreate = async (client: Prisma.TransactionClient) => {
      const record = await (client as any).payout.create({
        data: {
          id: payoutId,
          payoutNo: generateReferenceNo('PO'),
          withdrawId,
          type,
          status: PayoutStatus.CREATED,
          amount: new Prisma.Decimal(amount),
          assetId,
          toWalletId,
          toAddress,
          toIban,
          statusHistory: JSON.stringify([{
            status: PayoutStatus.CREATED,
            timestamp: new Date().toISOString(),
            operator: operatorId,
            note: 'Payout initiated'
          }]),
        },
      });

      await (client as any).payoutAuditLog.create({
        data: {
          payoutId: record.id,
          operatorId,
          oldStatus: 'NONE',
          newStatus: PayoutStatus.CREATED,
          reason: 'Payout initiated',
        },
      });

      return record;
    };

    if (tx) {
      return executeCreate(tx);
    }

    return await (this.prisma as any).$transaction(async (client: any) => {
      return executeCreate(client);
    });
  }

  async updateStatus(id: string, dto: UpdatePayoutStatusDto, operatorId: string, tx?: Prisma.TransactionClient) {
    const { action, txHash, referenceNo, reason } = dto;
    const item = await this.findOne(id);
    const oldStatus = item.status as PayoutStatus;
    const type = item.type as PayoutType;

    const transitions = type === PayoutType.CRYPTO ? CRYPTO_TRANSITIONS : FIAT_TRANSITIONS;
    const nextStatus = transitions[oldStatus]?.[action] as PayoutStatus;

    if (!nextStatus) {
      throw new BadRequestException(`Invalid action ${action} for current status ${oldStatus} and type ${type}`);
    }

    const executeUpdate = async (client: Prisma.TransactionClient) => {
      const updateData: any = { status: nextStatus };

      // Update timestamps based on status
      if (nextStatus === PayoutStatus.SIGNING || (type === PayoutType.FIAT && nextStatus === PayoutStatus.CONFIRMING)) {
        if (!item.sentAt) {
          updateData.sentAt = new Date();
        }
      }

      if ([PayoutStatus.CLEAR, PayoutStatus.FAILED, PayoutStatus.TIMEOUT, PayoutStatus.RETURNED].includes(nextStatus)) {
        updateData.completedAt = new Date();
      }

      if (txHash) updateData.txHash = txHash;
      if (referenceNo) updateData.referenceNo = referenceNo;

      // Update status history
      let history: any[] = [];
      try {
        if (item.statusHistory) {
          history = JSON.parse(item.statusHistory);
        }
      } catch (e) {
        // ignore
      }
      history.push({
        status: nextStatus,
        timestamp: new Date().toISOString(),
        operator: operatorId,
        note: reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`)
      });
      updateData.statusHistory = JSON.stringify(history);

      const updated = await client.payout.update({
        where: { id },
        data: updateData,
      });

      await client.payoutAuditLog.create({
        data: {
          payoutId: id,
          operatorId,
          oldStatus,
          newStatus: nextStatus,
          reason: reason || (action ? `Action: ${action}` : `Status updated to ${nextStatus}`),
        },
      });

      // Emit events for statuses
      if (nextStatus === PayoutStatus.CONFIRMED) {
        this.eventEmitter.emit(PayoutEvents.EVT_PAYOUT_CONFIRMED, {
          payoutId: id,
          withdrawId: item.withdrawId,
        });
      } else if (nextStatus === PayoutStatus.FAILED || nextStatus === PayoutStatus.TIMEOUT) {
        if (item.withdrawId) {
          const event =
            type === PayoutType.CRYPTO
              ? WithdrawEvents.EVT_WITHDRAWAL_FAILED__CRYPTO
              : WithdrawEvents.EVT_WITHDRAWAL_FAILED__FIAT;
          this.eventEmitter.emit(event, {
            withdrawId: item.withdrawId,
            payoutId: id,
            status: nextStatus,
          });
        } else {
          const event =
            nextStatus === PayoutStatus.FAILED
              ? PayoutEvents.EVT_PAYOUT_FAILED
              : PayoutEvents.EVT_PAYOUT_TIMEOUT;
          this.eventEmitter.emit(event, {
            payoutId: id,
            withdrawId: item.withdrawId,
          });
        }
      } else if (nextStatus === PayoutStatus.RETURNED) {
        this.eventEmitter.emit(PayoutEvents.EVT_PAYOUT_RETURNED, {
          payoutId: id,
          withdrawId: item.withdrawId,
        });
      }

      return updated;
    };

    if (tx) {
      return executeUpdate(tx);
    } else {
      return await (this.prisma as any).$transaction(async (client: Prisma.TransactionClient) => {
        return executeUpdate(client);
      });
    }
  }

  async createMock(operatorId: string) {
    const assets = await (this.prisma as any).asset.findMany({ take: 10 });
    if (assets.length === 0) throw new BadRequestException('No assets found to create mock payouts');

    const createdPayouts: any[] = [];

    for (let i = 0; i < 3; i++) {
      const asset = assets[Math.floor(Math.random() * assets.length)];
      const type = Math.random() > 0.5 ? PayoutType.CRYPTO : PayoutType.FIAT;
      const amount = Math.floor(Math.random() * 1000) + 10;
      const withdrawNo = `WDR_MOCK_${uuidv4().substring(0, 8)}`;
      const withdrawId = uuidv4();

      await (this.prisma as any).$transaction(async (tx: any) => {
        // Create a mock withdraw transaction first
        const withdraw = await tx.withdrawTransaction.create({
          data: {
            id: withdrawId,
            withdrawNo,
            ownerType: 'CUSTOMER',
            ownerId: 'MOCK_USER',
            type: 'WITHDRAW',
            status: 'APPROVED',
            assetId: asset.id,
            amount: new Prisma.Decimal(amount),
            netAmount: new Prisma.Decimal(amount),
          },
        });

        const payoutId = this.generatePayoutId();
        const payout = await tx.payout.create({
          data: {
            id: payoutId,
            withdrawId: withdraw.id,
            type,
            status: PayoutStatus.CREATED,
            amount: new Prisma.Decimal(amount),
            assetId: asset.id,
            toAddress: type === PayoutType.CRYPTO ? '0x' + uuidv4().replace(/-/g, '') : null,
            toIban: type === PayoutType.FIAT ? 'IBAN' + uuidv4().substring(0, 20) : null,
          },
        });

        await tx.payoutAuditLog.create({
          data: {
            payoutId: payout.id,
            operatorId,
            oldStatus: 'NONE',
            newStatus: PayoutStatus.CREATED,
            reason: 'Mock payout created',
          },
        });

        createdPayouts.push(payout);
      });
    }

    return createdPayouts;
  }
}
