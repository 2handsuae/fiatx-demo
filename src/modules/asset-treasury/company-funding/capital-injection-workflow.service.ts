// 战役乙波二 T3 · 注资单 workflow（本任务心脏）：审批裁决 / ⚡到款 / 确认入账(码70) / 撤回。
// 单腿进项（钱到运营户 F_OPS，从 CONFIRMED 出生，同 fiat 充值 payin 先例）——批准即进
// AWAITING_FUNDS（不像 LP 兑换那样立刻建腿，注资没有「卖出腿」）；⚡模拟到款
// (simulateContribution) 只写回单 + 建腿到 CONFIRMED + 翻 RECEIVED，**不落账**（与 LP 腿 2
// 的关键差异——落账挪到 confirm 边，先账后状态：码 70 DR FIRM_ASSET / CR FIRM_OPS 在
// RECEIVED→SUCCESS 这一跳里落，同一跳里把腿 CLEAR）。回单先于落账同 LP 先例（评审 R12：
// bumpClosing「当日无余额行」兜底基准双计）。铁律③各管各的：本文件只调
// CapitalInjectionService/AccountingService/FundsOrderService/SystemWalletResolver/
// SimulatedCustodianStatementService 的公开方法，不直写域外表。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
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
import { CapitalInjectionService } from './capital-injection.service';
import { CapitalInjectionStatus } from './dto/capital-injection.dto';

/** initiate() 入参——只认业务键（资产 id），零 UUID 由调用方外部拼；toWalletId（F_OPS）由
 *  本 workflow 解析（照 T2 CreateCapitalInjectionDto 的分工：主体服务不解析钱包）。 */
export interface InitiateCapitalInjectionInput {
  contributorName: string;
  assetId: string;
  amount: string; // 元
  prudentialPurpose: string;
  reason: string;
  traceId?: string | null;
}

