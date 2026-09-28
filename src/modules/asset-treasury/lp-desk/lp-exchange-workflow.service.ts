// 战役乙波一 T5 · LP 兑换 workflow（本波心脏）：审批裁决 / 三腿落账(84/85/86) / 验收 / ⚡到货。
// 先款后货：批准即建卖出腿（腿 1，付给 LP，外穿）；腿 1 清算后进悬空期（等 LP 发货）；
// LP 打款落前厅为腿 2（⚡simulateDelivery，同一动作内建单+落账+advance+审计，直达
// CONFIRMED——照充值域 fiat-at-birth 模拟推腿先例）；验收（accept）建腿 3（内转
// F_LIQ → F_OPS，不外穿）。铁律③各管各的：本文件只调 LpExchangeService/LpProfileService
// 的公开方法、AccountingService/FundsOrderService/SystemWalletResolver/
// SimulatedCustodianStatementService，不直写域外表——唯一例外是按事件带的内部 id 读
// LpExchange 行（事件只带 id，主体服务只暴露按业务号查，照 InternalTransferWorkflowService
// .handleFundsOrderChanged 先例，横向读放行）。全部落账动作先账后状态，落账失败停在
// 原地不重试（照划转单 onLegConfirmed 纪律）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { LpExchangeService } from './lp-exchange.service';
import { LpProfileService } from './lp-profile.service';
import { LpExchangeStatus } from './dto/lp-exchange.dto';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string; fundsOrderNo: string;
  parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string; internalTransferId?: string; lpExchangeId?: string };
  legSeq: number; attempt: number; oldStatus: string | null; newStatus: string; traceId?: string;
}

/** initiate() 入参——只认业务键（lpNo/资产 id），零 UUID 由调用方外部拼；三个钱包 id 由
 *  本 workflow 解析（照 T4 CreateLpExchangeInput 的分工：主体服务不解析钱包）。 */
export interface InitiateLpExchangeInput {
  lpNo: string;
  sellAssetId: string;
  sellAmount: string; // 元
  buyAssetId: string;
  buyAmount: string; // 元
  prudentialPurpose: string;
  reason: string;
  traceId?: string | null;
}

