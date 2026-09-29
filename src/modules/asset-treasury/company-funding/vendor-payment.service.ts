// 战役乙波二 T4 · 付款单主体（VendorPayment）：建单 / 六态六边迁移表 / 读投影 / 运营户余额闸。
// 铁律③：本服务只写 vendor_payments；收款方=在册外包商，横向读走
// OutsourcingVendorsService.assertActiveByNo/findByNo，不直写 outsourcing_vendors 表。
// 资金单腿、账本记账、审批、审计全在 Task 5 的 workflow 编排（同 CapitalInjectionService
// 先例：本服务内不写审计）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { OutsourcingVendorsService } from '../../governance/compliance-office/outsourcing-vendors.service';
import { VENDOR_PAYMENT_TRANSITIONS } from './constants/vendor-payment-transitions.constant';
import {
  CreateVendorPaymentInput,
  VendorPaymentListQueryDto,
  VendorPaymentStatus,
  VendorPaymentView,
} from './dto/vendor-payment.dto';

@Injectable()
export class VendorPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: OutsourcingVendorsService,
    private readonly accounting: AccountingService,
  ) {}

  // ── 建单 ────────────────────────────────────────────────────────────

  /** 出生守卫：收款方外包商必须 ACTIVE（横向读，铁律③放行）；amount>0；
   *  purposeNote/prudentialPurpose/reason 三个文本字段非空。vendorId/vendorName
   *  从档案行落快照——列表零联查（照 vendorName 快照先例）。 */
  async create(input: CreateVendorPaymentInput) {
    await this.vendors.assertActiveByNo(input.vendorNo);
    if (!(new Prisma.Decimal(input.amount).gt(0))) {
      throw new BadRequestException('amount must be greater than zero');
    }
    if (!input.purposeNote?.trim()) {
      throw new BadRequestException('purposeNote is required — every vendor payment must record its purpose');
    }
    if (!input.prudentialPurpose?.trim()) {
      throw new BadRequestException('prudentialPurpose is required — every vendor payment must record its prudential management purpose');
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException('reason is required — every vendor payment must record its reason');
    }
    const vendor = await this.vendors.findByNo(input.vendorNo);
    return this.prisma.vendorPayment.create({
      data: {
        payNo: generateReferenceNo('PAY'),
        vendorId: vendor.id,
        vendorNo: vendor.vendorNo,
        vendorName: vendor.name,
        payeeAccountRef: input.payeeAccountRef,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amount),
        purposeNote: input.purposeNote,
        prudentialPurpose: input.prudentialPurpose,
        status: VendorPaymentStatus.PENDING_APPROVAL,
        reason: input.reason,
        fromWalletId: input.fromWalletId,
        traceId: input.traceId ?? randomUUID(),
        createdByUserId: input.createdByUserId,
      },
      include: { asset: true },
    });
  }

  async findByNo(payNo: string) {
    const row = await this.prisma.vendorPayment.findUnique({ where: { payNo }, include: { asset: true } });
    if (!row) throw new NotFoundException(`Vendor payment not found: ${payNo}`);
    return row;
  }

  // ── 迁移 ────────────────────────────────────────────────────────────

  assertTransition(from: string, to: string): void {
    const allowed = VENDOR_PAYMENT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Illegal vendor payment status transition: ${from} → ${to}`);
  }

  async transition(payNo: string, to: VendorPaymentStatus, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(payNo);
    this.assertTransition(row.status, to);
    return this.prisma.vendorPayment.update({ where: { payNo }, data: { status: to, ...patch }, include: { asset: true } });
  }

  /** 铁律③同款：approvalNo 回填走主体服务，workflow 不直写自己域外的表。 */
  async stampApprovalNo(payNo: string, approvalNo: string): Promise<void> {
    await this.prisma.vendorPayment.update({ where: { payNo }, data: { approvalNo } });
  }

  /** 批准时复核：运营户该币种可用（贷 − 借 − 待过账借）≥ 金额（最小单位）。
   *  照 internal-transfer.service.ts:76-90 同款注释。 */
  async assertFirmOpsBalance(currency: string, amountMinor: bigint): Promise<void> {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new BadRequestException(`Unsupported currency: ${currency}`);
    const opsId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' });
    const bal = await this.accounting.lookupBalance(opsId);
    const available = bal.creditsPosted - bal.debitsPosted - bal.debitsPending;
    if (available < amountMinor) {
      throw new BadRequestException(
        `Insufficient ${currency} balance in the operating account (available ${available.toString()}, need ${amountMinor.toString()}, smallest unit) — the firm cannot pay out funds it does not have`,
      );
    }
  }

  // ── 读 ──────────────────────────────────────────────────────────────

  async list(q: VendorPaymentListQueryDto = {}): Promise<{ items: VendorPaymentView[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.vendorPayment.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { asset: true } }),
      this.prisma.vendorPayment.count({ where }),
    ]);
    const items = rows.map((r: any) => this.toView(r, []));
    return { items, total };
  }

  async getView(payNo: string): Promise<VendorPaymentView> {
    const row = await this.findByNo(payNo);
    const legs = await this.prisma.fundsOrder.findMany({
      where: { vendorPaymentId: row.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      include: { fromWallet: { select: { walletNo: true } }, toWallet: { select: { walletNo: true } }, asset: { select: { type: true } } },
    });
    return this.toView(row, legs);
  }

  /** 铁律⑥：投影里没有任何 id / assetId / walletId / vendorId。 */
  private toView(row: any, legs: any[]): VendorPaymentView {
    return {
      payNo: row.payNo, vendorNo: row.vendorNo, vendorName: row.vendorName, payeeAccountRef: row.payeeAccountRef,
      assetCode: row.asset.code, currency: row.asset.currency,
      amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals),
      purposeNote: row.purposeNote, prudentialPurpose: row.prudentialPurpose, reason: row.reason,
      status: row.status, approvalNo: row.approvalNo ?? null,
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
