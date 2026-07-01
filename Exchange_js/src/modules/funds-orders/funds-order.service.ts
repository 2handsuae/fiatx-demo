import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import {
  CreateFundsOrderInput,
  FundsOrderAction,
  FundsOrderStatus,
  FundsOrderDirection,
  FundsOrderAssetType,
} from './dto/funds-order.dto';
import { getTransitionMap, TERMINAL_STATUSES } from './constants/funds-order-transitions.constant';

type Tx = Prisma.TransactionClient;

@Injectable()
export class FundsOrderService {
  private readonly logger = new Logger(FundsOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private parentOf(row: { depositTransactionId?: string | null; withdrawTransactionId?: string | null; swapTransactionId?: string | null }) {
    return {
      depositTransactionId: row.depositTransactionId ?? undefined,
      withdrawTransactionId: row.withdrawTransactionId ?? undefined,
      swapTransactionId: row.swapTransactionId ?? undefined,
    };
  }

  private directionOf(row: { depositTransactionId?: string | null; withdrawTransactionId?: string | null; swapTransactionId?: string | null }): FundsOrderDirection {
    if (row.depositTransactionId) return 'IN';
    if (row.withdrawTransactionId) return 'OUT';
    return 'INTERNAL'; // swap
  }

  async create(input: CreateFundsOrderInput, tx?: Tx) {
    const fks = [input.depositTransactionId, input.withdrawTransactionId, input.swapTransactionId].filter(Boolean);
    if (fks.length !== 1) {
      throw new BadRequestException('FundsOrder requires exactly one parent FK (deposit/withdraw/swap)');
    }
    const client: any = tx ?? this.prisma;
    const status = input.initialStatus ?? FundsOrderStatus.CREATED;
    const row = await client.fundsOrder.create({
      data: {
        fundsOrderNo: generateReferenceNo('FO'),
        depositTransactionId: input.depositTransactionId ?? null,
        withdrawTransactionId: input.withdrawTransactionId ?? null,
        swapTransactionId: input.swapTransactionId ?? null,
        legSeq: input.legSeq ?? 1,
        attempt: input.attempt ?? 1,
        status,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amount),
        feeAmount: new Prisma.Decimal(input.feeAmount ?? '0'),
        netAmount: new Prisma.Decimal(input.netAmount ?? input.amount),
        fromWalletId: input.fromWalletId ?? null,
        fromAddress: input.fromAddress ?? null,
        fromIban: input.fromIban ?? null,
        toWalletId: input.toWalletId ?? null,
        toAddress: input.toAddress ?? null,
        toIban: input.toIban ?? null,
        txHash: input.txHash ?? null,
        referenceNo: input.referenceNo ?? null,
        providerTxnId: input.providerTxnId ?? null,
        statusHistory: JSON.stringify([{ toStatus: status, action: 'CREATE', at: new Date().toISOString() }]),
      },
    });
    this.eventEmitter.emit('funds_order.status.changed', {
      fundsOrderId: row.id,
      fundsOrderNo: row.fundsOrderNo,
      parent: this.parentOf(row),
      legSeq: row.legSeq,
      attempt: row.attempt,
      oldStatus: null,
      newStatus: row.status,
      traceId: input.traceId,
    });
    return row;
  }

  async advance(id: string, action: FundsOrderAction, operatorId: string, tx?: Tx) {
    const run = async (client: any) => {
      const row = await client.fundsOrder.findUnique({ where: { id }, include: { asset: true } });
      if (!row) throw new NotFoundException(`FundsOrder ${id} not found`);
      const current = row.status as FundsOrderStatus;
      if (TERMINAL_STATUSES.has(current)) {
        throw new BadRequestException(`FundsOrder ${id} already terminal (${current}) — invalid transition`);
      }
      const direction = this.directionOf(row);
      const assetType = (row.asset?.type ?? 'CRYPTO').toUpperCase() as FundsOrderAssetType;
      const map = getTransitionMap(direction, assetType);
      const next = map[current]?.[action];
      if (!next) {
        throw new BadRequestException(`Invalid transition: ${current} --${action}--> (direction=${direction}, asset=${assetType})`);
      }
      const history = row.statusHistory ? JSON.parse(row.statusHistory) : [];
      history.push({ fromStatus: current, toStatus: next, action, operatorId, at: new Date().toISOString() });
      const updated = await client.fundsOrder.update({
        where: { id },
        data: { status: next, statusHistory: JSON.stringify(history) },
      });
      return { updated, oldStatus: current, newStatus: next };
    };

    const { updated, oldStatus, newStatus } = tx ? await run(tx) : await this.prisma.$transaction(run);

    this.eventEmitter.emit('funds_order.status.changed', {
      fundsOrderId: updated.id,
      fundsOrderNo: updated.fundsOrderNo,
      parent: this.parentOf(updated),
      legSeq: updated.legSeq,
      attempt: updated.attempt,
      oldStatus,
      newStatus,
      traceId: undefined,
    });
    return updated;
  }

  async findById(id: string, tx?: Tx) {
    const client: any = tx ?? this.prisma;
    return client.fundsOrder.findUnique({ where: { id }, include: { asset: true } });
  }

  async findByParent(
    parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string },
    filter?: { legSeq?: number; attempt?: number; status?: FundsOrderStatus },
    tx?: Tx,
  ) {
    const client: any = tx ?? this.prisma;
    return client.fundsOrder.findMany({
      where: {
        ...(parent.depositTransactionId && { depositTransactionId: parent.depositTransactionId }),
        ...(parent.withdrawTransactionId && { withdrawTransactionId: parent.withdrawTransactionId }),
        ...(parent.swapTransactionId && { swapTransactionId: parent.swapTransactionId }),
        ...(filter?.legSeq !== undefined && { legSeq: filter.legSeq }),
        ...(filter?.attempt !== undefined && { attempt: filter.attempt }),
        ...(filter?.status && { status: filter.status }),
      },
      include: { asset: true },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
    });
  }
}
