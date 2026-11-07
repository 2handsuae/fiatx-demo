// 平账二期 · 内部划转单工作流（spec §3–§6）。铁律③：只调各主体服务方法，不直写别人的表
//（读案子 / 调账单 / 定性 / 钱包 / 资产是横向读，放行）。
// 戊波二 T7a：补款用途改名 SHORTFALL_TOPUP（认损补缺）——一张单、CFO 批一次：批准那一步记短缺
//（码 91：借 2·客户钱包 / 贷 1·客户钱包），再建腿把钱从公司钱包补进客户钱包，最后一腿 83 贷 2 消掉短缺；
// 客户应付全程不动。旧的「认损调账单 + 补款划转单」两张单两次批的走法退役。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { startOfBusinessDate, toBusinessDate } from '../../accounting/tigerbeetle/utils/business-date.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { FirmWalletPickerService } from '../../funds-layer/domain/firm-wallet-picker.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';
import { SimulatedCustodianStatementService } from '../../clearing-settle/reconciliation/simulation/simulated-custodian-statement.service';
import { SupplementEvidenceService, minorToMajor } from '../../clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { DispositionService } from '../../clearing-settle/reconciliation/disposition/disposition.service';
import { ReconciliationQueryService } from '../../clearing-settle/reconciliation/domain/reconciliation-query.service';
import { CLIENT_SHORTFALL_CAUSE } from '../../clearing-settle/reconciliation/disposition/cause-registry';
import { assertAgingWriteOffAllowed, assertIncidentWriteOffAllowed, writeOffPathOf } from '../../clearing-settle/reconciliation/disposition/write-off-guards';
import { InternalTransferService } from './internal-transfer.service';
import { InitiateShortfallTopupDto, InternalTransferStatus, ShortfallLossSource } from './dto/internal-transfer.dto';

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
    private readonly firmWallets: FirmWalletPickerService,
    private readonly dispositions: DispositionService,
    private readonly reconQuery: ReconciliationQueryService,
  ) {}

  // ── 发起（金库，案子上点）────────────────────────────────────────────────

  /**
   * 认损补缺（戊波二 spec §4.1）：托管方少了客户的钱、查无果（账龄路）或事故已定损公司承损（事故路），公司认下并把钱补进客户钱包——
   * 一张单、CFO 批一次。金额、成因、生效日都不由客户端传：账龄路取差异行的差额，事故路锁定为定损额；成因固定；生效日 = 案件业务日。
   * 守卫（顺序即错误优先级）：案 OPEN → 两路守卫（write-off-guards，与公司池核销共用）→ 阻塞 → from 钱包配不配 →
   * from 余额闸 → 客户钱包余量（待批提现的锁定会让码 91 被 TB 拒）→ 建单 → 处置记录挂 transferNo（开单即挂、行锁定）→ 提审。
   * NLA 门不过（义务性付款，照 prudential.service 既有口径）。
   */
  async initiateShortfallTopup(dto: InitiateShortfallTopupDto, actor: ApprovalActorContext) {
    if (!dto.flowId && !dto.externalLineId) {
      throw new BadRequestException('A shortfall top-up must be anchored to a difference row (its internal flow or its statement line) already found as "Hold · Investigating" or assessed as an incident loss');
    }
    const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo: dto.caseNo } });
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${dto.caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('A shortfall top-up can only be opened on an open case');
    if (kase.book === 'FIRM') throw new BadRequestException('A shortfall top-up is a client-pool action — a company-pool difference is written off with an adjustment');
    if (!kase.walletRef || kase.walletRef.startsWith('XREF:') || !kase.ownerNo) {
      throw new BadRequestException(`Case ${dto.caseNo} is not anchored to a customer wallet — a shortfall top-up can only be raised on a wallet-anchored client case`);
    }

    // 守卫：锚中定性行 → 账龄路 / 事故路（判据沿用调账单 writeOffPathOf）；金额由服务端定。
    const anchors = [
      dto.flowId ? { explainedFlowId: dto.flowId } : null,
      dto.externalLineId ? { explainedExternalLineId: dto.externalLineId } : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    const held = await this.prisma.reconciliationDisposition.findFirst({ where: { caseNo: dto.caseNo, OR: anchors } });
    const noun = 'shortfall top-up';
    let amountMinor: bigint;
    let lossSource: ShortfallLossSource;
    let sourceIncidentNo: string | null = null;
    let dispositionNo: string;
    if (writeOffPathOf(held) === 'INCIDENT') {
      // 事故路：不看账龄线 / 小额线，改查事故侧三重闸；金额锁定为定损额。
      const g = await assertIncidentWriteOffAllowed(this.prisma, { kase, held, noun, assertPairing: () => undefined });
      amountMinor = g.assessedMinor; lossSource = 'INCIDENT'; sourceIncidentNo = g.incidentNo; dispositionNo = g.dispositionNo;
    } else {
      // 账龄路：差额与方向取案件页同一行的开单预填（resolveWriteOff 公式，与 nextStep 同源）；客户池只许「托管里少了」。
      const row = await this.findDifferenceRow(dto);
      const prefill = row.adjustmentPrefill;
      if (!prefill) throw new BadRequestException('The anchored difference row is not a difference that can be recognized (it may have been matched or changed since the case page was loaded)');
      amountMinor = BigInt(prefill.amountMinor);
      const g = await assertAgingWriteOffAllowed(this.prisma, {
        kase, held, amountMinor, noun,
        assertPairing: () => {
          if (prefill.direction !== 'REDUCE') {
            throw new BadRequestException('Excess funds in the client pool cannot be recognized as a custody shortfall: identify the true owner first, then record it via deposit backfill — not loss recognition');
          }
        },
      });
      lossSource = 'AGING'; dispositionNo = g.dispositionNo;
    }

    const blocking = await this.transfers.findBlockingShortfallTopup({ explainedFlowId: dto.flowId, explainedExternalLineId: dto.externalLineId });
    if (blocking) {
      const why = blocking.status === InternalTransferStatus.FAILED
        ? 'its shortfall was already recognized on the books and the top-up is not re-opened — Treasury handles the remaining shortfall manually'
        : 'another cannot be opened';
      throw new ConflictException(`This difference row already has shortfall top-up ${blocking.transferNo} (${blocking.status}) — ${why}`);
    }

    const asset = await this.prisma.asset.findUnique({ where: { code: kase.assetCode } });
    if (!asset) throw new NotFoundException(`Asset not found: ${kase.assetCode}`);
    const fromWallet = await this.firmWallets.assertEligible(dto.fromWalletId, asset.id);
    await this.assertFromBalance(asset, fromWallet.id, amountMinor);
    const toWallet = await this.prisma.wallet.findUnique({ where: { id: kase.walletRef }, select: { id: true, ownerId: true, ownerType: true, walletNo: true } });
    if (!toWallet || toWallet.ownerType !== 'CUSTOMER' || !toWallet.ownerId) throw new BadRequestException(`Case ${dto.caseNo}'s wallet is not a customer wallet — nothing to top up`);
    await this.assertClientWalletHeadroom(asset, toWallet.id, kase.ownerNo, amountMinor);

    const route = await this.resolveRoute(asset, fromWallet.id, toWallet.id);
    const amountMajor = minorToMajor(amountMinor.toString(), asset.decimals);
    const row = await this.transfers.create({
      purpose: 'SHORTFALL_TOPUP', assetId: asset.id, amountMajor, ...route,
      customerId: toWallet.ownerId, customerNo: kase.ownerNo, reason: dto.reason, sourceCaseNo: kase.caseNo,
      explainedFlowId: dto.flowId ?? null, explainedExternalLineId: dto.externalLineId ?? null,
      lossSource, sourceIncidentNo, effectiveDate: startOfBusinessDate(kase.businessDate),
      traceId: kase.traceId ?? null, createdByUserId: actor.userNo ?? actor.userId,
    });
    // 开单即挂：处置记录落 transferNo、差异行锁定（驳回 / 撤回 / 超时 / 记短缺失败时由 releaseRowLock 解开）。
    await this.dispositions.linkTransfer(dispositionNo, row.transferNo);

    const impact = `Recognize custody shortfall of ${amountMajor} ${asset.currency} on wallet ${toWallet.walletNo} for customer ${kase.ownerNo} and top it up from ${fromWallet.walletNo}; customer balance unchanged`;
    return this.submitForApproval({ ...row, asset }, impact, dto.reason, actor, {
      snapshot: {
        fromWalletNo: fromWallet.walletNo, lossSource, effectiveDate: kase.businessDate,
        ...(sourceIncidentNo ? { sourceIncidentNo } : {}),
      },
      // 人选的 from 钱包、固定成因、来路进审计（铁律①：这个选择是持久化的）
      metadata: { causeCode: CLIENT_SHORTFALL_CAUSE, lossSource, sourceIncidentNo, effectiveDate: kase.businessDate, fromWalletNo: fromWallet.walletNo, walletNo: toWallet.walletNo },
    });
  }

  /** 按锚在案件页同一份差异行里找那一行（getCase 的 flowComparison；金额 / 方向取它的 adjustmentPrefill，与 nextStep 同源）。 */
  private async findDifferenceRow(dto: { caseNo: string; flowId?: string; externalLineId?: string }) {
    const view = await this.reconQuery.getCase(dto.caseNo);
    const row = view.flowComparison.find((r: any) => (dto.flowId && r.internalFlow?.id === dto.flowId) || (dto.externalLineId && r.externalLine?.id === dto.externalLineId));
    if (!row) throw new BadRequestException('The anchored difference row is no longer on the case (it may have been matched or changed since the case page was loaded)');
    return row;
  }

  /** 退汇垫款：来源 = 定性为「入金被退汇」且尚未认领的账单行；金额锁定 = 账单行 − 客户可用。 */
  async initiateAdvance(dto: { caseNo: string; externalLineId: string; reason: string }, actor: ApprovalActorContext) {
    const disp = await this.prisma.reconciliationDisposition.findFirst({ where: { caseNo: dto.caseNo, explainedExternalLineId: dto.externalLineId } });
    if (!disp || disp.outlet !== 'SUPPLEMENT' || disp.deferredTarget !== 'SUPPLEMENT_BOUNCE') throw new BadRequestException('Only a statement line classified as "Deposit recalled" needs an advance — classify it first');
    if (disp.supplementNo) throw new BadRequestException(`This statement line has already been converted to supplement ${disp.supplementNo} — no advance is needed`);
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo: disp.dispositionNo, kind: 'SUPPLEMENT_BOUNCE' });
    const available = (await this.accounting.getCustomerAvailableBalance(line.ownerId, line.currency)).available;
    const shortfall = BigInt(line.amountMinor) - available;
    if (shortfall <= 0n) throw new BadRequestException("The customer's available balance already covers the shortfall — no advance is needed, claim the recall directly");
    const blocking = await this.transfers.findBlockingBySource({ sourceExternalLineId: dto.externalLineId });
    if (blocking) throw new ConflictException(`This statement line already has advance ${blocking.transferNo} (${blocking.status}) — another cannot be opened`);
    const asset = await this.prisma.asset.findUnique({ where: { id: line.assetId } });
    if (!asset) throw new NotFoundException(`Asset not found: ${line.assetId}`);
    // 垫款路径（置灰入口，代码原样留着）出钱的钱包恒为运营户，建单时写死、不开放选择。
    const ops = await this.systemWallets.resolve(asset.id, 'F_OPS');
    await this.assertFromBalance(asset, ops.id, shortfall);
    const route = await this.resolveRoute(asset, ops.id, line.walletId);
    const amountMajor = minorToMajor(shortfall.toString(), asset.decimals);
    const row = await this.transfers.create({
      purpose: 'CLIENT_ADVANCE', assetId: asset.id, amountMajor, ...route,
      customerId: line.ownerId, customerNo: line.ownerNo ?? line.ownerId, reason: dto.reason, sourceCaseNo: dto.caseNo,
      sourceExternalLineId: dto.externalLineId,
      effectiveDate: startOfBusinessDate(line.businessDate), // 垫款的业务日 = 案件业务日（ClaimableLine.businessDate 取自案件）
      traceId: null, createdByUserId: actor.userNo ?? actor.userId,
    });
    const impact = `Advance ${amountMajor} ${asset.currency} to customer ${line.ownerNo ?? '-'} to cover the bounced-refund shortfall (case ${dto.caseNo}, statement line ${line.externalRef ?? '-'}; `
      + `customer available ${minorToMajor(available.toString(), asset.decimals)}, recalled ${line.amountMajor}); the advance must be recovered by Treasury`;
    return this.submitForApproval({ ...row, asset }, impact, dto.reason, actor, { metadata: { sourceExternalRef: line.externalRef ?? null }, snapshot: { externalRef: line.externalRef ?? null } });
  }

  /** from 钱包余额闸（出生守卫 / 批准时复核共用）：单上的出钱钱包（认损补缺 = 人选的运营户 / 手续费户，垫款 = 运营户）现金户够不够付。
   *  闸本体是 AccountingService.assertWalletBalance（戊波二 T3：划转 / 付款 / LP 兑换三份收成一份）。 */
  private async assertFromBalance(asset: { currency: string }, fromWalletId: string, amountMinor: bigint): Promise<void> {
    await this.accounting.assertWalletBalance(fromWalletId, TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS], amountMinor);
  }

  /**
   * 认损前客户钱包余量（裁定 14）：客户钱包现金户「可用 = 借已过账 − 贷已过账 − 贷挂起」≥ 短缺额，开单与批准各查一次。
   * 码 91 贷客户现金户，该户带「贷不得超借」标志，TB 判标志时把挂起的贷方也算进去——钱包上挂着待批提现的锁定时，
   * 码 91 必被拒。真实运营里本就如此（托管少了钱，这只钱包的出款先停），所以不够就拒并指路。算式只在 AccountingService 一份。
   */
  private async assertClientWalletHeadroom(asset: { currency: string; decimals: number }, walletId: string, customerNo: string, amountMinor: bigint): Promise<void> {
    const available = await this.accounting.getWalletCashAvailable(walletId, TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS]);
    if (available >= amountMinor) return;
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, select: { walletNo: true } });
    const fmt = (minor: bigint) => `${minorToMajor(minor.toString(), asset.decimals)} ${asset.currency}`;
    throw new BadRequestException({
      code: 'CLIENT_WALLET_PAYOUTS_IN_FLIGHT',
      message: `Customer ${customerNo}'s wallet ${wallet?.walletNo ?? '-'} has only ${fmt(available)} of cash free of in-flight payouts, `
        + `but the custody shortfall to recognize is ${fmt(amountMinor)} — first handle this wallet's in-flight payouts (reject or withdraw the pending withdrawal), then recognize the shortfall`,
    });
  }

  /** 出方钱包（认损补缺 = 人选；垫款 = 运营户）+ 中转结算户（法币）+ 入方客户钱包——提交时解析落库，批准时不再查。 */
  private async resolveRoute(asset: any, fromWalletId: string, toWalletId: string) {
    const via = asset.type === 'FIAT' ? await this.systemWallets.resolve(asset.id, 'F_SET') : null;
    return { fromWalletId, viaWalletId: (via?.id as string | undefined) ?? null, toWalletId };
  }

  private async submitForApproval(
    row: any, impact: string, reason: string, actor: ApprovalActorContext,
    opts: { snapshot?: Record<string, unknown>; metadata?: Record<string, unknown> } = {},
  ) {
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL,
        entityRef: row.transferNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          transferNo: row.transferNo, purpose: row.purpose, customerNo: row.customerNo,
          amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals), currency: row.asset.currency,
          sourceCaseNo: row.sourceCaseNo, ...(opts.snapshot ?? {}), impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await this.transfers.stampApprovalNo(row.transferNo, approval.approvalNo);
    await this.transferAudit({ ...row, approvalNo: approval.approvalNo }, {
      action: AuditActions.INTERNAL_TRANSFER_REQUESTED, reason, approvalNo: approval.approvalNo,
      metadata: { impact, ...(opts.metadata ?? {}) }, actor,
    });
    return { transferNo: row.transferNo as string, approvalNo: approval.approvalNo as string, status: InternalTransferStatus.PENDING_APPROVAL };
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(transferNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.transfers.findByNo(transferNo);
    if (row.status !== InternalTransferStatus.PENDING_APPROVAL) throw new BadRequestException(`Transfer ${transferNo} is already in ${row.status} — funds are in flight or settled, it cannot be cancelled`);
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason }, actor);
    const updated = await this.transfers.transition(transferNo, InternalTransferStatus.CANCELLED, { failureNote: dto.reason });
    await this.releaseRowLock(row);
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { transferNo, status: updated.status as string };
  }

  /** 认损补缺单开单即挂（处置记录落 transferNo、差异行锁定）；驳回 / 撤回 / 超时 / 记短缺失败 / 批准时余额不足时解开。
   *  走处置主体自己的方法（铁律③）。垫款单不挂处置记录。已记短缺的单（腿失败）不解——短缺挂着等人工，行继续锁着（裁定 15）。 */
  private async releaseRowLock(row: { purpose: string; transferNo: string }): Promise<void> {
    if (row.purpose === 'SHORTFALL_TOPUP') await this.dispositions.unlinkTransfer(row.transferNo);
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
      await this.releaseRowLock(row);
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 批准时再查一次出钱钱包的余额（提交查一次、批准查一次——与 B 批退汇同一纪律）
    const amountMinor = majorToMinor(row.amount, row.asset.decimals);
    try {
      await this.assertFromBalance(row.asset, row.fromWalletId, amountMinor);
    } catch (err) {
      const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE', failureNote: (err as Error).message });
      await this.releaseRowLock(row);
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'INSUFFICIENT_FIRM_BALANCE', reason: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 认损补缺：先记短缺（码 91），记不了就整张单失败、行锁解开；记成了才建腿。
    if (row.purpose === 'SHORTFALL_TOPUP' && !(await this.recognizeShortfall(row, amountMinor, event))) return;

    const leg = await this.createLeg(row, 1);
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.EXECUTING, { executedAt: new Date() });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_EXECUTION_STARTED, reason: row.purpose === 'SHORTFALL_TOPUP' ? 'Approved by CFO, shortfall recognized, first leg funds order created' : 'Approved by CFO, first leg funds order created', approvalNo: event.approvalNo, causationId: event.approvalId, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  /**
   * 记短缺（码 91）：批准那一步，先于建腿。复查客户钱包余量 → 借 2·客户钱包 / 贷 1·同一只客户钱包（生效日 = 案件业务日，
   * 事后分录靠它才在案件业务日的对账里看得见）→ 回执落单（先于建腿，之后无论腿成败，这张单都「已记短缺」）→ 审计。
   * 复查不过 / TB 拒绝 = 记账失败 = 流程失败（铁律⑤）：走既有 PENDING_APPROVAL → FAILED 边，failureReasonCode = RECOGNITION_FAILED，
   * 解开行锁；这时没有任何分录落下，可以重新开单。返回 false 表示已收口为 FAILED，调用方直接结束。
   */
  private async recognizeShortfall(row: any, amountMinor: bigint, event: ApprovalDecidedEvent): Promise<boolean> {
    let tbTransferId: bigint;
    const effectiveDate = toBusinessDate(row.effectiveDate);
    try {
      await this.assertClientWalletHeadroom(row.asset, row.toWalletId, row.customerNo, amountMinor);
      const ledger = TB_LEDGERS[row.asset.currency as keyof typeof TB_LEDGERS];
      ({ tbTransferId } = await this.accounting.executeTransfer({
        debitAccountId: await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ledger, ownerType: 'WALLET', ownerUuid: row.toWalletId }),
        creditAccountId: await this.accounting.resolveCashAccountId(row.toWalletId, ledger),
        amount: amountMinor, ledger, code: TB_TRANSFER_CODES.CLIENT_SHORTFALL_RECOGNIZED,
        evidence: {
          sourceType: 'INTERNAL_TRANSFER', sourceNo: row.transferNo, eventCode: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', traceId: row.traceId,
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_SHORTFALL], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH],
          assetCurrency: row.asset.currency, // ⚠ currency 不是 code（USDT-TRON vs USDT）
          actorType: 'ADMIN', actorId: event.decisionByUserNo ?? event.decisionByUserId ?? 'INTERNAL_TRANSFER_WORKFLOW',
          memo: `Shortfall recognized ${row.transferNo} (case ${row.sourceCaseNo})`,
          effectiveDate,
        },
      }));
    } catch (err) {
      const note = (err as Error).message;
      const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'RECOGNITION_FAILED', failureNote: note });
      await this.releaseRowLock(row);
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'RECOGNITION_FAILED', reason: `Recognizing the custody shortfall failed: ${note} — nothing was posted, the row is released`, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return false;
    }
    await this.transfers.stampRecognized(row.transferNo, bigintToHex(tbTransferId));
    await this.transferAudit(row, {
      action: AuditActions.INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED, reason: 'Approved by CFO, custody shortfall recognized — customer balance unchanged',
      approvalNo: event.approvalNo, causationId: event.approvalId, effectiveDate,
      metadata: { tbTransferId: bigintToHex(tbTransferId), causeCode: CLIENT_SHORTFALL_CAUSE, lossSource: row.lossSource ?? null },
    });
    return true;
  }

  /** 腿 1：法币 运营户 → 结算户 / 加密币 运营户 → 客户；腿 2（法币）：结算户 → 客户。资金单在此诞生（spec §4）。 */
  private async createLeg(row: any, legSeq: 1 | 2) {
    const isFiat = row.asset.type === 'FIAT';
    const fromId = legSeq === 1 ? row.fromWalletId : row.viaWalletId;
    const toId = isFiat && legSeq === 1 ? row.viaWalletId : row.toWalletId;
    const [from, to] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { id: fromId } }),
      this.prisma.wallet.findUnique({ where: { id: toId } }),
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
    const row = await this.prisma.internalTransfer.findUnique({ where: { id: event.parent.internalTransferId }, include: { asset: true } });
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
    // 铁律③：资金单只许 FundsOrderService 写，铸号也走它（铸法/幂等在 stampExternalRef 一处）
    const patch = await this.fundsOrders.stampExternalRef(leg.id);
    const stamped = { ...leg, ...(patch ?? {}) };
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
      reason: row.purpose === 'SHORTFALL_TOPUP' ? 'Top-up received, the custody shortfall is cleared (the customer balance was never touched)' : 'Advance received, customer available balance now covers the recalled amount',
      fromStatus: row.status, toStatus: updated.status,
    });
  }

  private async onLegFailed(row: any, leg: any, newStatus: string) {
    if (row.status !== InternalTransferStatus.EXECUTING) return;
    const note = row.asset.type === 'FIAT' && leg.legSeq === 2
      ? `Leg 2 ${newStatus}: funds remain in the settlement account, Treasury to handle manually (leg 1 already posted, books match funds)`
      : row.purpose === 'SHORTFALL_TOPUP'
        // 已记短缺：不重补（项目总纲 §2 不做补偿 / repair）——短缺户挂着等人工，同一行开不出第二张
        ? `Leg ${leg.legSeq} ${newStatus}: no funds moved, but the custody shortfall is already recognized on the books and stays open — it is not re-opened automatically, Treasury to handle manually`
        : `Leg ${leg.legSeq} ${newStatus}: no funds moved, this can be reinitiated`;
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'LEG_FAILED', failureNote: note });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'LEG_FAILED', reason: note, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  // ── 分录（spec §5；戊波一·附录 B「内部转账」；戊波二改认损补缺形状）──────────────────
  // 91 记短缺（认损补缺，批准那一步）：借 托管短缺待补·客户钱包(toWalletId) ／ 贷 现金·同一只客户钱包——见 recognizeShortfall
  // 81 补款腿 1（法币）：借 现金·结算钱包(viaWalletId) ／ 贷 现金·出钱钱包(fromWalletId)
  // 82 公司放出：借 对账核销损失 ／ 贷 现金·公司钱包（法币 = 结算钱包，加密币 = 出钱钱包）
  // 83 客户收到：认损补缺 借 现金·客户钱包(toWalletId) ／ 贷 托管短缺待补·同一只客户钱包（不碰应付，客户端零行）；
  //              垫款 借 现金·客户钱包 ／ 贷 应付·客户（置灰入口，代码原样）
  // 现金户一钱包一户，只经 resolveCashAccountId 取；码 2 经 resolveTbAccountId（ownerType WALLET）取。

  private async accounts(row: any) {
    const ledger = TB_LEDGERS[row.asset.currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`Unable to resolve a ledger for asset ${row.asset.code} (currency=${row.asset.currency})`);
    return {
      ledger,
      cash: (walletId: string) => this.accounting.resolveCashAccountId(walletId, ledger),
      reconLoss: () => this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, ledger, ownerType: 'SYSTEM' }),
      clientPayable: () => this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: row.customerId }),
    };
  }

  private evidence(row: any, leg: any, eventCode: string, debitCode: number, creditCode: number) {
    return {
      sourceType: 'INTERNAL_TRANSFER', sourceNo: row.transferNo, eventCode, traceId: row.traceId,
      debitCode: TB_CODE_TO_COA[debitCode], creditCode: TB_CODE_TO_COA[creditCode],
      assetCurrency: row.asset.currency, // ⚠ currency 不是 code（USDT-TRON vs USDT）
      actorType: 'SYSTEM', actorId: 'INTERNAL_TRANSFER_WORKFLOW',
      memo: `${row.purpose === 'SHORTFALL_TOPUP' ? 'Shortfall top-up' : 'Advance'} ${row.transferNo} leg ${leg.legSeq} (case ${row.sourceCaseNo})`,
      externalRef: this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset }),
    };
  }

  /** 法币腿 1：借 现金·结算钱包 / 贷 现金·运营钱包（81）——公司资产总量不变，只是钱从运营钱包挪到结算钱包。 */
  private async postOpsToSet(row: any, leg: any) {
    const a = await this.accounts(row);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await a.cash(row.viaWalletId), creditAccountId: await a.cash(row.fromWalletId), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET,
      evidence: this.evidence(row, leg, 'INTERNAL_TRANSFER_OPS_TO_SET', TB_ACCOUNT_CODES.FIRM_CASH, TB_ACCOUNT_CODES.FIRM_CASH),
    });
  }

  /** 最后一腿（法币腿 2 / 加密币腿 1）：公司放出（82）+ 客户收到（83，认损补缺贷码 2 / 垫款贷应付），一步两笔，任一失败整步失败。 */
  private async postFinalLeg(row: any, leg: any) {
    const a = await this.accounts(row);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    const isFiat = row.asset.type === 'FIAT';
    const firmWalletId = isFiat ? row.viaWalletId : row.fromWalletId;
    await this.accounting.executeTransfer({
      debitAccountId: await a.reconLoss(), creditAccountId: await a.cash(firmWalletId), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT,
      evidence: this.evidence(row, leg, 'INTERNAL_TRANSFER_FIRM_OUT', TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, TB_ACCOUNT_CODES.FIRM_CASH),
    });
    // 83 按用途分两种形状（码不改号，借贷由 eventCode 区分）：
    //   认损补缺：贷 码 2 托管短缺待补·同一只客户钱包——把批准时记下的短缺消掉；不碰应付，客户端对账单靠应付户取流水，故零行
    //   垫款：    贷 应付·客户，客户端显示「平台垫付」（spec §11）
    const topup = row.purpose === 'SHORTFALL_TOPUP';
    const clientCredit = topup
      ? await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_SHORTFALL, ledger: a.ledger, ownerType: 'WALLET', ownerUuid: row.toWalletId })
      : await a.clientPayable();
    await this.accounting.executeTransfer({
      debitAccountId: await a.cash(row.toWalletId), creditAccountId: clientCredit, amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN,
      evidence: this.evidence(row, leg, topup ? 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN' : 'INTERNAL_TRANSFER_ADVANCE_IN', TB_ACCOUNT_CODES.CLIENT_CASH, topup ? TB_ACCOUNT_CODES.CLIENT_SHORTFALL : TB_ACCOUNT_CODES.CLIENT_PAYABLE),
    });
  }

  // ── 审计（八码共用信封）──────────────────────────────────────────────

  private async transferAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    /** 生效日（YYYY-MM-DD）；缺省 = 今天。记短缺那一条带案件业务日。 */
    effectiveDate?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INTERNAL_TRANSFER, subjectNo: row.transferNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: 'CUSTOMER', subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER },
      { subjectType: 'RECONCILIATION_CASE', subjectNo: row.sourceCaseNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
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
      effectiveDate: patch.effectiveDate ?? toBusinessDate(new Date()),
      // REQUESTED 起划转单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）
      ...(patch.action === AuditActions.INTERNAL_TRANSFER_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.transferNo}_${randomUUID()}`,
      metadata: { transferNo: row.transferNo, purpose: row.purpose, sourceCaseNo: row.sourceCaseNo, fundsOrderNo: patch.fundsOrderNo ?? null, ...(patch.metadata ?? {}) },
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
