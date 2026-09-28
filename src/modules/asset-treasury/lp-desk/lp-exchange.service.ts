// 战役乙波一 T4 · LP 兑换单主体（LpExchange）：建单 / 八态八边迁移表 / 余额闸 / 读投影。
// 铁律③：本服务只写 lp_exchanges；三腿资金单、账本三码、审批、审计全在 Task 5 的 workflow 编排
//（同划转单先例：InternalTransferService 自己也不写审计）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { LpProfileService } from './lp-profile.service';
import { LP_EXCHANGE_TRANSITIONS } from './constants/lp-exchange-transitions.constant';
import { CreateLpExchangeInput, LpExchangeListQueryDto, LpExchangeStatus, LpExchangeView } from './dto/lp-exchange.dto';

@Injectable()
export class LpExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly lpProfiles: LpProfileService,
  ) {}

  // ── 建单 ────────────────────────────────────────────────────────────

  /** 出生守卫：档案 ACTIVE（Task 2 consumed）、两资产不同、两金额>0、审慎目的非空。
   *  三个钱包 id 由调用方（Task 5 workflow）解析好传入——本服务不解析钱包（照划转单
   *  resolveRoute 由 workflow 侧做的先例）。 */
  async create(input: CreateLpExchangeInput) {
    await this.lpProfiles.assertActiveByNo(input.lpNo);
    const profile = await this.lpProfiles.findByNo(input.lpNo);
    if (input.sellAssetId === input.buyAssetId) {
      throw new BadRequestException('An LP exchange must sell and buy two different assets');
    }
    if (!(new Prisma.Decimal(input.sellAmount).gt(0)) || !(new Prisma.Decimal(input.buyAmount).gt(0))) {
      throw new BadRequestException('Both the sell amount and the buy amount must be greater than zero');
    }
    if (!input.prudentialPurpose?.trim()) {
      throw new BadRequestException('prudentialPurpose is required — every LP exchange must record its prudential management purpose');
    }
    return this.prisma.lpExchange.create({
      data: {
        exchangeNo: generateReferenceNo('LPX'),
        lpId: profile.id,
        lpNo: profile.lpNo,
        sellAssetId: input.sellAssetId,
        sellAmount: new Prisma.Decimal(input.sellAmount),
        buyAssetId: input.buyAssetId,
        buyAmount: new Prisma.Decimal(input.buyAmount),
        prudentialPurpose: input.prudentialPurpose,
        status: LpExchangeStatus.PENDING_APPROVAL,
        reason: input.reason,
        sellFromWalletId: input.sellFromWalletId,
        buyViaWalletId: input.buyViaWalletId,
        buyToWalletId: input.buyToWalletId,
        traceId: input.traceId ?? randomUUID(),
        createdByUserId: input.createdByUserId,
      },
      include: { sellAsset: true, buyAsset: true },
    });
  }

  async findByNo(exchangeNo: string) {
    const row = await this.prisma.lpExchange.findUnique({ where: { exchangeNo }, include: { sellAsset: true, buyAsset: true } });
    if (!row) throw new NotFoundException(`LP exchange not found: ${exchangeNo}`);
    return row;
  }

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = LP_EXCHANGE_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal LP exchange status transition: ${from} → ${to}`);
  }

  async transition(exchangeNo: string, to: LpExchangeStatus, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(exchangeNo);
    this.assertTransition(row.status, to);
    return this.prisma.lpExchange.update({ where: { exchangeNo }, data: { status: to, ...patch }, include: { sellAsset: true, buyAsset: true } });
  }

  /** 铁律③同款：approvalNo 回填走主体服务，workflow 不直写自己域外的表。 */
  async stampApprovalNo(exchangeNo: string, approvalNo: string): Promise<void> {
    await this.prisma.lpExchange.update({ where: { exchangeNo }, data: { approvalNo } });
  }

  /** 出生守卫 / 批准时复核：运营户该币种（卖出币）可用（贷 − 借 − 待过账借）≥ 金额
   *  （最小单位）——同 InternalTransferService.assertFirmOpsBalance 形状，10 行只读
   *  守卫，不跨模块 import 复用（各主体自己一份实现，同来源不同实例）。 */
  async assertFirmOpsBalance(currency: string, amountMinor: bigint): Promise<void> {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new BadRequestException(`Unsupported currency: ${currency}`);
    const opsId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' });
    const bal = await this.accounting.lookupBalance(opsId);
    const available = bal.creditsPosted - bal.debitsPosted - bal.debitsPending;
    if (available < amountMinor) {
      throw new BadRequestException(
        `Insufficient ${currency} balance in the operating account (available ${available.toString()}, need ${amountMinor.toString()}, smallest unit) — the firm cannot sell an asset it does not have`,
      );
    }
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  async list(q: LpExchangeListQueryDto = {}): Promise<{ items: LpExchangeView[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
      ...(q.lpNo && { lpNo: q.lpNo }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.lpExchange.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { sellAsset: true, buyAsset: true } }),
      this.prisma.lpExchange.count({ where }),
    ]);
    const items = rows.map((r: any) => this.toView(r, []));
    return { items, total };
  }

  async getView(exchangeNo: string): Promise<LpExchangeView> {
    const row = await this.findByNo(exchangeNo);
    const legs = await this.prisma.fundsOrder.findMany({
      where: { lpExchangeId: row.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      include: { fromWallet: { select: { walletNo: true } }, toWallet: { select: { walletNo: true } }, asset: { select: { type: true } } },
    });
    return this.toView(row, legs);
  }

  /** 铁律⑥：投影里没有任何 id / lpId / assetId / walletId。 */
  private toView(row: any, legs: any[]): LpExchangeView {
    return {
      exchangeNo: row.exchangeNo, lpNo: row.lpNo, status: row.status,
      sellAssetCode: row.sellAsset.code, sellCurrency: row.sellAsset.currency,
      sellAmount: new Prisma.Decimal(row.sellAmount).toFixed(row.sellAsset.decimals),
      buyAssetCode: row.buyAsset.code, buyCurrency: row.buyAsset.currency,
      buyAmount: new Prisma.Decimal(row.buyAmount).toFixed(row.buyAsset.decimals),
      prudentialPurpose: row.prudentialPurpose, reason: row.reason,
      approvalNo: row.approvalNo ?? null, failureReasonCode: row.failureReasonCode ?? null, failureNote: row.failureNote ?? null,
      createdBy: row.createdByUserId, createdAt: row.createdAt.toISOString(),
      executedAt: row.executedAt ? row.executedAt.toISOString() : null,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
      legs: legs.map((l: any) => ({
        fundsOrderNo: l.fundsOrderNo, legSeq: l.legSeq, status: l.status,
        fromWalletNo: l.fromWallet?.walletNo ?? null, toWalletNo: l.toWallet?.walletNo ?? null,
        externalRef: (l.asset?.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO' ? (l.txHash ?? null) : (l.referenceNo ?? null),
      })),
    };
  }
}
