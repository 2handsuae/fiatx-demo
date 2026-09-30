// 战役乙波二 T5 · 付款单 workflow（本任务心脏）：审批裁决 / 单腿出款(码87) / 撤回。
// 单腿出项（钱付给在册外包商，运营户直出）——批准即复核余额，够则建腿（CREATED 出生，
// 走正常 OUT 推进，SUBMIT/CONFIRM 由 admin ⚡模拟推进驱动，本 workflow 只接
// handleFundsOrderChanged 的 SUBMITTED/CONFIRMED/FAILED/TIMEOUT——照 LP 卖出腿 84 全套
// 纪律：回单先于落账、先账后状态、落账失败停在原地不重试）；腿确认即码 87 落账、CLEAR、
// 单腿直达 SUCCESS（没有 LP 那样的悬空验收期——付款单出生就是终态前唯一一腿）。腿 1
// 推进走资金单页 ⚡，付款详情页不设推单按钮。铁律③各管各的：本文件只调
// VendorPaymentService/AccountingService/FundsOrderService/SystemWalletResolver/
// SimulatedCustodianStatementService 的公开方法，不直写域外表——唯一例外是按事件带的
// 内部 id 读 VendorPayment 行（事件只带 id，主体服务只暴露按业务号查，照
// LpExchangeWorkflowService.handleFundsOrderChanged 先例，横向读放行）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { toBusinessDate } from '../../accounting/tigerbeetle/utils/business-date.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';
import { SimulatedCustodianStatementService } from '../../clearing-settle/reconciliation/simulation/simulated-custodian-statement.service';
import { PrudentialService } from '../prudential/prudential.service';
import { VendorPaymentService } from './vendor-payment.service';
import { VendorPaymentStatus } from './dto/vendor-payment.dto';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string; fundsOrderNo: string;
  parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string; internalTransferId?: string; lpExchangeId?: string; capitalInjectionId?: string; vendorPaymentId?: string };
  legSeq: number; attempt: number; oldStatus: string | null; newStatus: string; traceId?: string;
}

/** initiate() 入参——只认业务键（vendorNo/资产 id），零 UUID 由调用方外部拼；
 *  fromWalletId（F_OPS）由本 workflow 解析（照 T3/T4 InitiateCapitalInjectionInput /
 *  CreateVendorPaymentInput 的分工：主体服务不解析钱包）。 */
export interface InitiateVendorPaymentInput {
  vendorNo: string;
  payeeAccountRef: string;
  assetId: string;
  amount: string; // 元
  purposeNote: string;
  prudentialPurpose: string;
  reason: string;
  traceId?: string | null;
}

