// 戊波二 T5 · 公司调拨单 workflow：建单守卫 / 审批裁决 / 单腿建与推 / 落账（码 89，手续费户 → 运营户再加码 90）/ 撤回。
// 公司自己的钱只在运营户（F_OPS）与手续费户（F_FEE）之间挪（总纲裁定 2、4）；用途是单上的标签，本波只有 FEE_SWEEP。
// 单腿（from → to 两只公司钱包，CREATED 出生，走正常出金那套推进，SUBMIT / CONFIRM 由资金单页 ⚡ 驱动，
// 本 workflow 只接 handleFundsOrderChanged 的 SUBMITTED / CONFIRMED / FAILED / TIMEOUT）——腿的推法照付款单腿
// （spec §11），腿提交时模拟托管方两侧都写外部行（两只钱包都是我们的）。腿确认即落账：回单先于落账、先账后状态，
// 落账失败（TB 拒 89 或任一笔 90）停在原地不重试不补偿（铁律⑤ + 禁做清单），只写 FAILED(POSTING_FAILED)。
// 扫费同额结转（码 90）：仅 from = F_FEE 且 to = F_OPS——总额 = min(调拨金额, Σ 收入户余额)，按码序 210 → 211 → 212，
// 规划见 house-transfer-fee-close.ts（纯函数）；理由见总纲附录 A「不变量」与 spec 裁定 5 / 13。
// 铁律③各管各的：本文件只调 HouseTransferService / AccountingService / FundsOrderService / FirmWalletPickerService /
// SimulatedCustodianStatementService / PrudentialService 的公开方法，不直写域外表（读 asset 行是横向读，放行）。
// NLA 算术门只在 from = 运营户时过（运营户不动就不过，spec 裁定 12）。
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
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { toBusinessDate } from '../../accounting/tigerbeetle/utils/business-date.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { FirmWalletPickerService } from '../../funds-layer/domain/firm-wallet-picker.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';
import { SimulatedCustodianStatementService } from '../../clearing-settle/reconciliation/simulation/simulated-custodian-statement.service';
import { PrudentialService } from '../prudential/prudential.service';
import { HouseTransferService } from './house-transfer.service';
import { HouseTransferStatus } from './dto/house-transfer.dto';
import { FEE_INCOME_CLOSE_SEQUENCE, FeeIncomeCloseStep, planFeeIncomeClose } from './house-transfer-fee-close';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string; fundsOrderNo: string;
  parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string; internalTransferId?: string; lpExchangeId?: string; capitalInjectionId?: string; vendorPaymentId?: string; houseTransferId?: string };
  legSeq: number; attempt: number; oldStatus: string | null; newStatus: string; traceId?: string;
}

/** initiate() 入参——只认业务键（资产 id）与金库在表单里选的两只公司钱包（由本 workflow 经 FirmWalletPickerService 验过再落库）。 */
export interface InitiateHouseTransferInput {
  purpose: string;
  assetId: string;
  amount: string; // 元
  fromWalletId: string;
  toWalletId: string;
  reason: string;
}

const PURPOSE_LABELS: Record<string, string> = { FEE_SWEEP: 'fee sweep' };

