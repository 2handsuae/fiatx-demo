// 战役乙波二 T2 · 注资单主体（CapitalInjection）：建单 / 六态五边迁移表 / 读投影。
// 铁律③：本服务只写 capital_injections；资金单腿、账本记账、审批、审计全在 Task 3 的
// workflow 编排（同 LpExchangeService 先例：本服务内不写审计）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { CAPITAL_INJECTION_TRANSITIONS } from './constants/capital-injection-transitions.constant';
import {
  CapitalInjectionListQueryDto,
  CapitalInjectionStatus,
  CapitalInjectionView,
  CreateCapitalInjectionInput,
} from './dto/capital-injection.dto';

@Injectable()
export class CapitalInjectionService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 建单 ────────────────────────────────────────────────────────────

  /** 出生守卫：contributorName/prudentialPurpose 非空、金额>0。toWalletId 由调用方
   *  （Task 3 workflow，经 SystemWalletResolver 解析）传入——本服务不解析钱包（照
   *  LpExchangeService.create 头注释纪律）。 */
  async create(input: CreateCapitalInjectionInput) {
    if (!input.contributorName?.trim()) {
      throw new BadRequestException('contributorName is required — every capital injection must record who contributed');
    }
    if (!input.prudentialPurpose?.trim()) {
      throw new BadRequestException('prudentialPurpose is required — every capital injection must record its prudential management purpose');
    }
    if (!(new Prisma.Decimal(input.amount).gt(0))) {
      throw new BadRequestException('amount must be greater than zero');
    }
    return this.prisma.capitalInjection.create({
      data: {
        cinNo: generateReferenceNo('CIN'),
        contributorName: input.contributorName,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amount),
        prudentialPurpose: input.prudentialPurpose,
        status: CapitalInjectionStatus.PENDING_APPROVAL,
        reason: input.reason,
        toWalletId: input.toWalletId,
        traceId: input.traceId ?? randomUUID(),
        createdByUserId: input.createdByUserId,
      },
      include: { asset: true },
    });
  }

  async findByNo(cinNo: string) {
    const row = await this.prisma.capitalInjection.findUnique({ where: { cinNo }, include: { asset: true } });
    if (!row) throw new NotFoundException(`Capital injection not found: ${cinNo}`);
    return row;
  }

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = CAPITAL_INJECTION_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal capital injection status transition: ${from} → ${to}`);
  }

  async transition(cinNo: string, to: CapitalInjectionStatus, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(cinNo);
    this.assertTransition(row.status, to);
    return this.prisma.capitalInjection.update({ where: { cinNo }, data: { status: to, ...patch }, include: { asset: true } });
  }

  /** 铁律③同款：approvalNo 回填走主体服务，workflow 不直写自己域外的表。 */
  async stampApprovalNo(cinNo: string, approvalNo: string): Promise<void> {
    await this.prisma.capitalInjection.update({ where: { cinNo }, data: { approvalNo } });
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  async list(q: CapitalInjectionListQueryDto = {}): Promise<{ items: CapitalInjectionView[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.capitalInjection.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { asset: true } }),
      this.prisma.capitalInjection.count({ where }),
    ]);
    const items = rows.map((r: any) => this.toView(r, []));
    return { items, total };
  }

  async getView(cinNo: string): Promise<CapitalInjectionView> {
    const row = await this.findByNo(cinNo);
    const legs = await this.prisma.fundsOrder.findMany({
      where: { capitalInjectionId: row.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      include: { fromWallet: { select: { walletNo: true } }, toWallet: { select: { walletNo: true } }, asset: { select: { type: true } } },
    });
    return this.toView(row, legs);
  }

  /** 铁律⑥：投影里没有任何 id / assetId / walletId。 */
  private toView(row: any, legs: any[]): CapitalInjectionView {
    return {
      cinNo: row.cinNo, contributorName: row.contributorName, status: row.status,
      assetCode: row.asset.code, currency: row.asset.currency,
      amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals),
      prudentialPurpose: row.prudentialPurpose, reason: row.reason,
      approvalNo: row.approvalNo ?? null,
      createdBy: row.createdByUserId, createdAt: row.createdAt.toISOString(),
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
      legs: legs.map((l: any) => ({
        fundsOrderNo: l.fundsOrderNo, legSeq: l.legSeq, status: l.status,
        fromWalletNo: l.fromWallet?.walletNo ?? null, toWalletNo: l.toWallet?.walletNo ?? null,
        externalRef: (l.asset?.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO' ? (l.txHash ?? null) : (l.referenceNo ?? null),
      })),
    };
  }
}
