import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  PayinQueryDto,
  PayinStatus,
  PayinAction,
  PayinType,
  SimulatePayinDto,
} from './dto/payin.dto';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PayinStatusChangedEvent,
  PayinCreatedEvent,
} from './events/payin.events';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';

@Injectable()
export class PayinsService {
  private readonly logger = new Logger(PayinsService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  async simulate(dto: SimulatePayinDto) {
    const { assetId, toWalletId, type } = dto;
    this.logger.log(`Simulating payin for wallet ${toWalletId} (Type: ${type})`);

    // Verify wallet and asset
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: toWalletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    // Validation for FIAT
    if (type === PayinType.FIAT) {
        // In a real scenario, these should be provided in the DTO. 
        // For simulation, we generate them if missing, but strictly they are required for Fiat.
        // We'll generate mock values here to satisfy the requirement for valid data in the system.
        // If this were a real creation endpoint, we would throw BadRequestException if missing.
    }

    // Create random amount
    const amount = (Math.random() * 1000).toFixed(2);
    const initialStatus = PayinStatus.DETECTED;
    const initialHistory = [
        {
            status: initialStatus,
            changedAt: new Date(),
            reason: 'Initial simulation',
            operatorId: 'SYSTEM'
        }
    ];

    // Create Payin
    const payin = await (this.prisma as any).payin.create({
      data: {
        payinNo: generateReferenceNo('PI'),
        type,
        status: initialStatus,
        amount: new Prisma.Decimal(amount),
        assetId: assetId,
        toWalletId: toWalletId,
        ownerId: wallet.ownerType === 'CUSTOMER' ? wallet.ownerId : undefined,
        statusHistory: JSON.stringify(initialHistory),
        // Mock data
        txHash: type === PayinType.CRYPTO ? '0x' + crypto.randomBytes(32).toString('hex') : undefined,
        fromAddress:
          type === PayinType.CRYPTO
            ? '0x' + crypto.randomBytes(20).toString('hex')
            : undefined,
        fromIban:
          type === PayinType.FIAT
            ? 'US' + crypto.randomInt(10000000, 99999999)
            : undefined,
        referenceNo: 
          type === PayinType.FIAT
            ? 'REF-' + crypto.randomInt(100000, 999999)
            : undefined,
        receivedAt: new Date(),
        // Default values for others
      },
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_CREATE,
      action: AuditActions.PAYIN_CREATED,
      module: AuditModules.PAYINS,
      entityType: AuditEntityTypes.PAYIN,
      entityId: payin.id,
      entityNo: payin.payinNo,
      entityOwnerType: wallet.ownerType,
      entityOwnerId: wallet.ownerId || undefined,
      reason: 'Initial simulation',
      afterData: {
        status: payin.status,
        type: payin.type,
        amount: payin.amount?.toString?.(),
        assetId: payin.assetId,
        toWalletId: payin.toWalletId,
      },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Emitting payin.created event for ${payin.id}`);
    console.log('PAYIN_SERVICE: Emitting payin.created for', payin.id);
    const emitted = this.eventEmitter.emit(
      'payin.created',
      new PayinCreatedEvent(
        payin.id,
        payin.status as PayinStatus,
        payin.type as PayinType,
        payin.depositId,
        payin.assetId,
        payin.amount.toString(),
      ),
    );
    console.log('PAYIN_SERVICE: Emitted result:', emitted);

    return payin;
  }

  async findAll(query: PayinQueryDto) {
    const { skip, take, status, type, assetId, txHash, depositId } = query;
    const where: Prisma.PayinWhereInput = {};

    if (status) where.status = status;
    if (type) where.type = type;
    if (assetId) where.assetId = assetId;
    if (txHash) where.txHash = { contains: txHash };
    if (depositId) where.depositId = depositId;

    const [items, total] = await Promise.all([
      (this.prisma as any).payin.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { receivedAt: 'desc' },
        include: {
          deposit: {
            select: {
              kytStatus: true,
              travelRuleStatus: true,
              depositNo: true,
            },
          },
          asset: {
            select: {
              code: true,
              type: true,
              network: true,
              decimals: true,
            },
          },
          toWallet: {
            select: {
              ownerType: true,
              ownerId: true,
              address: true,
              accountName: true,
            },
          },
          customer: {
            select: {
              customerNo: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      (this.prisma as any).payin.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).payin.findUnique({
      where: { id },
      include: {
        asset: true,
        toWallet: true,
        fromWallet: true,
        deposit: true,
        customer: { select: { customerNo: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Payin not found');
    
    // Manually map ownerNo from relations if available
    // Use type assertion because Prisma types might not perfectly infer the include result for 'customer' in all contexts
    const payinWithCustomer = item as any;
    let ownerNo = payinWithCustomer.ownerNo;
    
    if (!ownerNo && payinWithCustomer.customer) {
        ownerNo = payinWithCustomer.customer.customerNo;
    }

    // Map fields to match the requested API response format
    const response = {
        ...item,
        ownerNo,
        ownerType: payinWithCustomer.toWallet?.ownerType || 'CUSTOMER',
        transactionType: 'DEPOSIT',
        transactionId: item.depositId,
        transactionNo: payinWithCustomer.deposit?.depositNo,
        toWalletNo: payinWithCustomer.toWallet?.walletNo,
        fromWalletNo: payinWithCustomer.fromWallet?.walletNo,
    };

    return response;
  }

  async updateStatus(id: string, action: PayinAction) {
    const payin = await this.findOne(id);
    const currentStatus = payin.status as PayinStatus;
    const type = payin.type as PayinType;

    let nextStatus: PayinStatus | null = null;

    if (type === PayinType.FIAT) {
      // Fiat State Machine
      // [*] --> DETECTED
      // DETECTED --> CONFIRMED: confirm
      // DETECTED --> FAILED: fail
      // CONFIRMED --> CLEARED: clear

      switch (currentStatus) {
        case PayinStatus.DETECTED:
          if (action === PayinAction.CONFIRM) nextStatus = PayinStatus.CONFIRMED;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED;
          break;
        case PayinStatus.CONFIRMED:
          if (action === PayinAction.CLEAR) nextStatus = PayinStatus.CLEARED;
          break;
      }
    } else {
      // Crypto State Machine
      // [*] --> DETECTED
      // DETECTED --> CONFIRMING: block
      // CONFIRMING --> CONFIRMED: confirm
      // CONFIRMING --> FAILED: fail
      // CONFIRMED --> CLEARED: clear

      switch (currentStatus) {
        case PayinStatus.DETECTED:
          if (action === PayinAction.BLOCK) nextStatus = PayinStatus.CONFIRMING;
          break;
        case PayinStatus.CONFIRMING:
          if (action === PayinAction.CONFIRM) nextStatus = PayinStatus.CONFIRMED;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED;
          break;
        case PayinStatus.CONFIRMED:
          if (action === PayinAction.CLEAR) nextStatus = PayinStatus.CLEARED;
          break;
      }
    }

    if (!nextStatus) {
      throw new BadRequestException(
        `Invalid transition: Cannot perform action '${action}' on payin ${id} with status '${currentStatus}' (Type: ${type})`,
      );
    }

    this.logger.log(
      `Transitioning payin ${id} from ${currentStatus} to ${nextStatus} via action ${action}`,
    );

    // Update history
    const historyEntry = {
        status: nextStatus,
        changedAt: new Date(),
        reason: `Action: ${action}`,
        operatorId: 'SYSTEM' // In real app, get from request context
    };

    let newHistoryString;
    try {
        const history = payin.statusHistory ? JSON.parse(payin.statusHistory as string) : [];
        if (Array.isArray(history)) {
            history.push(historyEntry);
            newHistoryString = JSON.stringify(history);
        } else {
            newHistoryString = JSON.stringify([historyEntry]);
        }
    } catch (e) {
        newHistoryString = JSON.stringify([historyEntry]);
    }

    const updatedPayin = await (this.prisma as any).payin.update({
      where: { id },
      data: {
        status: nextStatus,
        statusHistory: newHistoryString,
      },
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('PAYIN', currentStatus, nextStatus),
      module: AuditModules.PAYINS,
      entityType: AuditEntityTypes.PAYIN,
      entityId: updatedPayin.id,
      entityNo: updatedPayin.payinNo,
      entityOwnerId: updatedPayin.ownerId || undefined,
      statusFrom: currentStatus,
      statusTo: nextStatus,
      reason: `Action: ${action}`,
      beforeData: { status: currentStatus },
      afterData: { status: nextStatus },
      sourcePlatform: 'SYSTEM',
    });

    this.eventEmitter.emit(
      'payin.status.changed',
      new PayinStatusChangedEvent(
        updatedPayin.id,
        currentStatus,
        nextStatus,
        type,
        updatedPayin.depositId,
        updatedPayin.assetId,
        updatedPayin.amount.toString(),
      ),
    );

    return updatedPayin;
  }

  async linkDeposit(id: string, depositId: string) {
    return (this.prisma as any).payin.update({
      where: { id },
      data: { depositId },
    });
  }
}
