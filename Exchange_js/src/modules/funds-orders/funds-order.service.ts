import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import { fakeChainTxHash, fakeBankRef } from '../../common/utils/fake-external-refs.util';
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
    // FIAT_IN 充值出生态即 CONFIRMED(绕过 advance)——同一铸造器补号(幂等:
    // 发起方已带 referenceNo 则为 no-op)。
    if (row.status === FundsOrderStatus.CONFIRMED) {
      const asset = await client.asset.findUnique({ where: { id: input.assetId } });
      const assetType = (asset?.type ?? 'CRYPTO').toUpperCase() as FundsOrderAssetType;
      const patch = this.buildExternalRefPatch(row, assetType);
      if (patch) {
        await client.fundsOrder.update({ where: { id: row.id }, data: patch });
        Object.assign(row, patch);
      }
    }
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

  async advance(id: string, action: FundsOrderAction, operatorId: string, tx?: Tx, opts?: { effectiveDate?: string }) {
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
      const stampPatch =
        next === FundsOrderStatus.CONFIRMED ? this.buildExternalRefPatch(row, assetType) : null;
      const updated = await client.fundsOrder.update({
        where: { id },
        data: { status: next, statusHistory: JSON.stringify(history), ...(stampPatch ?? {}) },
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
      effectiveDate: opts?.effectiveDate,
    });
    return updated;
  }

  /**
   * Advance by business no — admin/simulation entry.
   * swap legs are rejected here and must go through the swap controller's
   * advanceLeg (which enforces the sell-first sequence guard). deposit/withdraw
   * route through the standard advance() (transition-map validated).
   */
  async advanceByNo(fundsOrderNo: string, action: FundsOrderAction, operatorId: string) {
    const row = await this.prisma.fundsOrder.findUnique({ where: { fundsOrderNo } });
    if (!row) throw new NotFoundException(`FundsOrder ${fundsOrderNo} not found`);
    if (row.swapTransactionId) {
      throw new BadRequestException(
        'Swap-leg funds orders advance via /admin/swap-transactions/:swapNo/legs/:legSeq/advance',
      );
    }
    return this.advance(row.id, action, operatorId);
  }

  async findById(id: string, tx?: Tx) {
    const client: any = tx ?? this.prisma;
    return client.fundsOrder.findUnique({ where: { id }, include: { asset: true } });
  }

  /**
   * externalRef 消费方(账务 evidence / 对账 / admin)统一读取口:
   * crypto → txHash,fiat → referenceNo。单一漏斗,订单域不再各自推导。
   */
  resolveExternalRef(row: {
    asset?: { type?: string | null } | null;
    txHash?: string | null;
    referenceNo?: string | null;
  }): string | null {
    const assetType = (row.asset?.type ?? 'CRYPTO').toUpperCase();
    return assetType === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null;
  }

  /**
   * 资金单首次到达 CONFIRMED 时,按资产类型铸造 externalRef,返回列补丁(无则 null)。
   * 幂等:若对应列已有值(如虚拟币充值由发起方带入的 inbound txHash),保留不覆盖。
   * 确定性种子 = fundsOrderNo → 外部对账镜像(writeMirror 复制 account_flows.externalRef)
   * 构造性同值。方向无关:进/出/兑换腿同规则。
   */
  private buildExternalRefPatch(
    row: { fundsOrderNo: string; txHash?: string | null; referenceNo?: string | null; createdAt?: Date },
    assetType: FundsOrderAssetType,
  ): { txHash: string } | { referenceNo: string } | null {
    if (assetType === 'CRYPTO') {
      if (row.txHash) return null;
      return { txHash: fakeChainTxHash(row.fundsOrderNo) };
    }
    if (row.referenceNo) return null;
    return { referenceNo: fakeBankRef(row.fundsOrderNo, row.createdAt ?? new Date()) };
  }

  /** Thin business-key finder — raw row (+ asset) by fundsOrderNo. Recon push-order
   *  orchestrator needs id/status/FKs/wallets/referenceNo/amount/createdAt on the row. */
  async findByNo(fundsOrderNo: string, tx?: Tx) {
    const client: any = tx ?? this.prisma;
    return client.fundsOrder.findUnique({ where: { fundsOrderNo }, include: { asset: true } });
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

  /** Round3 对账在途匹配专用：某钱包上全部非终态资金单（含相对方向）。 */
  async findNonTerminalByWallet(walletId: string) {
    const rows = await this.prisma.fundsOrder.findMany({
      where: {
        status: { notIn: Array.from(TERMINAL_STATUSES) },
        OR: [{ fromWalletId: walletId }, { toWalletId: walletId }],
      },
      select: {
        id: true, fundsOrderNo: true, status: true, amount: true, netAmount: true,
        txHash: true, referenceNo: true, providerTxnId: true,
        fromWalletId: true, toWalletId: true, createdAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      direction: (r.fromWalletId === walletId ? 'OUT' : 'IN') as 'IN' | 'OUT',
    }));
  }

  /* ── Admin read surface (C6) ────────────────────────────────────
     Unified funds-orders admin list + detail. A funds_order's "parent"
     is whichever of the three FKs is non-null: deposit (IN payin),
     withdraw (OUT payout + fee leg), or swap (leg). The parent bucket
     is a virtual filter derived from that FK, not a stored column.     */

  private parentFkWhere(parent?: 'deposit' | 'withdraw' | 'swap' | 'all') {
    switch (parent) {
      case 'deposit':
        return { depositTransactionId: { not: null } };
      case 'withdraw':
        return { withdrawTransactionId: { not: null } };
      case 'swap':
        return { swapTransactionId: { not: null } };
      default:
        return {};
    }
  }

  async findAllForAdmin(filter: {
    parent?: 'deposit' | 'withdraw' | 'swap' | 'all';
    status?: string;
    assetId?: string;
    fundsOrderNo?: string;
    txHash?: string;
    skip?: number;
    take?: number;
  }) {
    const { parent, status, assetId, fundsOrderNo, txHash } = filter;
    const skip = Number(filter.skip ?? 0);
    const take = Number(filter.take ?? 20);

    const where: Prisma.FundsOrderWhereInput = {
      ...this.parentFkWhere(parent),
      ...(status && { status }),
      ...(assetId && { assetId }),
      ...(fundsOrderNo && { fundsOrderNo: { contains: fundsOrderNo } }),
      ...(txHash && { txHash: { contains: txHash } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.fundsOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          deposit: { select: { depositNo: true } },
          withdrawTransaction: { select: { withdrawNo: true } },
          swapTransaction: { select: { swapNo: true } },
        },
      }),
      this.prisma.fundsOrder.count({ where }),
    ]);

    const items = rows.map((row) => ({
      ...row,
      // Surface the parent business no (never the raw parent id) for display.
      depositNo: row.deposit?.depositNo ?? null,
      withdrawNo: row.withdrawTransaction?.withdrawNo ?? null,
      swapNo: row.swapTransaction?.swapNo ?? null,
    }));

    return { items, total };
  }

  async findOneByNoForAdmin(fundsOrderNo: string) {
    const item = await this.prisma.fundsOrder.findUnique({
      where: { fundsOrderNo },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        deposit: { select: { id: true, depositNo: true, status: true } },
        withdrawTransaction: {
          select: { id: true, withdrawNo: true, status: true },
        },
        swapTransaction: { select: { id: true, swapNo: true, status: true } },
        auditLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) {
      throw new NotFoundException(`FundsOrder ${fundsOrderNo} not found`);
    }
    return {
      ...item,
      depositNo: item.deposit?.depositNo ?? null,
      withdrawNo: item.withdrawTransaction?.withdrawNo ?? null,
      swapNo: item.swapTransaction?.swapNo ?? null,
    };
  }
}
