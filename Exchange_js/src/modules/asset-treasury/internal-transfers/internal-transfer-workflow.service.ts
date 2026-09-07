// 平账二期 · 内部划转单工作流（spec §3–§6）。铁律③：只调各主体服务方法，不直写别人的表
//（读案子 / 调账单 / 定性 / 钱包 / 资产是横向读，放行）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { fakeBankRef, fakeChainTxHash } from '../../../common/utils/fake-external-refs.util';
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
import { SupplementEvidenceService, minorToMajor } from '../../clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferStatus } from './dto/internal-transfer.dto';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string; fundsOrderNo: string;
  parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string; internalTransferId?: string };
  legSeq: number; attempt: number; oldStatus: string | null; newStatus: string; traceId?: string;
}

const majorToMinor = (amount: Prisma.Decimal | string, decimals: number): bigint =>
  BigInt(new Prisma.Decimal(amount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

@Injectable()
export class InternalTransferWorkflowService {
  private readonly logger = new Logger(InternalTransferWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly supplementEvidence: SupplementEvidenceService,
    private readonly custodianStatement: SimulatedCustodianStatementService,
  ) {}

  // ── 发起（金库，案子上点）────────────────────────────────────────────────

  /** 认损补款：来源 = 已落账的客户池认损调账单；金额锁定 = 认损额。 */
  async initiateCompensation(dto: { adjustmentNo: string; reason: string }, actor: ApprovalActorContext) {
    const adj = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo: dto.adjustmentNo } });
    if (!adj) throw new NotFoundException(`Adjustment not found: ${dto.adjustmentNo}`);
    if (adj.status !== 'POSTED') throw new BadRequestException(`Loss-recognition adjustment ${dto.adjustmentNo} is not yet posted (${adj.status}) — the books must reflect it before compensation can be paid`);
    if (adj.reasonCode !== 'UNEXPLAINED_CLIENT_LOSS' || adj.book !== 'CLIENT') throw new BadRequestException(`Adjustment ${dto.adjustmentNo} is not a client-pool loss-recognition adjustment — compensation cannot be paid`);
    if (!adj.ownerId || !adj.ownerNo || !adj.walletRef) throw new BadRequestException(`Loss-recognition adjustment ${dto.adjustmentNo} is missing customer or wallet information`);
    const blocking = await this.transfers.findBlockingBySource({ sourceAdjustmentNo: dto.adjustmentNo });
    if (blocking) throw new ConflictException(`Loss-recognition adjustment ${dto.adjustmentNo} already has transfer ${blocking.transferNo} (${blocking.status}) — another cannot be opened`);
    const asset = await (this.prisma as any).asset.findUnique({ where: { code: adj.assetCode } });
    if (!asset) throw new NotFoundException(`Asset not found: ${adj.assetCode}`);
    const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: adj.walletRef }, select: { id: true, ownerId: true } });
    if (!wallet || wallet.ownerId !== adj.ownerId) throw new BadRequestException("The loss-recognition adjustment's wallet does not belong to this customer");
    const amountMinor = BigInt(adj.amount);
    await this.transfers.assertFirmOpsBalance(asset.currency, amountMinor);
    const route = await this.resolveRoute(asset, wallet.id);
    const amountMajor = minorToMajor(adj.amount, asset.decimals);
    const row = await this.transfers.create({
      purpose: 'CLIENT_COMPENSATION', assetId: asset.id, amountMajor, ...route,
      customerId: adj.ownerId, customerNo: adj.ownerNo, reason: dto.reason, sourceCaseNo: adj.caseNo,
      sourceAdjustmentNo: adj.adjustmentNo, traceId: adj.traceId ?? null, createdByUserId: actor.userNo ?? actor.userId,
    });
    const impact = `Pay customer ${adj.ownerNo} compensation of ${amountMajor} ${asset.currency} (adjustment ${adj.adjustmentNo}, case ${adj.caseNo}); the firm operating account decreases accordingly`;
    return this.submitForApproval({ ...row, asset }, impact, dto.reason, actor, { sourceAdjustmentNo: adj.adjustmentNo });
  }

  /** 退汇垫款：来源 = 定性为「入金被退汇」且尚未认领的账单行；金额锁定 = 账单行 − 客户可用。 */
  async initiateAdvance(dto: { caseNo: string; externalLineId: string; reason: string }, actor: ApprovalActorContext) {
    const disp = await (this.prisma as any).reconciliationDisposition.findFirst({ where: { caseNo: dto.caseNo, explainedExternalLineId: dto.externalLineId } });
    if (!disp || disp.outlet !== 'SUPPLEMENT' || disp.deferredTarget !== 'SUPPLEMENT_BOUNCE') throw new BadRequestException('Only a statement line classified as "Deposit recalled" needs an advance — classify it first');
    if (disp.supplementNo) throw new BadRequestException(`This statement line has already been converted to supplement ${disp.supplementNo} — no advance is needed`);
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo: disp.dispositionNo, kind: 'SUPPLEMENT_BOUNCE' });
    const available = (await this.accounting.getCustomerAvailableBalance(line.ownerId, line.currency)).available;
    const shortfall = BigInt(line.amountMinor) - available;
    if (shortfall <= 0n) throw new BadRequestException("The customer's available balance already covers the shortfall — no advance is needed, claim the recall directly");
    const blocking = await this.transfers.findBlockingBySource({ sourceExternalLineId: dto.externalLineId });
    if (blocking) throw new ConflictException(`This statement line already has advance ${blocking.transferNo} (${blocking.status}) — another cannot be opened`);
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: line.assetId } });
    if (!asset) throw new NotFoundException(`Asset not found: ${line.assetId}`);
    await this.transfers.assertFirmOpsBalance(asset.currency, shortfall);
    const route = await this.resolveRoute(asset, line.walletId);
    const amountMajor = minorToMajor(shortfall.toString(), asset.decimals);
    const row = await this.transfers.create({
      purpose: 'CLIENT_ADVANCE', assetId: asset.id, amountMajor, ...route,
      customerId: line.ownerId, customerNo: line.ownerNo ?? line.ownerId, reason: dto.reason, sourceCaseNo: dto.caseNo,
      sourceExternalLineId: dto.externalLineId, traceId: null, createdByUserId: actor.userNo ?? actor.userId,
    });
    const impact = `Advance ${amountMajor} ${asset.currency} to customer ${line.ownerNo ?? '-'} to cover the bounced-refund shortfall (case ${dto.caseNo}, statement line ${line.externalRef ?? '-'}; `
      + `customer available ${minorToMajor(available.toString(), asset.decimals)}, recalled ${line.amountMajor}); the advance must be recovered by Treasury`;
    return this.submitForApproval({ ...row, asset }, impact, dto.reason, actor, { externalRef: line.externalRef ?? null });
  }

  /** 出方运营户 + 中转结算户（法币）+ 入方客户钱包——提交时解析落库，批准时不再查。 */
  private async resolveRoute(asset: any, toWalletId: string) {
    const from = await this.systemWallets.resolve(asset.id, 'F_OPS');
    const via = asset.type === 'FIAT' ? await this.systemWallets.resolve(asset.id, 'F_SET') : null;
    return { fromWalletId: from.id as string, viaWalletId: (via?.id as string | undefined) ?? null, toWalletId };
  }

  private async submitForApproval(row: any, impact: string, reason: string, actor: ApprovalActorContext, extra: Record<string, unknown>) {
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL,
        entityRef: row.transferNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          transferNo: row.transferNo, purpose: row.purpose, customerNo: row.customerNo,
          amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals), currency: row.asset.currency,
          sourceCaseNo: row.sourceCaseNo, ...extra, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await (this.prisma as any).internalTransfer.update({ where: { transferNo: row.transferNo }, data: { approvalNo: approval.approvalNo } });
    await this.transferAudit({ ...row, approvalNo: approval.approvalNo }, {
      action: AuditActions.INTERNAL_TRANSFER_REQUESTED, reason, approvalNo: approval.approvalNo,
      metadata: { impact, sourceExternalRef: (extra as any).externalRef ?? null }, actor,
    });
    return { transferNo: row.transferNo as string, approvalNo: approval.approvalNo as string, status: InternalTransferStatus.PENDING_APPROVAL };
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(transferNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.transfers.findByNo(transferNo);
    if (row.status !== InternalTransferStatus.PENDING_APPROVAL) throw new BadRequestException(`Transfer ${transferNo} is already in ${row.status} — funds are in flight or settled, it cannot be cancelled`);
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason } as any, actor);
    const updated = await this.transfers.transition(transferNo, InternalTransferStatus.CANCELLED, { failureNote: dto.reason });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { transferNo, status: updated.status as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.internal-transfer.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'CANCELLED') return; // 撤回由 cancel() 自己收口（它先撤审批单再翻状态）
    let row: any;
    try { row = await this.transfers.findByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (row.status !== InternalTransferStatus.PENDING_APPROVAL) return;

    if (event.decision !== 'APPROVED') {
      const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
      const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.REJECTED, { failureNote: note });
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 批准时再查一次运营户余额（提交查一次、批准查一次——与 B 批退汇同一纪律）
    const amountMinor = majorToMinor(row.amount, row.asset.decimals);
    try {
      await this.transfers.assertFirmOpsBalance(row.asset.currency, amountMinor);
    } catch (err) {
      const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE', failureNote: (err as Error).message });
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'INSUFFICIENT_FIRM_BALANCE', reason: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    const leg = await this.createLeg(row, 1);
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.EXECUTING, { executedAt: new Date() });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_EXECUTION_STARTED, reason: 'Approved by CFO, first leg funds order created', approvalNo: event.approvalNo, causationId: event.approvalId, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  /** 腿 1：法币 运营户 → 结算户 / 加密币 运营户 → 客户；腿 2（法币）：结算户 → 客户。资金单在此诞生（spec §4）。 */
  private async createLeg(row: any, legSeq: 1 | 2) {
    const isFiat = row.asset.type === 'FIAT';
    const fromId = legSeq === 1 ? row.fromWalletId : row.viaWalletId;
    const toId = isFiat && legSeq === 1 ? row.viaWalletId : row.toWalletId;
    const [from, to] = await Promise.all([
      (this.prisma as any).wallet.findUnique({ where: { id: fromId } }),
      (this.prisma as any).wallet.findUnique({ where: { id: toId } }),
    ]);
    return this.fundsOrders.create({
      internalTransferId: row.id, legSeq, initialStatus: FundsOrderStatus.CREATED,
      assetId: row.assetId, amount: String(row.amount), netAmount: String(row.amount),
      fromWalletId: from?.id ?? null, fromAddress: from?.address ?? null, fromIban: from?.iban ?? null,
      toWalletId: to?.id ?? null, toAddress: to?.address ?? null, toIban: to?.iban ?? null,
      traceId: row.traceId ?? undefined,
    });
  }

  // ── 腿事件 ───────────────────────────────────────────────────────────

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.internalTransferId) return;
    const row = await (this.prisma as any).internalTransfer.findUnique({ where: { id: event.parent.internalTransferId }, include: { asset: true } });
    if (!row) return;
    const leg = await this.fundsOrders.findById(event.fundsOrderId);
    if (!leg) return;
    switch (event.newStatus) {
      case FundsOrderStatus.SUBMITTED: await this.onLegSubmitted(row, leg); break;
      case FundsOrderStatus.CONFIRMED: await this.onLegConfirmed(row, leg); break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT: await this.onLegFailed(row, leg, event.newStatus); break;
      default: break;
    }
  }

  /** 提交那一步就铸参考号（镜像行与落账同号，对账 Pass 1 精确配对），随后模拟托管方写两行对账单。 */
  private async onLegSubmitted(row: any, leg: any) {
    const isCrypto = (row.asset.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO';
    const patch = isCrypto
      ? (leg.txHash ? {} : { txHash: fakeChainTxHash(leg.fundsOrderNo) })
      : (leg.referenceNo ? {} : { referenceNo: fakeBankRef(leg.fundsOrderNo, leg.createdAt ?? new Date()) });
    if (Object.keys(patch).length) await (this.prisma as any).fundsOrder.update({ where: { id: leg.id }, data: patch });
    const stamped = { ...leg, ...patch }; // 不依赖 update 的返回形状——真 Prisma 回整行，mock 未必
    const externalRef = this.fundsOrders.resolveExternalRef({ ...stamped, asset: row.asset }) ?? stamped.fundsOrderNo;
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: stamped.fundsOrderNo, fromWalletId: stamped.fromWalletId, toWalletId: stamped.toWalletId,
      assetCode: row.asset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(stamped.amount, row.asset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — internal transfer ${row.transferNo} leg ${stamped.legSeq}`,
    });
  }

  /** 先账后状态：分录先落，再收口清算；法币腿 1 落完建腿 2；最后一腿落完订单 SUCCESS。落账失败：停在原地，不重试。 */
  private async onLegConfirmed(row: any, leg: any) {
    if (row.status !== InternalTransferStatus.EXECUTING) return;
    const isFiat = row.asset.type === 'FIAT';
    const finalLeg = !isFiat || leg.legSeq === 2;
    try {
      if (isFiat && leg.legSeq === 1) await this.postOpsToSet(row, leg);
      else await this.postFinalLeg(row, leg);
    } catch (err) {
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'POSTING_FAILED', reason: `Leg ${leg.legSeq} posting failed: ${(err as Error).message} — the order remains in Executing, the leg remains Confirmed, no retry`, fundsOrderNo: leg.fundsOrderNo });
      return;
    }
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'INTERNAL_TRANSFER_WORKFLOW');
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_LEG_POSTED, reason: `Leg ${leg.legSeq} confirmed, entries posted and cleared`, fundsOrderNo: leg.fundsOrderNo, metadata: { legSeq: leg.legSeq } });
    if (!finalLeg) { await this.createLeg(row, 2); return; }
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.SUCCESS, { settledAt: new Date() });
    await this.transferAudit(row, {
      action: AuditActions.INTERNAL_TRANSFER_SETTLED,
      reason: row.purpose === 'CLIENT_COMPENSATION' ? 'Compensation received, customer balance restored' : 'Advance received, customer available balance now covers the recalled amount',
      fromStatus: row.status, toStatus: updated.status,
    });
  }

  private async onLegFailed(row: any, leg: any, newStatus: string) {
    if (row.status !== InternalTransferStatus.EXECUTING) return;
    const note = row.asset.type === 'FIAT' && leg.legSeq === 2
      ? `Leg 2 ${newStatus}: funds remain in the settlement account, Treasury to handle manually (leg 1 already posted, books match funds)`
      : `Leg ${leg.legSeq} ${newStatus}: no funds moved, this can be reinitiated`;
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'LEG_FAILED', failureNote: note });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'LEG_FAILED', reason: note, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  // ── 分录（spec §5）────────────────────────────────────────────────────

  private async accounts(row: any) {
    const ledger = TB_LEDGERS[row.asset.currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`Unable to resolve a ledger for asset ${row.asset.code} (currency=${row.asset.currency})`);
    const sys = (code: number) => this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
    return {
      ledger,
      firmOps: () => sys(TB_ACCOUNT_CODES.FIRM_OPS),
      firmSet: () => sys(TB_ACCOUNT_CODES.FIRM_SET),
      firmAsset: () => sys(TB_ACCOUNT_CODES.FIRM_ASSET),
      clientAsset: () => sys(TB_ACCOUNT_CODES.CLIENT_ASSET),
      clientPayable: () => this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: row.customerId }),
    };
  }

  private evidence(row: any, leg: any, eventCode: string, debitCode: number, creditCode: number, debitWalletRef: string, creditWalletRef: string) {
    return {
      sourceType: 'INTERNAL_TRANSFER', sourceNo: row.transferNo, eventCode, traceId: row.traceId,
      debitCode: TB_CODE_TO_COA[debitCode], creditCode: TB_CODE_TO_COA[creditCode],
      assetCurrency: row.asset.currency, // ⚠ currency 不是 code（USDT-TRON vs USDT）
      actorType: 'SYSTEM', actorId: 'INTERNAL_TRANSFER_WORKFLOW',
      memo: `${row.purpose === 'CLIENT_COMPENSATION' ? 'Compensation' : 'Advance'} ${row.transferNo} leg ${leg.legSeq} (case ${row.sourceCaseNo})`,
      debitWalletRef, creditWalletRef,
      externalRef: this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset }),
      isExternalCrossing: true,
    };
  }

  /** 法币腿 1：借 运营户 / 贷 结算户（81）——出方运营户行、入方结算户行；公司资产总量不变。 */
  private async postOpsToSet(row: any, leg: any) {
    const a = await this.accounts(row);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await a.firmOps(), creditAccountId: await a.firmSet(), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET,
      evidence: this.evidence(row, leg, 'INTERNAL_TRANSFER_OPS_TO_SET', TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_SET, row.fromWalletId, row.viaWalletId),
    });
  }

  /** 最后一腿（法币腿 2 / 加密币腿 1）：公司放出（82）+ 客户收到（83），一步两笔，任一失败整步失败。 */
  private async postFinalLeg(row: any, leg: any) {
    const a = await this.accounts(row);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    const isFiat = row.asset.type === 'FIAT';
    const firmCode = isFiat ? TB_ACCOUNT_CODES.FIRM_SET : TB_ACCOUNT_CODES.FIRM_OPS;
    const firmWallet = isFiat ? row.viaWalletId : row.fromWalletId;
    await this.accounting.executeTransfer({
      debitAccountId: isFiat ? await a.firmSet() : await a.firmOps(), creditAccountId: await a.firmAsset(), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT,
      evidence: this.evidence(row, leg, 'INTERNAL_TRANSFER_FIRM_OUT', firmCode, TB_ACCOUNT_CODES.FIRM_ASSET, firmWallet, firmWallet),
    });
    // 客户侧事件码按用途分——客户端对账单靠它显示「平台补款 / 平台垫付」（spec §11）
    const clientEvent = row.purpose === 'CLIENT_COMPENSATION' ? 'INTERNAL_TRANSFER_COMPENSATION_IN' : 'INTERNAL_TRANSFER_ADVANCE_IN';
    await this.accounting.executeTransfer({
      debitAccountId: await a.clientAsset(), creditAccountId: await a.clientPayable(), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN,
      evidence: this.evidence(row, leg, clientEvent, TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.CLIENT_PAYABLE, row.toWalletId, row.toWalletId),
    });
  }

  // ── 审计（七码共用信封）──────────────────────────────────────────────

  private async transferAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INTERNAL_TRANSFER, subjectNo: row.transferNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: 'CUSTOMER', subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER },
      { subjectType: 'RECONCILIATION_CASE', subjectNo: row.sourceCaseNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (row.sourceAdjustmentNo) subjects.push({ subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.sourceAdjustmentNo, subjectRole: AuditSubjectRole.RELATED });
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: 'FUNDS_ORDER', subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    const decimals = row.asset?.decimals ?? 0;
    const input: any = {
      action: patch.action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.INTERNAL_TRANSFER,
      primarySubjectType: AuditEntityTypes.INTERNAL_TRANSFER, primarySubjectNo: row.transferNo,
      ownerCustomerNo: row.customerNo, subjects,
      outcome: patch.outcome, reasonCode: patch.reasonCode, reason: patch.reason,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      amount: new Prisma.Decimal(row.amount).toFixed(decimals),
      effectiveDate: toBusinessDate(new Date()),
      // REQUESTED 起划转单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）
      ...(patch.action === AuditActions.INTERNAL_TRANSFER_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.transferNo}_${randomUUID()}`,
      metadata: { transferNo: row.transferNo, purpose: row.purpose, sourceCaseNo: row.sourceCaseNo, sourceAdjustmentNo: row.sourceAdjustmentNo ?? null, fundsOrderNo: patch.fundsOrderNo ?? null, ...(patch.metadata ?? {}) },
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