const majorToMinor = (amount: Prisma.Decimal | string, decimals: number): bigint =>
  BigInt(new Prisma.Decimal(amount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

@Injectable()
export class VendorPaymentWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: VendorPaymentService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly custodianStatement: SimulatedCustodianStatementService,
    private readonly prudential: PrudentialService,
  ) {}

  // ── 发起（金库，CFO 单步批）──────────────────────────────────────────
  // 出生守卫（vendor ACTIVE / amount>0 / 三文本非空）在 VendorPaymentService.create() 内
  // 执行（横向读 OutsourcingVendorsService，铁律③放行，workflow 不重复持有该服务）。

  async initiate(dto: InitiateVendorPaymentInput, actor: ApprovalActorContext) {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset not found: ${dto.assetId}`);

    const amountMinor = majorToMinor(dto.amount, asset.decimals);
    await this.payments.assertFirmOpsBalance(asset.currency, amountMinor);
    // 算术门（乙波三 T2 spec §3）：余额闸=付得起，NLA 门=付完还合规，两闸各管各的，
    // 顺序先余额后 NLA——插在同一层同一形制（紧邻既有前置检查之后，出生守卫尚未建行）。
    await this.prudential.assertPostOutflowCompliant({
      currency: asset.currency as 'AED' | 'USDT', amountMinor, orderKind: 'VENDOR_PAYMENT', counterpartyNo: dto.vendorNo, actor,
    });

    const fromWallet = await this.systemWallets.resolve(dto.assetId, 'F_OPS');

    const row = await this.payments.create({
      vendorNo: dto.vendorNo, payeeAccountRef: dto.payeeAccountRef, assetId: dto.assetId, amount: dto.amount,
      purposeNote: dto.purposeNote, prudentialPurpose: dto.prudentialPurpose, reason: dto.reason,
      fromWalletId: fromWallet.id as string,
      traceId: dto.traceId ?? undefined, createdByUserId: actor.userNo ?? actor.userId,
    });

    const amountFormatted = new Prisma.Decimal(dto.amount).toFixed(asset.decimals);
    const impact = `Pay ${amountFormatted} ${asset.currency} to outsourcing vendor ${row.vendorNo} (${row.vendorName}) `
      + `(purpose: ${dto.prudentialPurpose}); the firm's ${asset.currency} operating balance decreases once the payment clears`;

    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.VENDOR_PAYMENT_APPROVAL,
        entityRef: row.payNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染。payeeAccountRef 必须在场
        // （修复轮·控制器确认缺口）：对外付款的 maker-checker 核心是让 CFO 看到钱打到哪个
        // 账户——LP 单不带坐标是因为坐标在 CFO 批过的 LP 档案里，付款单的坐标是金库开单
        // 手填的一次性值，不进快照=门半盲。文本值，非 UUID，不扰零 UUID 断言。
        objectSnapshot: {
          payNo: row.payNo, vendorNo: row.vendorNo, vendorName: row.vendorName,
          payeeAccountRef: row.payeeAccountRef,
          amount: `${amountFormatted} ${asset.currency}`,
          purposeNote: dto.purposeNote, prudentialPurpose: dto.prudentialPurpose, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await this.payments.stampApprovalNo(row.payNo, approval.approvalNo);
    await this.paymentAudit({ ...row, asset }, {
      action: AuditActions.VENDOR_PAYMENT_REQUESTED, reason: dto.reason, approvalNo: approval.approvalNo,
      metadata: { impact }, actor,
    });
    return { payNo: row.payNo as string, approvalNo: approval.approvalNo as string, status: VendorPaymentStatus.PENDING_APPROVAL };
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(payNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.payments.findByNo(payNo);
    if (row.status !== VendorPaymentStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Vendor payment ${payNo} is already in ${row.status} — funds are in flight or settled, it cannot be cancelled`);
    }
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason }, actor);
    const updated = await this.payments.transition(payNo, VendorPaymentStatus.CANCELLED, {});
    await this.paymentAudit(row, { action: AuditActions.VENDOR_PAYMENT_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { payNo, status: updated.status as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.vendor-payment.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'CANCELLED') return; // 撤回由 cancel() 自己收口（它先撤审批单再翻状态）
    let row: any;
    try { row = await this.payments.findByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (row.status !== VendorPaymentStatus.PENDING_APPROVAL) return;

    if (event.decision !== 'APPROVED') {
      const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
      const updated = await this.payments.transition(row.payNo, VendorPaymentStatus.REJECTED, {});
      await this.paymentAudit(row, { action: AuditActions.VENDOR_PAYMENT_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 批准时再查一次运营户（付款币）余额——同 LpExchangeWorkflowService.onDecided 纪律。
    const amountMinor = majorToMinor(row.amount, row.asset.decimals);
    try {
      await this.payments.assertFirmOpsBalance(row.asset.currency, amountMinor);
    } catch (err) {
      const updated = await this.payments.transition(row.payNo, VendorPaymentStatus.FAILED, { failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE', failureNote: (err as Error).message });
      await this.paymentAudit(row, { action: AuditActions.VENDOR_PAYMENT_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'INSUFFICIENT_FIRM_BALANCE', reason: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    const leg = await this.createPaymentLeg(row);
    const updated = await this.payments.transition(row.payNo, VendorPaymentStatus.EXECUTING, { executedAt: new Date() });
    await this.paymentAudit(row, { action: AuditActions.VENDOR_PAYMENT_EXECUTION_STARTED, reason: 'Approved by CFO, payment leg funds order created', approvalNo: event.approvalNo, causationId: event.approvalId, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  /** 腿 1（唯一腿）：F_OPS → 外部（收款方坐标，付款币 CRYPTO→cryptoAddress｜FIAT→fiatIban，
   *  一行文本落在 payeeAccountRef）。CREATED 出生，走正常 OUT 推进（SUBMIT/CONFIRM 由 admin
   *  ⚡模拟推进驱动，本 workflow 只接 handleFundsOrderChanged 的 SUBMITTED/CONFIRMED/FAILED/
   *  TIMEOUT）。 */
  private async createPaymentLeg(row: any) {
    const fromWallet = await this.prisma.wallet.findUnique({ where: { id: row.fromWalletId } });
    const isCrypto = row.asset.type === 'CRYPTO';
    return this.fundsOrders.create({
      vendorPaymentId: row.id, legSeq: 1, initialStatus: FundsOrderStatus.CREATED,
      assetId: row.assetId, amount: String(row.amount), netAmount: String(row.amount),
      fromWalletId: fromWallet?.id ?? null, fromAddress: fromWallet?.address ?? null, fromIban: fromWallet?.iban ?? null,
      toWalletId: null,
      toAddress: isCrypto ? row.payeeAccountRef : null,
      toIban: isCrypto ? null : row.payeeAccountRef,
      traceId: row.traceId ?? undefined,
    });
  }

  // ── 腿事件（付款腿）───────────────────────────────────────────────────

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.vendorPaymentId) return;
    const row = await this.prisma.vendorPayment.findUnique({ where: { id: event.parent.vendorPaymentId }, include: { asset: true } });
    if (!row) return;
    const leg = await this.fundsOrders.findById(event.fundsOrderId);
    if (!leg) return;
    switch (event.newStatus) {
      case FundsOrderStatus.SUBMITTED: await this.onPaymentLegSubmitted(row, leg); break;
      case FundsOrderStatus.CONFIRMED: await this.onPaymentLegConfirmed(row, leg); break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT: await this.onPaymentLegFailed(row, leg, event.newStatus); break;
      default: break;
    }
  }

  /** 提交那一步铸参考号，随后模拟托管方写一行（只有 F_OPS 这一侧是我们的钱包——外包商的
   *  外部坐标不落 externalBalance，recordLegMovement 的 toWalletId 传 null 只写 OUT 行）。 */
  private async onPaymentLegSubmitted(row: any, leg: any) {
    const isCrypto = row.asset.type === 'CRYPTO';
    const patch = await this.fundsOrders.stampExternalRef(leg.id);
    const stamped = { ...leg, ...(patch ?? {}) };
    const externalRef = this.fundsOrders.resolveExternalRef({ ...stamped, asset: row.asset }) ?? stamped.fundsOrderNo;
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: stamped.fundsOrderNo, fromWalletId: stamped.fromWalletId, toWalletId: null,
      assetCode: row.asset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(stamped.amount, row.asset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — vendor payment ${row.payNo} (paid to ${row.vendorName})`,
    });
  }

  /** 先账后状态：87 先落，再收口清算，单腿直达 SUCCESS（没有 LP 那样的悬空验收期）；
   *  落账失败停在原地不重试（铁律⑤）。 */
  private async onPaymentLegConfirmed(row: any, leg: any) {
    if (row.status !== VendorPaymentStatus.EXECUTING) return;
    try {
      await this.postPaymentLeg(row, leg);
    } catch (err) {
      await this.paymentAudit(row, { action: AuditActions.VENDOR_PAYMENT_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'POSTING_FAILED', reason: `Payment leg posting failed: ${(err as Error).message} — the order remains in Executing, the leg remains Confirmed, no retry`, fundsOrderNo: leg.fundsOrderNo });
      return;
    }
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'VENDOR_PAYMENT_WORKFLOW');
    const updated = await this.payments.transition(row.payNo, VendorPaymentStatus.SUCCESS, { settledAt: new Date() });
    await this.paymentAudit(row, {
      action: AuditActions.VENDOR_PAYMENT_EXECUTED, reason: 'Payment leg confirmed, entries posted and cleared',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status,
    });
  }

  private async onPaymentLegFailed(row: any, leg: any, newStatus: string) {
    if (row.status !== VendorPaymentStatus.EXECUTING) return;
    const note = `Payment leg ${newStatus}: no funds paid out to the vendor, this payment can be reinitiated`;
    const updated = await this.payments.transition(row.payNo, VendorPaymentStatus.FAILED, { failureReasonCode: 'LEG_FAILED', failureNote: note });
    await this.paymentAudit(row, { action: AuditActions.VENDOR_PAYMENT_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'LEG_FAILED', reason: note, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  // ── 分录（87）───────────────────────────────────────────────────────

  private ledgerOf(currency: string): number {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`Unable to resolve a ledger for currency ${currency}`);
    return ledger;
  }

  private sysAccount(ledger: number, code: number) {
    return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
  }

  /** 码 87：DR FIRM_OPS / CR FIRM_ASSET，付款币 ledger，外穿——一侧物理钱包是
   *  row.fromWalletId（付出的那个网络行），外包商的外部坐标不是钱包，不进 walletRef。 */
  private async postPaymentLeg(row: any, leg: any) {
    const ledger = this.ledgerOf(row.asset.currency);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_OPS),
      creditAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_ASSET),
      amount, ledger, code: TB_TRANSFER_CODES.VENDOR_PAYMENT,
      evidence: {
        sourceType: 'VENDOR_PAYMENT', sourceNo: row.payNo, eventCode: 'VENDOR_PAYMENT', traceId: row.traceId,
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_OPS], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET],
        assetCurrency: row.asset.currency, actorType: 'SYSTEM', actorId: 'VENDOR_PAYMENT_WORKFLOW',
        memo: `Vendor payment ${row.payNo} confirmed (paid to ${row.vendorName})`,
        debitWalletRef: row.fromWalletId, creditWalletRef: row.fromWalletId,
        externalRef: this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset }), isExternalCrossing: true,
      },
    });
  }

  // ── 审计（六码共用信封，照 injectionAudit 改写）─────────────────────────
  // 主体信封：primarySubject=VENDOR_PAYMENT·payNo，subjects 加外包商 OUTSOURCING_VENDOR·
  // vendorNo（横向 subject，铁律③放行）+审批单 INSTRUMENT+资金单 RELATED；
  // vendorName/payeeAccountRef 镜像 metadata（甲 R5 判例，同词表登记注释）。

  private async paymentAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.VENDOR_PAYMENT, subjectNo: row.payNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes.OUTSOURCING_VENDOR, subjectNo: row.vendorNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    const amountFormatted = new Prisma.Decimal(row.amount).toFixed(row.asset.decimals);
    const input: any = {
      action: patch.action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.VENDOR_PAYMENT,
      primarySubjectType: AuditEntityTypes.VENDOR_PAYMENT, primarySubjectNo: row.payNo,
      subjects,
      outcome: patch.outcome, reasonCode: patch.reasonCode, reason: patch.reason,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      amount: amountFormatted,
      effectiveDate: toBusinessDate(new Date()),
      // REQUESTED 起付款单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）。
      ...(patch.action === AuditActions.VENDOR_PAYMENT_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.payNo}_${randomUUID()}`,
      metadata: {
        payNo: row.payNo, vendorNo: row.vendorNo, vendorName: row.vendorName, payeeAccountRef: row.payeeAccountRef,
        amount: `${amountFormatted} ${row.asset.currency}`,
        fundsOrderNo: patch.fundsOrderNo ?? null,
        ...(patch.metadata ?? {}),
      },
      sourcePlatform: patch.actor ? 'ADMIN' : 'SYSTEM',
    };
    if (patch.actor) {
      const display = patch.actor.userNo ?? patch.actor.userId;
      await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: patch.actor.roleCodes ?? [] });
    } else {
      await this.auditLogs.recordSystem(input);
    }
  }
}
