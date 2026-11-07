// 平账二期 · 内部划转单主体（spec §3）：建行 / 迁移表 / 读投影。余额闸在 AccountingService.assertWalletBalance（戊波二 T3 收成一份，由 workflow 调）。
// 铁律③：本服务只写 internal_transfers；资金单、账本、审批、审计全在 workflow 编排。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { toBusinessDate } from '../../accounting/tigerbeetle/utils/business-date.util';
import { INTERNAL_TRANSFER_BLOCKING_STATUSES, INTERNAL_TRANSFER_TRANSITIONS } from './constants/internal-transfer-transitions.constant';
import { CreateInternalTransferInput, InternalTransferListQueryDto, InternalTransferStatus, InternalTransferView } from './dto/internal-transfer.dto';

@Injectable()
export class InternalTransferService {
  constructor(private readonly prisma: PrismaService) {}

  assertTransition(from: string, to: string): void {
    const allowed = INTERNAL_TRANSFER_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal internal transfer status transition: ${from} → ${to}`);
  }

  async create(input: CreateInternalTransferInput) {
    return this.prisma.internalTransfer.create({
      data: {
        transferNo: generateReferenceNo('ITR'),
        purpose: input.purpose,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amountMajor),
        fromWalletId: input.fromWalletId,
        viaWalletId: input.viaWalletId,
        toWalletId: input.toWalletId,
        customerId: input.customerId,
        customerNo: input.customerNo,
        status: InternalTransferStatus.PENDING_APPROVAL,
        reason: input.reason,
        sourceCaseNo: input.sourceCaseNo,
        sourceExternalLineId: input.sourceExternalLineId ?? null,
        explainedFlowId: input.explainedFlowId ?? null,
        explainedExternalLineId: input.explainedExternalLineId ?? null,
        effectiveDate: input.effectiveDate,
        lossSource: input.lossSource ?? null,
        sourceIncidentNo: input.sourceIncidentNo ?? null,
        traceId: input.traceId ?? randomUUID(),
        createdByUserId: input.createdByUserId,
      },
      include: { asset: true },
    });
  }

  async findByNo(transferNo: string) {
    const row = await this.prisma.internalTransfer.findUnique({ where: { transferNo }, include: { asset: true } });
    if (!row) throw new NotFoundException(`Internal transfer not found: ${transferNo}`);
    return row;
  }

  /** 同一来源上「未走完或已成功」的划转单——出生守卫②（垫款：按被退汇账单行）。 */
  async findBlockingBySource(source: { sourceExternalLineId?: string }) {
    return this.prisma.internalTransfer.findFirst({
      where: { ...source, status: { in: [...INTERNAL_TRANSFER_BLOCKING_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 同一差异行上挡住新认损补缺单的那张（出生守卫②，认损补缺版）：按锚（内部流水 id / 外部账单行 id 任一命中）找，
   * 挡人的有两类——未走完或已成功的单（INTERNAL_TRANSFER_BLOCKING_STATUSES），以及「已记短缺却 FAILED」的单
   * （recognizedTbTransferId 有值：短缺已记在账上，再开一张会记两次，不做重补，戊波二裁定 15）。
   * 记短缺前就失败 / 拒绝 / 撤回的单不挡（recognizedTbTransferId 为空）。
   */
  async findBlockingShortfallTopup(anchors: { explainedFlowId?: string; explainedExternalLineId?: string }) {
    const anchorOr = [
      anchors.explainedFlowId ? { explainedFlowId: anchors.explainedFlowId } : null,
      anchors.explainedExternalLineId ? { explainedExternalLineId: anchors.explainedExternalLineId } : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    if (anchorOr.length === 0) return null;
    return this.prisma.internalTransfer.findFirst({
      where: {
        purpose: 'SHORTFALL_TOPUP',
        OR: anchorOr,
        AND: [{ OR: [
          { status: { in: [...INTERNAL_TRANSFER_BLOCKING_STATUSES] } },
          { status: InternalTransferStatus.FAILED, recognizedTbTransferId: { not: null } },
        ] }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async transition(transferNo: string, to: InternalTransferStatus, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(transferNo);
    this.assertTransition(row.status, to);
    return this.prisma.internalTransfer.update({ where: { transferNo }, data: { status: to, ...patch }, include: { asset: true } });
  }

  /** 铁律③：approvalNo 回填走主体服务，workflow 不直写自己域外……的表。 */
  async stampApprovalNo(transferNo: string, approvalNo: string): Promise<void> {
    await this.prisma.internalTransfer.update({ where: { transferNo }, data: { approvalNo } });
  }

  /** 记短缺（码 91）落账成功后立刻写回执——先于建腿，之后无论腿成败，这张单都「已记短缺」（阻塞集看它）。 */
  async stampRecognized(transferNo: string, tbTransferId: string): Promise<void> {
    await this.prisma.internalTransfer.update({ where: { transferNo }, data: { recognizedTbTransferId: tbTransferId, recognizedAt: new Date() } });
  }

  async list(q: InternalTransferListQueryDto): Promise<{ items: InternalTransferView[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
      ...(q.purpose && { purpose: q.purpose }),
      ...(q.customerNo && { customerNo: q.customerNo }),
      ...(q.sourceCaseNo && { sourceCaseNo: q.sourceCaseNo }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.internalTransfer.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { asset: true } }),
      this.prisma.internalTransfer.count({ where }),
    ]);
    const items = await Promise.all(rows.map((r: any) => this.toView(r, [])));
    return { items, total };
  }

  async getView(transferNo: string): Promise<InternalTransferView> {
    const row = await this.findByNo(transferNo);
    const legs = await this.prisma.fundsOrder.findMany({
      where: { internalTransferId: row.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      include: { fromWallet: { select: { walletNo: true } }, toWallet: { select: { walletNo: true } }, asset: { select: { type: true } } },
    });
    return this.toView(row, legs);
  }

  /** 铁律⑥：投影里没有任何 id / walletId / customerId / externalLineId。 */
  private async toView(row: any, legs: any[]): Promise<InternalTransferView> {
    const ids = [row.fromWalletId, row.viaWalletId, row.toWalletId].filter(Boolean);
    const wallets = (await this.prisma.wallet.findMany({ where: { id: { in: ids } }, select: { id: true, walletNo: true } })) as Array<{ id: string; walletNo: string | null }>;
    const noOf = (id: string | null) => (id ? (wallets.find((w) => w.id === id)?.walletNo ?? null) : null);
    const sourceLine = row.sourceExternalLineId
      ? await this.prisma.externalStatementLine.findUnique({ where: { id: row.sourceExternalLineId }, select: { externalRef: true } })
      : null;
    return {
      transferNo: row.transferNo, purpose: row.purpose, status: row.status,
      customerNo: row.customerNo, assetCode: row.asset.code, currency: row.asset.currency, decimals: row.asset.decimals,
      amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals),
      reason: row.reason, sourceCaseNo: row.sourceCaseNo,
      sourceExternalRef: sourceLine?.externalRef ?? null,
      effectiveDate: toBusinessDate(row.effectiveDate),
      lossSource: (row.lossSource as InternalTransferView['lossSource']) ?? null, sourceIncidentNo: row.sourceIncidentNo ?? null,
      recognizedAt: row.recognizedAt ? row.recognizedAt.toISOString() : null,
      approvalNo: row.approvalNo ?? null, failureReasonCode: row.failureReasonCode ?? null, failureNote: row.failureNote ?? null,
      fromWalletNo: noOf(row.fromWalletId), viaWalletNo: noOf(row.viaWalletId), toWalletNo: noOf(row.toWalletId),
      createdBy: row.createdByUserId, createdAt: row.createdAt.toISOString(),
      executedAt: row.executedAt ? row.executedAt.toISOString() : null,
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
      legs: legs.map((l: any) => ({
        fundsOrderNo: l.fundsOrderNo, legSeq: l.legSeq, status: l.status,
        fromWalletNo: l.fromWallet?.walletNo ?? null, toWalletNo: l.toWallet?.walletNo ?? null,
        externalRef: (l.asset?.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO' ? (l.txHash ?? null) : (l.referenceNo ?? null),
      })),
    };
  }
}