const majorToMinor = (amount: Prisma.Decimal | string, decimals: number): bigint =>
  BigInt(new Prisma.Decimal(amount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

@Injectable()
export class LpExchangeWorkflowService {
  private readonly logger = new Logger(LpExchangeWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchanges: LpExchangeService,
    private readonly lpProfiles: LpProfileService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly custodianStatement: SimulatedCustodianStatementService,
  ) {}

  // ── 发起（金库，CFO 单步批）──────────────────────────────────────────

  async initiate(dto: InitiateLpExchangeInput, actor: ApprovalActorContext) {
    await this.lpProfiles.assertActiveByNo(dto.lpNo);
    const profile = await this.lpProfiles.findByNo(dto.lpNo);
    const [sellAsset, buyAsset] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: dto.sellAssetId } }),
      this.prisma.asset.findUnique({ where: { id: dto.buyAssetId } }),
    ]);
    if (!sellAsset) throw new NotFoundException(`Asset not found: ${dto.sellAssetId}`);
    if (!buyAsset) throw new NotFoundException(`Asset not found: ${dto.buyAssetId}`);

    const sellAmountMinor = majorToMinor(dto.sellAmount, sellAsset.decimals);
    await this.exchanges.assertFirmOpsBalance(sellAsset.currency, sellAmountMinor);

    const [sellFrom, buyVia, buyTo] = await Promise.all([
      this.systemWallets.resolve(dto.sellAssetId, 'F_OPS'),
      this.systemWallets.resolve(dto.buyAssetId, 'F_LIQ'),
      this.systemWallets.resolve(dto.buyAssetId, 'F_OPS'),
    ]);

    const row = await this.exchanges.create({
      lpNo: dto.lpNo, sellAssetId: dto.sellAssetId, sellAmount: dto.sellAmount,
      buyAssetId: dto.buyAssetId, buyAmount: dto.buyAmount,
      prudentialPurpose: dto.prudentialPurpose, reason: dto.reason,
      sellFromWalletId: sellFrom.id as string, buyViaWalletId: buyVia.id as string, buyToWalletId: buyTo.id as string,
      traceId: dto.traceId ?? undefined, createdByUserId: actor.userNo ?? actor.userId,
    });

    const sellFormatted = new Prisma.Decimal(dto.sellAmount).toFixed(sellAsset.decimals);
    const buyFormatted = new Prisma.Decimal(dto.buyAmount).toFixed(buyAsset.decimals);
    const impact = `Sell ${sellFormatted} ${sellAsset.currency} to LP ${row.lpNo} for ${buyFormatted} ${buyAsset.currency} `
      + `(purpose: ${dto.prudentialPurpose}); the firm's ${sellAsset.currency} operating balance decreases once the sell leg clears, `
      + `and its ${buyAsset.currency} operating balance increases once the delivery is accepted`;

    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.LP_EXCHANGE_APPROVAL,
        entityRef: row.exchangeNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          exchangeNo: row.exchangeNo, lpNo: row.lpNo, lpName: profile.name,
          sell: `${sellFormatted} ${sellAsset.currency}`, buy: `${buyFormatted} ${buyAsset.currency}`,
          prudentialPurpose: dto.prudentialPurpose, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await this.exchanges.stampApprovalNo(row.exchangeNo, approval.approvalNo);
    await this.exchangeAudit({ ...row, sellAsset, buyAsset }, {
      action: AuditActions.LP_EXCHANGE_REQUESTED, reason: dto.reason, approvalNo: approval.approvalNo,
      metadata: { impact }, actor,
    });
    return { exchangeNo: row.exchangeNo as string, approvalNo: approval.approvalNo as string, status: LpExchangeStatus.PENDING_APPROVAL };
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(exchangeNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.exchanges.findByNo(exchangeNo);
    if (row.status !== LpExchangeStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`LP exchange ${exchangeNo} is already in ${row.status} — funds are in flight or settled, it cannot be cancelled`);
    }
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason }, actor);
    const updated = await this.exchanges.transition(exchangeNo, LpExchangeStatus.CANCELLED, { failureNote: dto.reason });
    await this.exchangeAudit(row, { action: AuditActions.LP_EXCHANGE_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { exchangeNo, status: updated.status as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.lp-exchange.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'CANCELLED') return; // 撤回由 cancel() 自己收口（它先撤审批单再翻状态）
    let row: any;
    try { row = await this.exchanges.findByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (row.status !== LpExchangeStatus.PENDING_APPROVAL) return;

    if (event.decision !== 'APPROVED') {
      const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
      const updated = await this.exchanges.transition(row.exchangeNo, LpExchangeStatus.REJECTED, { failureNote: note });
      await this.exchangeAudit(row, { action: AuditActions.LP_EXCHANGE_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 批准时再查一次运营户（卖出币）余额——同 InternalTransferWorkflowService.onDecided 纪律。
    const sellAmountMinor = majorToMinor(row.sellAmount, row.sellAsset.decimals);
    try {
      await this.exchanges.assertFirmOpsBalance(row.sellAsset.currency, sellAmountMinor);
    } catch (err) {
      const updated = await this.exchanges.transition(row.exchangeNo, LpExchangeStatus.FAILED, { failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE', failureNote: (err as Error).message });
      await this.exchangeAudit(row, { action: AuditActions.LP_EXCHANGE_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'INSUFFICIENT_FIRM_BALANCE', reason: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    const leg = await this.createSellLeg(row);
    const updated = await this.exchanges.transition(row.exchangeNo, LpExchangeStatus.EXECUTING, { executedAt: new Date() });
    await this.exchangeAudit(row, { action: AuditActions.LP_EXCHANGE_EXECUTION_STARTED, reason: 'Approved by CFO, sell leg funds order created', approvalNo: event.approvalNo, causationId: event.approvalId, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  /** 腿 1（卖出）：F_OPS → 外部（LP 坐标，卖出币 CRYPTO→cryptoAddress｜FIAT→fiatIban）。
   *  CREATED 出生，走正常 OUT 推进（SUBMIT/CONFIRM 由 admin ⚡模拟推进驱动，本 workflow
   *  只接 handleFundsOrderChanged 的 SUBMITTED/CONFIRMED/FAILED/TIMEOUT）。 */
  private async createSellLeg(row: any) {
    const profile = await this.lpProfiles.findByNo(row.lpNo);
    const sellFrom = await this.prisma.wallet.findUnique({ where: { id: row.sellFromWalletId } });
    const isCrypto = row.sellAsset.type === 'CRYPTO';
    return this.fundsOrders.create({
      lpExchangeId: row.id, legSeq: 1, initialStatus: FundsOrderStatus.CREATED,
      assetId: row.sellAssetId, amount: String(row.sellAmount), netAmount: String(row.sellAmount),
      fromWalletId: sellFrom?.id ?? null, fromAddress: sellFrom?.address ?? null, fromIban: sellFrom?.iban ?? null,
      toWalletId: null,
      toAddress: isCrypto ? profile.cryptoAddress : null,
      toIban: isCrypto ? null : profile.fiatIban,
      traceId: row.traceId ?? undefined,
    });
  }

  // ── 腿事件（卖出腿）───────────────────────────────────────────────────

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.lpExchangeId) return;
    const row = await this.prisma.lpExchange.findUnique({ where: { id: event.parent.lpExchangeId }, include: { sellAsset: true, buyAsset: true } });
    if (!row) return;
    const leg = await this.fundsOrders.findById(event.fundsOrderId);
    if (!leg) return;
    switch (event.newStatus) {
      case FundsOrderStatus.SUBMITTED: await this.onSellLegSubmitted(row, leg); break;
      case FundsOrderStatus.CONFIRMED: await this.onSellLegConfirmed(row, leg); break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT: await this.onSellLegFailed(row, leg, event.newStatus); break;
      default: break;
    }
  }

  /** 提交那一步铸参考号，随后模拟托管方写一行（只有 F_OPS 这一侧是我们的钱包——LP 的
   *  外部地址不落 externalBalance，recordLegMovement 的 toWalletId 传 null 只写 OUT 行）。 */
  private async onSellLegSubmitted(row: any, leg: any) {
    const isCrypto = row.sellAsset.type === 'CRYPTO';
    const patch = await this.fundsOrders.stampExternalRef(leg.id);
    const stamped = { ...leg, ...(patch ?? {}) };
    const externalRef = this.fundsOrders.resolveExternalRef({ ...stamped, asset: row.sellAsset }) ?? stamped.fundsOrderNo;
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: stamped.fundsOrderNo, fromWalletId: stamped.fromWalletId, toWalletId: null,
      assetCode: row.sellAsset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(stamped.amount, row.sellAsset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — LP exchange ${row.exchangeNo} sell leg (paid to LP ${row.lpNo})`,
    });
  }

  /** 先账后状态：84 先落，再收口清算，再翻 AWAITING_DELIVERY；落账失败停在原地不重试。 */
  private async onSellLegConfirmed(row: any, leg: any) {
    if (row.status !== LpExchangeStatus.EXECUTING) return;
    try {
      await this.postSellLeg(row, leg);
    } catch (err) {
      await this.exchangeAudit(row, { action: AuditActions.LP_EXCHANGE_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'POSTING_FAILED', reason: `Sell leg posting failed: ${(err as Error).message} — the order remains in Executing, the leg remains Confirmed, no retry`, fundsOrderNo: leg.fundsOrderNo });
      return;
    }
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'LP_EXCHANGE_WORKFLOW');
    const updated = await this.exchanges.transition(row.exchangeNo, LpExchangeStatus.AWAITING_DELIVERY);
    await this.exchangeAudit(row, {
      action: AuditActions.LP_EXCHANGE_PAY_LEG_POSTED, reason: 'Sell leg confirmed, entries posted and cleared',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status,
    });
  }

  private async onSellLegFailed(row: any, leg: any, newStatus: string) {
    if (row.status !== LpExchangeStatus.EXECUTING) return;
    const note = `Sell leg ${newStatus}: no funds paid out to the LP, this exchange can be reinitiated`;
    const updated = await this.exchanges.transition(row.exchangeNo, LpExchangeStatus.FAILED, { failureReasonCode: 'LEG_FAILED', failureNote: note });
    await this.exchangeAudit(row, { action: AuditActions.LP_EXCHANGE_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'LEG_FAILED', reason: note, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  // ── ⚡到货（腿 2）：LP 打款落前厅——同一动作内建单+落账+advance+审计 ───────────

  async simulateDelivery(exchangeNo: string, actor: ApprovalActorContext) {
    const row = await this.exchanges.findByNo(exchangeNo);
    if (row.status !== LpExchangeStatus.AWAITING_DELIVERY) {
      throw new BadRequestException(`LP exchange ${exchangeNo} is not awaiting delivery (status=${row.status})`);
    }
    const profile = await this.lpProfiles.findByNo(row.lpNo);
    const isCrypto = row.buyAsset.type === 'CRYPTO';
    // 照 deposit 域 fiat-at-birth 模拟推腿先例：initialStatus 直接落 CONFIRMED（⚡模拟动作，
    // 不走 SUBMIT/CONFIRM 两跳）；FundsOrderService.create 在 CONFIRMED 出生时自动铸 externalRef。
    const leg = await this.fundsOrders.create({
      lpExchangeId: row.id, legSeq: 2, initialStatus: FundsOrderStatus.CONFIRMED,
      assetId: row.buyAssetId, amount: String(row.buyAmount), netAmount: String(row.buyAmount),
      fromWalletId: null,
      fromAddress: isCrypto ? profile.cryptoAddress : null,
      fromIban: isCrypto ? null : profile.fiatIban,
      toWalletId: row.buyViaWalletId,
      traceId: row.traceId ?? undefined,
    });
    await this.postBuyLeg(row, leg);
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'LP_EXCHANGE_WORKFLOW');
    const externalRef = this.fundsOrders.resolveExternalRef({ ...leg, asset: row.buyAsset }) ?? leg.fundsOrderNo;
    // 对账吃进的关键行：只写 F_LIQ 这一侧（LP 的外部坐标不是我们的钱包，fromWalletId 传 null）。
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: leg.fundsOrderNo, fromWalletId: null, toWalletId: row.buyViaWalletId,
      assetCode: row.buyAsset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(leg.amount, row.buyAsset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — LP exchange ${row.exchangeNo} buy leg (received from LP ${row.lpNo})`,
    });
    const updated = await this.exchanges.transition(exchangeNo, LpExchangeStatus.DELIVERED, { deliveredAt: new Date() });
    await this.exchangeAudit(row, {
      action: AuditActions.LP_EXCHANGE_DELIVERED, reason: 'LP delivery simulated, buy leg posted to the front desk',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status, actor,
      metadata: { buyLegAmount: new Prisma.Decimal(row.buyAmount).toFixed(row.buyAsset.decimals) },
    });
    return { exchangeNo, status: updated.status as string };
  }

  // ── 验收（腿 3）：内转 F_LIQ → F_OPS，不外穿 ──────────────────────────────

  async accept(exchangeNo: string, actor: ApprovalActorContext) {
    const row = await this.exchanges.findByNo(exchangeNo);
    if (row.status !== LpExchangeStatus.DELIVERED) {
      // 迁移表天然拒二次验收（SUCCESS 零出边）；未到货同样在这里被拒（EXECUTING/AWAITING_DELIVERY）。
      throw new BadRequestException(`LP exchange ${exchangeNo} is not delivered yet (status=${row.status}) — nothing to accept`);
    }
    const buyLegs = await this.fundsOrders.findByParent({ lpExchangeId: row.id }, { legSeq: 2 });
    const receivedAmount = buyLegs[0]?.amount ?? row.buyAmount;
    const leg = await this.fundsOrders.create({
      lpExchangeId: row.id, legSeq: 3, initialStatus: FundsOrderStatus.CONFIRMED,
      assetId: row.buyAssetId, amount: String(row.buyAmount), netAmount: String(row.buyAmount),
      fromWalletId: row.buyViaWalletId, toWalletId: row.buyToWalletId,
      traceId: row.traceId ?? undefined,
    });
    await this.postAcceptLeg(row, leg);
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'LP_EXCHANGE_WORKFLOW');
    const updated = await this.exchanges.transition(exchangeNo, LpExchangeStatus.SUCCESS, { settledAt: new Date() });
    const buyFormatted = new Prisma.Decimal(row.buyAmount).toFixed(row.buyAsset.decimals);
    await this.exchangeAudit(row, {
      action: AuditActions.LP_EXCHANGE_ACCEPTED, reason: 'LP delivery accepted, buy leg transferred from the front desk to the operating account',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status, actor,
      metadata: { expected: buyFormatted, received: new Prisma.Decimal(receivedAmount).toFixed(row.buyAsset.decimals) },
    });
    return { exchangeNo, status: updated.status as string };
  }

  // ── 分录（84/85/86）───────────────────────────────────────────────────

  private ledgerOf(currency: string): number {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`Unable to resolve a ledger for currency ${currency}`);
    return ledger;
  }

  private sysAccount(ledger: number, code: number) {
    return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
  }

  private evidence(row: any, eventCode: string, debitCode: number, creditCode: number, assetCurrency: string, debitWalletRef: string | null, creditWalletRef: string | null, externalRef: string | null, isExternalCrossing: boolean, memo: string) {
    return {
      sourceType: 'LP_EXCHANGE', sourceNo: row.exchangeNo, eventCode, traceId: row.traceId,
      debitCode: TB_CODE_TO_COA[debitCode], creditCode: TB_CODE_TO_COA[creditCode],
      assetCurrency, actorType: 'SYSTEM', actorId: 'LP_EXCHANGE_WORKFLOW', memo,
      debitWalletRef, creditWalletRef, externalRef, isExternalCrossing,
    };
  }

  /** 腿 1（84）：DR FIRM_OPS / CR FIRM_ASSET，卖出币 ledger，外穿——一侧物理钱包
   *  是 sellFromWalletId（付出的那个网络行），LP 的外部坐标不是钱包，不进 walletRef。 */
  private async postSellLeg(row: any, leg: any) {
    const ledger = this.ledgerOf(row.sellAsset.currency);
    const amount = majorToMinor(leg.amount, row.sellAsset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_OPS),
      creditAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_ASSET),
      amount, ledger, code: TB_TRANSFER_CODES.LP_EXCHANGE_PAY,
      evidence: this.evidence(
        row, 'LP_EXCHANGE_PAY', TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_ASSET, row.sellAsset.currency,
        row.sellFromWalletId, row.sellFromWalletId,
        this.fundsOrders.resolveExternalRef({ ...leg, asset: row.sellAsset }), true,
        `LP exchange ${row.exchangeNo} sell leg (paid to LP ${row.lpNo})`,
      ),
    });
  }

  /** 腿 2（85）：DR FIRM_ASSET / CR FIRM_LIQ，买入币 ledger，外穿——一侧物理钱包是
   *  buyViaWalletId（LP 打来落前厅的那个网络行）。 */
  private async postBuyLeg(row: any, leg: any) {
    const ledger = this.ledgerOf(row.buyAsset.currency);
    const amount = majorToMinor(leg.amount, row.buyAsset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_ASSET),
      creditAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_LIQ),
      amount, ledger, code: TB_TRANSFER_CODES.LP_EXCHANGE_RECEIVE,
      evidence: this.evidence(
        row, 'LP_EXCHANGE_RECEIVE', TB_ACCOUNT_CODES.FIRM_ASSET, TB_ACCOUNT_CODES.FIRM_LIQ, row.buyAsset.currency,
        row.buyViaWalletId, row.buyViaWalletId,
        this.fundsOrders.resolveExternalRef({ ...leg, asset: row.buyAsset }), true,
        `LP exchange ${row.exchangeNo} buy leg (received from LP ${row.lpNo})`,
      ),
    });
  }

  /** 腿 3（86）：DR FIRM_LIQ / CR FIRM_OPS，买入币 ledger，内转不外穿——两个物理钱包都是
   *  我们自己的（buyViaWalletId → buyToWalletId），isExternalCrossing=false。 */
  private async postAcceptLeg(row: any, leg: any) {
    const ledger = this.ledgerOf(row.buyAsset.currency);
    const amount = majorToMinor(leg.amount, row.buyAsset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_LIQ),
      creditAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_OPS),
      amount, ledger, code: TB_TRANSFER_CODES.LP_EXCHANGE_ACCEPT,
      evidence: this.evidence(
        row, 'LP_EXCHANGE_ACCEPT', TB_ACCOUNT_CODES.FIRM_LIQ, TB_ACCOUNT_CODES.FIRM_OPS, row.buyAsset.currency,
        row.buyViaWalletId, row.buyToWalletId,
        this.fundsOrders.resolveExternalRef({ ...leg, asset: row.buyAsset }), false,
        `LP exchange ${row.exchangeNo} acceptance transfer (front desk → operating)`,
      ),
    });
  }

  // ── 审计（八码共用信封，照 transferAudit 改写）─────────────────────────

  /** 信封 amount 字段恒填卖出边（brief §Step8：契约 requiredFields 校验用），买入边/两数
   *  对照进 metadata（arrow 串 + 各动作各自的 metadata.* ——如 ACCEPTED 的 expected/received）。 */
  private async exchangeAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.LP_EXCHANGE, subjectNo: row.exchangeNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: AuditEntityTypes.LIQUIDITY_PROVIDER, subjectNo: row.lpNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    const sellFormatted = new Prisma.Decimal(row.sellAmount).toFixed(row.sellAsset.decimals);
    const buyFormatted = new Prisma.Decimal(row.buyAmount).toFixed(row.buyAsset.decimals);
    const input: any = {
      action: patch.action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.LP_EXCHANGE,
      primarySubjectType: AuditEntityTypes.LP_EXCHANGE, primarySubjectNo: row.exchangeNo,
      subjects,
      outcome: patch.outcome, reasonCode: patch.reasonCode, reason: patch.reason,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      amount: sellFormatted,
      effectiveDate: toBusinessDate(new Date()),
      // REQUESTED 起兑换单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）。
      ...(patch.action === AuditActions.LP_EXCHANGE_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.exchangeNo}_${randomUUID()}`,
      metadata: {
        exchangeNo: row.exchangeNo, lpNo: row.lpNo,
        amount: `${sellFormatted} ${row.sellAsset.currency} → ${buyFormatted} ${row.buyAsset.currency}`,
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