const majorToMinor = (amount: Prisma.Decimal | string, decimals: number): bigint =>
  BigInt(new Prisma.Decimal(amount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

/** 手续费户 → 运营户：这条路才有扫费同额结转（码 90）。 */
const isFeeSweepRoute = (row: { fromWallet?: { vaultCode?: string | null } | null; toWallet?: { vaultCode?: string | null } | null }): boolean =>
  row.fromWallet?.vaultCode === 'F_FEE' && row.toWallet?.vaultCode === 'F_OPS';

@Injectable()
export class HouseTransferWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly houseTransfers: HouseTransferService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly firmWallets: FirmWalletPickerService,
    private readonly custodianStatement: SimulatedCustodianStatementService,
    private readonly prudential: PrudentialService,
  ) {}

  // ── 发起（金库，CFO 单步批）──────────────────────────────────────────

  async initiate(dto: InitiateHouseTransferInput, actor: ApprovalActorContext) {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset not found: ${dto.assetId}`);
    if (dto.fromWalletId === dto.toWalletId) {
      throw new BadRequestException('From and to must be two different wallets — a house transfer moves money between the operating wallet and the fee wallet');
    }

    // 守卫顺序：两只钱包配不配（运营户 / 手续费户，其余 400）→ from 余额闸（付得起）→ NLA 门（付完还合规）。
    const fromWallet = await this.firmWallets.assertEligible(dto.fromWalletId, dto.assetId);
    const toWallet = await this.firmWallets.assertEligible(dto.toWalletId, dto.assetId);
    const amountMinor = majorToMinor(dto.amount, asset.decimals);
    await this.assertFromBalance(asset, dto.fromWalletId, amountMinor);
    // NLA 只算运营户（spec §2 不做：公式口径不改）——from = 手续费户时运营户不动，不过门（裁定 12）；
    // 调拨单没有外部对手方，对手方装 to 钱包号（PrudentialService.assertPostOutflowCompliant 入参注释同约定）。
    if (fromWallet.vaultCode === 'F_OPS') {
      await this.prudential.assertPostOutflowCompliant({
        currency: asset.currency as 'AED' | 'USDT', amountMinor, orderKind: 'HOUSE_TRANSFER',
        counterpartyNo: toWallet.walletNo as string, assetNo: asset.assetNo, actor,
      });
    }

    const row = await this.houseTransfers.create({
      purpose: dto.purpose, assetId: dto.assetId, amount: dto.amount,
      fromWalletId: dto.fromWalletId, toWalletId: dto.toWalletId, reason: dto.reason,
      createdByUserId: actor.userNo ?? actor.userId,
    });

    const amountFormatted = new Prisma.Decimal(dto.amount).toFixed(asset.decimals);
    const kindOf = (w: { vaultCode?: string | null }) => (w.vaultCode === 'F_OPS' ? 'operating' : 'fee');
    const impact = `Move ${amountFormatted} ${asset.currency} from the ${kindOf(fromWallet)} wallet ${fromWallet.walletNo} to the ${kindOf(toWallet)} wallet ${toWallet.walletNo} `
      + `(purpose: ${PURPOSE_LABELS[dto.purpose] ?? dto.purpose}); `
      + (isFeeSweepRoute({ fromWallet, toWallet })
        ? `the matching fee income (up to the amount moved) is closed into firm equity, so the operating balance stays backed by equity`
        : `the ${asset.currency} ${kindOf(fromWallet)} balance decreases accordingly`);

    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.HOUSE_TRANSFER_APPROVAL,
        entityRef: row.transferNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染；两只钱包只给业务键 walletNo。
        objectSnapshot: {
          transferNo: row.transferNo, purpose: row.purpose,
          fromWalletNo: fromWallet.walletNo, toWalletNo: toWallet.walletNo,
          amount: `${amountFormatted} ${asset.currency}`, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await this.houseTransfers.stampApprovalNo(row.transferNo, approval.approvalNo);
    await this.transferAudit({ ...row, asset, approvalNo: approval.approvalNo }, {
      action: AuditActions.HOUSE_TRANSFER_REQUESTED, reason: dto.reason, approvalNo: approval.approvalNo,
      metadata: { impact, purpose: dto.purpose, fromWalletNo: fromWallet.walletNo, toWalletNo: toWallet.walletNo }, actor, // 人选的两只钱包进审计（铁律①）
    });
    return { transferNo: row.transferNo as string, approvalNo: approval.approvalNo as string, status: HouseTransferStatus.PENDING_APPROVAL };
  }

  /** from 钱包余额闸（出生守卫 / 批准时复核共用）：人选的那只钱包的现金户够不够出。闸本体是
   *  AccountingService.assertWalletBalance（戊波二 T3：各单据共用的唯一一份）。 */
  private async assertFromBalance(asset: { currency: string }, fromWalletId: string, amountMinor: bigint): Promise<void> {
    await this.accounting.assertWalletBalance(fromWalletId, this.ledgerOf(asset.currency), amountMinor);
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(transferNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.houseTransfers.findByNo(transferNo);
    if (row.status !== HouseTransferStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`House transfer ${transferNo} is already in ${row.status} — funds are in flight or settled, it cannot be cancelled`);
    }
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason }, actor);
    const updated = await this.houseTransfers.transition(transferNo, HouseTransferStatus.CANCELLED, {});
    await this.transferAudit(row, { action: AuditActions.HOUSE_TRANSFER_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { transferNo, status: updated.status as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.house-transfer.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'CANCELLED') return; // 撤回由 cancel() 自己收口（它先撤审批单再翻状态）
    let row: any;
    try { row = await this.houseTransfers.findByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (row.status !== HouseTransferStatus.PENDING_APPROVAL) return;

    if (event.decision !== 'APPROVED') {
      const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
      const updated = await this.houseTransfers.transition(row.transferNo, HouseTransferStatus.REJECTED, { failureNote: note });
      await this.transferAudit(row, { action: AuditActions.HOUSE_TRANSFER_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 批准时再查一次 from 钱包余额（提交查一次、批准查一次——与划转 / 付款单同一纪律）。
    try {
      await this.assertFromBalance(row.asset, row.fromWalletId, majorToMinor(row.amount, row.asset.decimals));
    } catch (err) {
      await this.markFailed(row, { reasonCode: 'INSUFFICIENT_FIRM_BALANCE', note: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId, moveToFailed: true });
      return;
    }

    const leg = await this.createLeg(row);
    const updated = await this.houseTransfers.transition(row.transferNo, HouseTransferStatus.EXECUTING, { executedAt: new Date(), fundsOrderNo: leg.fundsOrderNo });
    await this.transferAudit(row, { action: AuditActions.HOUSE_TRANSFER_EXECUTION_STARTED, reason: 'Approved by CFO, transfer leg funds order created', approvalNo: event.approvalNo, causationId: event.approvalId, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  /** 唯一一条腿：from 钱包 → to 钱包（两只都是我们的公司钱包）。CREATED 出生，走正常出金那套推进
   *  （SUBMIT / CONFIRM 由资金单页 ⚡ 驱动，本 workflow 只接 handleFundsOrderChanged）。 */
  private createLeg(row: any) {
    return this.fundsOrders.create({
      houseTransferId: row.id, legSeq: 1, initialStatus: FundsOrderStatus.CREATED,
      assetId: row.assetId, amount: String(row.amount), netAmount: String(row.amount),
      fromWalletId: row.fromWalletId, fromAddress: row.fromWallet?.address ?? null, fromIban: row.fromWallet?.iban ?? null,
      toWalletId: row.toWalletId, toAddress: row.toWallet?.address ?? null, toIban: row.toWallet?.iban ?? null,
      traceId: row.traceId ?? undefined,
    });
  }

  // ── 腿事件 ───────────────────────────────────────────────────────────

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.houseTransferId) return;
    const row = await this.houseTransfers.findById(event.parent.houseTransferId);
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

  /** 提交那一步就铸参考号（镜像行与落账同号，对账 Pass 1 精确配对），随后模拟托管方写两侧外部行——
   *  两只钱包都是我们的，from 一行 OUT、to 一行 IN（照划转腿先例），运营户与手续费户的对账都配得上。 */
  private async onLegSubmitted(row: any, leg: any) {
    const isCrypto = row.asset.type === 'CRYPTO';
    const patch = await this.fundsOrders.stampExternalRef(leg.id);
    const stamped = { ...leg, ...(patch ?? {}) };
    const externalRef = this.fundsOrders.resolveExternalRef({ ...stamped, asset: row.asset }) ?? stamped.fundsOrderNo;
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: stamped.fundsOrderNo, fromWalletId: stamped.fromWalletId, toWalletId: stamped.toWalletId,
      assetCode: row.asset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(stamped.amount, row.asset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — house transfer ${row.transferNo} (${row.fromWallet?.walletNo ?? '-'} → ${row.toWallet?.walletNo ?? '-'})`,
    });
  }

  /** 先账后状态：89（再加 90）先落，再收口清算，单腿直达 SUCCESS；落账失败停在原地不重试（铁律⑤）。 */
  private async onLegConfirmed(row: any, leg: any) {
    if (row.status !== HouseTransferStatus.EXECUTING) return;
    let posted: { closeIds: string[]; steps: FeeIncomeCloseStep[] };
    try {
      posted = await this.postLeg(row, leg);
    } catch (err) {
      await this.markFailed(row, {
        reasonCode: 'POSTING_FAILED', fundsOrderNo: leg.fundsOrderNo, moveToFailed: false,
        note: `Leg posting failed: ${(err as Error).message} — the order remains in Executing, the leg remains Confirmed, no retry`,
      });
      return;
    }
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'HOUSE_TRANSFER_WORKFLOW');
    await this.transferAudit(row, {
      action: AuditActions.HOUSE_TRANSFER_LEG_POSTED, reason: 'Leg confirmed, entries posted and cleared', fundsOrderNo: leg.fundsOrderNo,
      metadata: { legSeq: leg.legSeq, closeTbTransferIds: posted.closeIds, closedIncomeCodes: posted.steps.map((s) => s.code), closedAmountMinor: posted.steps.reduce((a, s) => a + s.amountMinor, 0n).toString() },
    });
    const updated = await this.houseTransfers.transition(row.transferNo, HouseTransferStatus.SUCCESS, {
      settledAt: new Date(),
      ...(posted.closeIds.length > 0 && { closeTbTransferIds: JSON.stringify(posted.closeIds) }),
    });
    await this.transferAudit(row, {
      action: AuditActions.HOUSE_TRANSFER_SETTLED, reason: 'Transfer settled, the destination wallet received the funds',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status,
    });
  }

  private async onLegFailed(row: any, leg: any, newStatus: string) {
    if (row.status !== HouseTransferStatus.EXECUTING) return;
    await this.markFailed(row, {
      reasonCode: 'LEG_FAILED', fundsOrderNo: leg.fundsOrderNo, moveToFailed: true,
      note: `Transfer leg ${newStatus}: no funds moved between the wallets, this transfer can be reinitiated`,
    });
  }

  /** 唯一的 FAILED 写点：批准时余额不足 / 腿失败 → 迁 FAILED；落账失败 → 单停 EXECUTING，只把原因记在行上。 */
  private async markFailed(row: any, args: { reasonCode: string; note: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string; moveToFailed: boolean }) {
    let toStatus: string | undefined;
    if (args.moveToFailed) {
      const updated = await this.houseTransfers.transition(row.transferNo, HouseTransferStatus.FAILED, { failureReasonCode: args.reasonCode, failureNote: args.note });
      toStatus = updated.status;
    } else {
      await this.houseTransfers.stampFailure(row.transferNo, args.reasonCode, args.note);
    }
    await this.transferAudit(row, {
      action: AuditActions.HOUSE_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: args.reasonCode, reason: args.note,
      approvalNo: args.approvalNo, causationId: args.causationId, fundsOrderNo: args.fundsOrderNo,
      ...(args.moveToFailed && { fromStatus: row.status, toStatus }),
    });
  }

  // ── 分录（89 / 90，戊波二·附录 B「公司钱包间调拨」）─────────────────────

  private ledgerOf(currency: string): number {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`Unable to resolve a ledger for currency ${currency}`);
    return ledger;
  }

  private evidence(row: any, eventCode: string, debitCode: number, creditCode: number, memo: string, externalRef?: string | null) {
    return {
      sourceType: 'HOUSE_TRANSFER', sourceNo: row.transferNo, eventCode, traceId: row.traceId,
      debitCode: TB_CODE_TO_COA[debitCode], creditCode: TB_CODE_TO_COA[creditCode],
      assetCurrency: row.asset.currency, // ⚠ currency 不是 code（USDT-TRON vs USDT）
      actorType: 'SYSTEM', actorId: 'HOUSE_TRANSFER_WORKFLOW', memo,
      ...(externalRef !== undefined && { externalRef }),
    };
  }

  /** 码 89：借 现金·to 钱包 / 贷 现金·from 钱包（两只都是公司现金户 A.FIRM_CASH）。仅手续费户 → 运营户，紧接着码 90：
   *  借 收入（210 / 211 / 212，按规划每户至多一笔）/ 贷 公司权益 200，同一步，任一笔被账本拒整步失败。
   *  返回 90 的转账号（落账顺序，十六进制）与规划，供回执与审计。 */
  private async postLeg(row: any, leg: any): Promise<{ closeIds: string[]; steps: FeeIncomeCloseStep[] }> {
    const ledger = this.ledgerOf(row.asset.currency);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await this.accounting.resolveCashAccountId(row.toWalletId, ledger),
      creditAccountId: await this.accounting.resolveCashAccountId(row.fromWalletId, ledger),
      amount, ledger, code: TB_TRANSFER_CODES.HOUSE_TRANSFER,
      evidence: this.evidence(row, 'HOUSE_TRANSFER', TB_ACCOUNT_CODES.FIRM_CASH, TB_ACCOUNT_CODES.FIRM_CASH,
        `House transfer ${row.transferNo} confirmed (${row.fromWallet?.walletNo ?? '-'} → ${row.toWallet?.walletNo ?? '-'})`,
        this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset })),
    });
    if (!isFeeSweepRoute(row)) return { closeIds: [], steps: [] };

    // 读 210 / 211 / 212 在该资产账本上的已过账余额（贷 − 借），规划只扣到够为止（封顶在 Σ 收入）。
    const incomeIds = new Map<number, bigint>();
    const balances: Record<number, bigint> = {};
    for (const { code } of FEE_INCOME_CLOSE_SEQUENCE) {
      const id = await this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
      const b = await this.accounting.lookupBalance(id);
      incomeIds.set(code, id);
      balances[code] = b.creditsPosted - b.debitsPosted;
    }
    const steps = planFeeIncomeClose(amount, balances);
    if (steps.length === 0) return { closeIds: [], steps };
    const equityId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger, ownerType: 'SYSTEM' });
    const closeIds: string[] = [];
    for (const step of steps) {
      const { tbTransferId } = await this.accounting.executeTransfer({
        debitAccountId: incomeIds.get(step.code) as bigint, creditAccountId: equityId,
        amount: step.amountMinor, ledger, code: TB_TRANSFER_CODES.FEE_INCOME_CLOSE,
        evidence: this.evidence(row, step.eventCode, step.code, TB_ACCOUNT_CODES.FIRM_EQUITY,
          `Fee income close ${row.transferNo} (${TB_CODE_TO_COA[step.code]} → company equity)`),
      });
      closeIds.push(bigintToHex(tbTransferId));
    }
    return { closeIds, steps };
  }

  // ── 审计（七码共用信封，照 paymentAudit 改写）─────────────────────────
  // 主体信封：primarySubject=HOUSE_TRANSFER·transferNo，subjects 加 from / to 钱包 WALLET RELATED（横向 subject，铁律③放行）
  // + 审批单 INSTRUMENT + 资金单 RELATED。调拨单没有客户，不挂 OWNER。

  private async transferAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.HOUSE_TRANSFER, subjectNo: row.transferNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (row.fromWallet?.walletNo) subjects.push({ subjectType: AuditEntityTypes.WALLET, subjectNo: row.fromWallet.walletNo, subjectRole: AuditSubjectRole.RELATED });
    if (row.toWallet?.walletNo) subjects.push({ subjectType: AuditEntityTypes.WALLET, subjectNo: row.toWallet.walletNo, subjectRole: AuditSubjectRole.RELATED });
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    const amountFormatted = new Prisma.Decimal(row.amount).toFixed(row.asset.decimals);
    const input: any = {
      action: patch.action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.HOUSE_TRANSFER,
      primarySubjectType: AuditEntityTypes.HOUSE_TRANSFER, primarySubjectNo: row.transferNo,
      subjects,
      outcome: patch.outcome, reasonCode: patch.reasonCode, reason: patch.reason,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      amount: amountFormatted,
      effectiveDate: toBusinessDate(new Date()),
      // REQUESTED 起调拨单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）。
      ...(patch.action === AuditActions.HOUSE_TRANSFER_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.transferNo}_${randomUUID()}`,
      metadata: {
        transferNo: row.transferNo, purpose: row.purpose,
        fromWalletNo: row.fromWallet?.walletNo ?? null, toWalletNo: row.toWallet?.walletNo ?? null,
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