const majorToMinor = (amount: Prisma.Decimal | string, decimals: number): bigint =>
  BigInt(new Prisma.Decimal(amount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

@Injectable()
export class CapitalInjectionWorkflowService {
  private readonly logger = new Logger(CapitalInjectionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly injections: CapitalInjectionService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly custodianStatement: SimulatedCustodianStatementService,
  ) {}

  // ── 发起（金库，CFO 单步批）──────────────────────────────────────────

  async initiate(dto: InitiateCapitalInjectionInput, actor: ApprovalActorContext) {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset not found: ${dto.assetId}`);

    const toWallet = await this.systemWallets.resolve(dto.assetId, 'F_OPS');

    const row = await this.injections.create({
      contributorName: dto.contributorName, assetId: dto.assetId, amount: dto.amount,
      prudentialPurpose: dto.prudentialPurpose, reason: dto.reason,
      toWalletId: toWallet.id as string,
      traceId: dto.traceId ?? undefined, createdByUserId: actor.userNo ?? actor.userId,
    });

    const amountFormatted = new Prisma.Decimal(dto.amount).toFixed(asset.decimals);
    const impact = `Contribute ${amountFormatted} ${asset.currency} into the firm's operating account `
      + `(purpose: ${dto.prudentialPurpose}); the firm's ${asset.currency} operating balance increases once the contribution is confirmed`;

    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.CAPITAL_INJECTION_APPROVAL,
        entityRef: row.cinNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          cinNo: row.cinNo, contributorName: row.contributorName,
          amount: `${amountFormatted} ${asset.currency}`,
          prudentialPurpose: dto.prudentialPurpose, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await this.injections.stampApprovalNo(row.cinNo, approval.approvalNo);
    await this.injectionAudit({ ...row, asset }, {
      action: AuditActions.CAPITAL_INJECTION_REQUESTED, reason: dto.reason, approvalNo: approval.approvalNo,
      metadata: { impact }, actor,
    });
    return { cinNo: row.cinNo as string, approvalNo: approval.approvalNo as string, status: CapitalInjectionStatus.PENDING_APPROVAL };
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(cinNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.injections.findByNo(cinNo);
    if (row.status !== CapitalInjectionStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Capital injection ${cinNo} is already in ${row.status} — funds are in flight or settled, it cannot be cancelled`);
    }
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason }, actor);
    const updated = await this.injections.transition(cinNo, CapitalInjectionStatus.CANCELLED, {});
    await this.injectionAudit(row, { action: AuditActions.CAPITAL_INJECTION_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { cinNo, status: updated.status as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.capital-injection.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'CANCELLED') return; // 撤回由 cancel() 自己收口（它先撤审批单再翻状态）
    let row: any;
    try { row = await this.injections.findByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (row.status !== CapitalInjectionStatus.PENDING_APPROVAL) return;

    if (event.decision !== 'APPROVED') {
      const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
      const updated = await this.injections.transition(row.cinNo, CapitalInjectionStatus.REJECTED, {});
      await this.injectionAudit(row, { action: AuditActions.CAPITAL_INJECTION_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    const updated = await this.injections.transition(row.cinNo, CapitalInjectionStatus.AWAITING_FUNDS, {});
    await this.injectionAudit(row, { action: AuditActions.CAPITAL_INJECTION_APPROVED, reason: 'Approved by CFO, awaiting the contribution', approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
  }

  // ── ⚡到款（腿 1）：外部出资方打款落运营户——建单+回单+翻 RECEIVED，不落账（评审
  //    纪律：落账在确认边，先账后状态）────────────────────────────────────

  async simulateContribution(cinNo: string, actor: ApprovalActorContext) {
    const row = await this.injections.findByNo(cinNo);
    if (row.status !== CapitalInjectionStatus.AWAITING_FUNDS) {
      throw new BadRequestException(`Capital injection ${cinNo} is not awaiting funds (status=${row.status})`);
    }
    const toWallet = await this.prisma.wallet.findUnique({ where: { id: row.toWalletId } });
    const isCrypto = row.asset.type === 'CRYPTO';
    // 照 lp simulateDelivery 先例：initialStatus 直接落 CONFIRMED（⚡模拟动作，不走
    // SUBMIT/CONFIRM 两跳）；外部侧（出资方）没有登记坐标，只有 contributorName 一行文本，
    // 填进 asset 类型对应的那一个外部字段（fromWalletId 传 null）。
    const leg = await this.fundsOrders.create({
      capitalInjectionId: row.id, legSeq: 1, initialStatus: FundsOrderStatus.CONFIRMED,
      assetId: row.assetId, amount: String(row.amount), netAmount: String(row.amount),
      fromWalletId: null,
      fromAddress: isCrypto ? row.contributorName : null,
      fromIban: isCrypto ? null : row.contributorName,
      toWalletId: toWallet?.id ?? null, toAddress: toWallet?.address ?? null, toIban: toWallet?.iban ?? null,
      traceId: row.traceId ?? undefined,
    });
    const externalRef = this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset }) ?? leg.fundsOrderNo;
    // 回单先于落账（同 LP 评审 R12 纪律）；只写 F_OPS 这一侧（出资方的外部坐标不是我们的钱包）。
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: leg.fundsOrderNo, fromWalletId: null, toWalletId: row.toWalletId,
      assetCode: row.asset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(leg.amount, row.asset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — capital injection ${row.cinNo} (contributed by ${row.contributorName})`,
    });
    const updated = await this.injections.transition(cinNo, CapitalInjectionStatus.RECEIVED, { receivedAt: new Date() });
    await this.injectionAudit(row, {
      action: AuditActions.CAPITAL_INJECTION_FUNDS_RECEIVED, reason: 'Contribution simulated, funds landed in the operating account (not yet posted)',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status, actor,
    });
    return { cinNo, status: updated.status as string };
  }

  // ── 确认入账（核数）：码 70 DR FIRM_ASSET / CR FIRM_OPS——落账在这一跳，先账后状态 ──

  async confirm(cinNo: string, actor: ApprovalActorContext) {
    const row = await this.injections.findByNo(cinNo);
    if (row.status !== CapitalInjectionStatus.RECEIVED) {
      // 迁移表天然拒二次确认（SUCCESS 零出边）；未到款同样在这里被拒（PENDING_APPROVAL/AWAITING_FUNDS）。
      throw new BadRequestException(`Capital injection ${cinNo} is not received yet (status=${row.status}) — nothing to confirm`);
    }
    const legs = await this.fundsOrders.findByParent({ capitalInjectionId: row.id }, { legSeq: 1 });
    const leg = legs[0];
    await this.postInjection(row, leg);
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'CAPITAL_INJECTION_WORKFLOW');
    const updated = await this.injections.transition(cinNo, CapitalInjectionStatus.SUCCESS, { settledAt: new Date() });
    const expectedFormatted = new Prisma.Decimal(row.amount).toFixed(row.asset.decimals);
    await this.injectionAudit(row, {
      action: AuditActions.CAPITAL_INJECTION_CONFIRMED, reason: 'Contribution confirmed, entries posted and cleared',
      fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status, actor,
      metadata: { expected: expectedFormatted, received: new Prisma.Decimal(leg.amount).toFixed(row.asset.decimals) },
    });
    return { cinNo, status: updated.status as string };
  }

  // ── 分录（70）───────────────────────────────────────────────────────

  private ledgerOf(currency: string): number {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`Unable to resolve a ledger for currency ${currency}`);
    return ledger;
  }

  private sysAccount(ledger: number, code: number) {
    return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
  }

  /** 码 70：DR FIRM_ASSET / CR FIRM_OPS，注入币 ledger，外穿——一侧物理钱包是
   *  row.toWalletId（收到款的那个网络行），出资方的外部坐标不是钱包。 */
  private async postInjection(row: any, leg: any) {
    const ledger = this.ledgerOf(row.asset.currency);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_ASSET),
      creditAccountId: await this.sysAccount(ledger, TB_ACCOUNT_CODES.FIRM_OPS),
      amount, ledger, code: TB_TRANSFER_CODES.CAPITAL_INJECTION,
      evidence: {
        sourceType: 'CAPITAL_INJECTION', sourceNo: row.cinNo, eventCode: 'CAPITAL_INJECTION', traceId: row.traceId,
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_OPS],
        assetCurrency: row.asset.currency, actorType: 'SYSTEM', actorId: 'CAPITAL_INJECTION_WORKFLOW',
        memo: `Capital injection ${row.cinNo} confirmed (contributed by ${row.contributorName})`,
        debitWalletRef: row.toWalletId, creditWalletRef: row.toWalletId,
        externalRef: this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset }), isExternalCrossing: true,
      },
    });
  }

  // ── 审计（六码共用信封，照 exchangeAudit 改写）─────────────────────────

  private async injectionAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.CAPITAL_INJECTION, subjectNo: row.cinNo, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    const amountFormatted = new Prisma.Decimal(row.amount).toFixed(row.asset.decimals);
    const input: any = {
      action: patch.action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.CAPITAL_INJECTION,
      primarySubjectType: AuditEntityTypes.CAPITAL_INJECTION, primarySubjectNo: row.cinNo,
      subjects,
      outcome: patch.outcome, reasonCode: patch.reasonCode, reason: patch.reason,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      amount: amountFormatted,
      effectiveDate: toBusinessDate(new Date()),
      // REQUESTED 起注资单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）。
      ...(patch.action === AuditActions.CAPITAL_INJECTION_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.cinNo}_${randomUUID()}`,
      metadata: {
        cinNo: row.cinNo, contributorName: row.contributorName,
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
