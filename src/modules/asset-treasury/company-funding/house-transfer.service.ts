// 戊波二 T5 · 公司调拨单主体（HouseTransfer）：建单 / 六态六边迁移表 / 读投影。
// 余额闸在 AccountingService.assertWalletBalance、from / to 钱包守卫在 FirmWalletPickerService、NLA 门在 PrudentialService
// （都由 workflow 调，主体服务不碰）。铁律③：本服务只写 house_transfers；资金单腿、账本记账、审批、审计全在 workflow 编排。
// from / to 钱包存裸列（没有 Prisma 关系），读出来时一次批量取两只钱包挂在行上（fromWallet / toWallet）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { HOUSE_TRANSFER_TRANSITIONS } from './constants/house-transfer-transitions.constant';
import {
  CreateHouseTransferInput,
  HouseTransferListQueryDto,
  HouseTransferStatus,
  HouseTransferView,
} from './dto/house-transfer.dto';

interface WalletBrief { id: string; walletNo: string | null; vaultCode: string | null; address: string | null; iban: string | null }

@Injectable()
export class HouseTransferService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = HOUSE_TRANSFER_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal house transfer status transition: ${from} → ${to}`);
  }

  async transition(transferNo: string, to: HouseTransferStatus, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(transferNo);
    this.assertTransition(row.status, to);
    const updated = await this.prisma.houseTransfer.update({ where: { transferNo }, data: { status: to, ...patch }, include: { asset: true } });
    return this.withWallets(updated);
  }

  /** 落账失败（POSTING_FAILED）时单停在 EXECUTING——不迁状态，只把原因记在行上，详情页看得到卡在哪、为什么。 */
  async stampFailure(transferNo: string, failureReasonCode: string, failureNote: string): Promise<void> {
    await this.prisma.houseTransfer.update({ where: { transferNo }, data: { failureReasonCode, failureNote } });
  }

  /** 铁律③同款：approvalNo 回填走主体服务，workflow 不直写自己域外的表。 */
  async stampApprovalNo(transferNo: string, approvalNo: string): Promise<void> {
    await this.prisma.houseTransfer.update({ where: { transferNo }, data: { approvalNo } });
  }

  // ── 建单 ────────────────────────────────────────────────────────────

  /** 出生守卫：amount > 0（R15：后端收任何 0 < 金额 ≤ from 余额，「默认整扫」是表单的默认值）。
   *  钱包 / 余额 / NLA 守卫在 workflow（调拨单没有外部对手方，不查别的主体）。 */
  async create(input: CreateHouseTransferInput) {
    if (!(new Prisma.Decimal(input.amount).gt(0))) {
      throw new BadRequestException('amount must be greater than zero');
    }
    const row = await this.prisma.houseTransfer.create({
      data: {
        transferNo: generateReferenceNo('HTR'),
        purpose: input.purpose,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amount),
        fromWalletId: input.fromWalletId,
        toWalletId: input.toWalletId,
        reason: input.reason,
        status: HouseTransferStatus.PENDING_APPROVAL,
        traceId: randomUUID(),
        createdByUserId: input.createdByUserId,
      },
      include: { asset: true },
    });
    return this.withWallets(row);
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  async findByNo(transferNo: string) {
    const row = await this.prisma.houseTransfer.findUnique({ where: { transferNo }, include: { asset: true } });
    if (!row) throw new NotFoundException(`House transfer not found: ${transferNo}`);
    return this.withWallets(row);
  }

  /** 腿事件只带内部 id（FundsOrder 的父键），按 id 回读——同 LP 兑换单 / 付款单 workflow 的先例，只此一处按 id 查。 */
  async findById(id: string) {
    const row = await this.prisma.houseTransfer.findUnique({ where: { id }, include: { asset: true } });
    return row ? this.withWallets(row) : null;
  }

  async list(q: HouseTransferListQueryDto = {}): Promise<{ items: HouseTransferView[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
      ...(q.purpose && { purpose: q.purpose }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.houseTransfer.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { asset: true } }),
      this.prisma.houseTransfer.count({ where }),
    ]);
    const items = await Promise.all(rows.map(async (r: any) => this.toView(await this.withWallets(r), [])));
    return { items, total };
  }

  async getView(transferNo: string): Promise<HouseTransferView> {
    const row = await this.findByNo(transferNo);
    const legs = await this.prisma.fundsOrder.findMany({
      where: { houseTransferId: row.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      include: { fromWallet: { select: { walletNo: true } }, toWallet: { select: { walletNo: true } }, asset: { select: { type: true } } },
    });
    return this.toView(row, legs);
  }

  /** 行 + 两只钱包（fromWallet / toWallet）。钱包已被删的话对应字段为 null（读面 walletNo 回 null）。 */
  private async withWallets<T extends { fromWalletId: string; toWalletId: string }>(row: T) {
    const wallets = (await this.prisma.wallet.findMany({
      where: { id: { in: [row.fromWalletId, row.toWalletId] } },
      select: { id: true, walletNo: true, vaultCode: true, address: true, iban: true },
    })) as WalletBrief[];
    const byId = new Map(wallets.map((w) => [w.id, w]));
    return { ...row, fromWallet: byId.get(row.fromWalletId) ?? null, toWallet: byId.get(row.toWalletId) ?? null };
  }

  /** 铁律⑥：投影里没有任何 id / assetId / walletId，钱包只给 walletNo。 */
  private toView(row: any, legs: any[]): HouseTransferView {
    return {
      transferNo: row.transferNo, purpose: row.purpose,
      assetCode: row.asset.code, currency: row.asset.currency, decimals: row.asset.decimals,
      amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals),
      fromWalletNo: row.fromWallet?.walletNo ?? null, fromVaultCode: row.fromWallet?.vaultCode ?? null,
      toWalletNo: row.toWallet?.walletNo ?? null, toVaultCode: row.toWallet?.vaultCode ?? null,
      reason: row.reason, status: row.status, approvalNo: row.approvalNo ?? null,
      fundsOrderNo: row.fundsOrderNo ?? null,
      closeTbTransferIds: row.closeTbTransferIds ? (JSON.parse(row.closeTbTransferIds) as string[]) : [],
      failureReasonCode: row.failureReasonCode ?? null, failureNote: row.failureNote ?? null,
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
