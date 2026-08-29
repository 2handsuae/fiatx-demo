import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
  DepositOwnerType,
} from './dto/deposit-transaction.dto';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import type { SceneTag } from '../../deposit-sumsub/deposit-kyt-verdict.handler';
import type { DispoTag } from '../../sumsub-shared/scene-tags';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import {
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome, AuditCategory, AuditSubjectRole, AuditSubjectInput } from '../../audit-logging/dto/audit-log.dto';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { DispositionService, DispositionSpec } from '../../funds-orders/disposition.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
  CreateFundsOrderInput,
} from '../../funds-orders/dto/funds-order.dto';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../../sumsub-shared/sumsub-txn-client.interface';
import { resolveKytTxnType } from '../../deposit-sumsub/kyt-txn-type.resolver';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import {
  CustomerRestrictionsService,
  type RestrictionRow,
} from '../../identity/customers/customer-restrictions.service';
import { L1GateService } from '../shared/l1-gate/l1-gate.service';
import type { L1Check } from '../shared/l1-gate/l1-gate.types';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string;
  fundsOrderNo: string;
  parent: {
    depositTransactionId?: string;
    withdrawTransactionId?: string;
    swapTransactionId?: string;
  };
  legSeq: number;
  attempt: number;
  oldStatus: string | null;
  newStatus: string;
  traceId?: string;
  effectiveDate?: string; // 平账推单回填的业务归属日；普通实时流转恒为 undefined
}

/**
 * 裁决落地档位（第一批 · 2026-08-19）。
 *   IGNORE   —— 这条裁决不会推动状态机，也不该留在订单上：不写证据、不推状态、必写审计
 *   DISPATCH —— 正常分发到四个 verdict 分支：写证据、推状态
 * 铁律：判定必须先于任何写库动作。见 spec §2.1。
 */
type VerdictLanding = 'IGNORE' | 'DISPATCH';

@Injectable()
export class DepositWorkflowService implements OnModuleInit {
  // A2: system-triggered maker actor for the KYT-verdict-driven RETURN approval.
  // ApprovalActorContext.actorType only accepts 'ADMIN' (mirrors ApprovalsService's own
  // private systemActor() helper) — this is the approvals engine's accepted shape for a
  // SYSTEM-originated maker, not a real admin.
  private static readonly KYT_VERDICT_ACTOR: ApprovalActorContext = {
    actorType: 'ADMIN',
    userId: 'KYT_VERDICT',
    userNo: 'KYT_VERDICT',
    role: 'SYSTEM',
    roleCodes: ['SYSTEM'],
  };

  // 第四批 C1：能发起「原路退回汇款人」的状态。OPERATION_PENDING 也在里面 —— 运营看到
  // L1 挂起原因(如「客户账户已暂停」)时,除了放行/上缴/冻结之外必须有把钱退回去这条路。
  // 发起端(initiateReturn)与落地端(onReturnApproved)共用同一份判据：只放宽发起端会让
  // 审批批准后在落地时被静默拒绝,单子卡在「审批已通过、状态没动」的残局。
  private static readonly RETURNABLE_STATUSES: string[] = [
    DepositTransactionStatus.MANUAL_CHECKING,
    DepositTransactionStatus.OPERATION_PENDING,
  ];

  // 第四批 C1 复审 · 业主裁定（2026-08-22，甲/乙/丙 三案取乙）：`limitHoldReason`
  // 这一列有两类主人，退回落地时**只清行政级这一类**。
  //
  //   行政级（下面这两个，Gate 0 按**客户**属性落的）—— 退回时清掉。
  //     业主口径：「账户被停用期间你的钱退回去了」是客户**有权知道**的事实。
  //   BELOW_MIN（建单时按**这笔单自身**的金额下限落的）—— 退回时保留、继续藏。
  //     业主口径：藏小额单是为了不让客户看见「这笔太小我们没收了」这类处置噪音。
  //
  // 为什么非清不可：客户面三处读侧（findAll / findOneForCustomer /
  // findOneForCustomerByDepositNo）的判据都是「limitHoldReason 非空即整单不可见」，
  // 而 RETURNING/RETURNED 恰恰在 CUSTOMER_STATUS_PASSTHROUGH 白名单里、RETURNED 还在
  // CUSTOMER_COMPLETED_STATUSES 里 —— 设计意图本来就是让客户看见这两个态。不清就是：
  // 钱到过又原路退回，客户面零记录（列表查不到、两个筛选桶都空、按单号打详情 404）。
  //
  // ⚠️ 两个原因并存时列上留的是 BELOW_MIN（见 holdAtGate0 的「已有挂起原因优先」），
  //    集合判定天然落在「保留」这一侧 —— 与业主裁定一致，不需要再补条件。
  // ⚠️ 没收弧（initiateConfiscation + 没收落地前置）硬钉 BELOW_MIN，本清除不碰它们。
  private static readonly ADMINISTRATIVE_HOLD_REASONS: ReadonlySet<string> =
    new Set<string>(['CAPABILITY_RESTRICTED', 'LIFECYCLE_NOT_ACTIVE']);

  private readonly logger = new Logger(DepositWorkflowService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly disposition: DispositionService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    private readonly withdrawalAddresses: WithdrawalAddressService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
    private readonly approvalsService: ApprovalsService,
    private readonly systemWalletResolver: SystemWalletResolver,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly applicantActions: DepositApplicantActionsService,
    private readonly customerAccessService: CustomerAccessService,
    private readonly customerRestrictionsService: CustomerRestrictionsService,
    // B4（第四批）：Gate 0 落 L1 快照用的三域共用求值器。它不抛错，只出快照。
    private readonly l1Gate: L1GateService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  onModuleInit() {
    this.logger.log('DepositWorkflowService initialized and listening for events.');
  }

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.depositTransactionId) return; // only payin funds orders
    // A deposit's payin is legSeq 1; the confiscation move hangs a legSeq 2
    // funds order under the SAME deposit. Only leg 1 is the payin — legSeq > 1 is
    // an internal/confiscation leg driven by startConfiscation itself, never a
    // payin, so it must not enter onPayinConfirmed/onPayinFailed. (Mirrors the
    // withdraw workflow branching on PAYOUT_LEG_SEQ vs FEE_LEG_SEQ.)
    // legSeq 2 is the C2/C3 confiscation leg → its CONFIRMED settles the below-min
    // confiscation (POST the two pending legs + deposit → CONFISCATED).
    if (event.legSeq === 2) { await this.onConfiscationLegChanged(event); return; }
    // legSeq 3 is the A3 return-to-sender leg (confiscation owns legSeq 2) →
    // CONFIRMED settles RETURNING → RETURNED; FAILED/TIMEOUT voids + retries.
    if (event.legSeq === 3) { await this.onReturnLegChanged(event); return; }
    // legSeq 4 is the A4 government-seizure leg → CONFIRMED settles SEIZING →
    // SEIZED; FAILED/TIMEOUT voids + retries. Mirrors legSeq 3's routing exactly.
    if (event.legSeq === 4) { await this.onSeizeLegChanged(event); return; }
    if (event.legSeq !== 1) return;
    const depositId = event.parent.depositTransactionId;
    this.logger.log(
      `Deposit ${depositId} funds order ${event.fundsOrderNo} → ${event.newStatus}`,
    );

    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        await this.onPayinConfirmed(depositId, event.fundsOrderId, event.effectiveDate);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onPayinFailed(depositId, event.fundsOrderId);
        break;
    }
  }

  @OnEvent('deposit.status.changed')
  async handleDepositStatusChanged(event: DepositStatusChangedEvent) {
    const { depositId, oldStatus, newStatus } = event;
    this.logger.log(
      `Deposit ${depositId} transitioned ${oldStatus} → ${newStatus}`,
    );

    if (newStatus === DepositTransactionStatus.COMPLIANCE_PENDING) {
      await this.runGate0(depositId, event.ownerId);
    }
  }

  /**
   * Gate 0 —— 进入 COMPLIANCE_PENDING 时跑一次的客户级闸。
   *
   * ⚠️ 口径澄清（B4，2026-08-22）：本次改动**不是**「堵住被限制客户的新钱入账」。
   * 充值域在此之前就有三道限制账闸：`inbound-transfer-signals` 的
   * `createForCustomer`/`scanForCustomer` 两道 `assertTradingEligibility`，加本函数
   * 这一道；`detected()`（真正建单）全仓唯一的生产调用方就在第二道闸后面。
   * 本次改的是**同一道闸后面的分流与取证**：
   *   ① 按 `releasePolicy` 分流（执法级冻 / 行政级挂），不再一视同仁全 FROZEN；
   *   ② 补上此前漏判的 `lifecycle`（已销户/停用但没贴便签的客户此前一路走得通）；
   *   ③ 把这一刻的 L1 九格判定落成可回显快照（`l1Snapshot` 列，A1 已建）。
   */
  private async runGate0(depositId: string, ownerId: string) {
    // Task 9：改读限制账。原先经 getOwnerComplianceStatus 读 CustomerMain.complianceStatus，
    // 该列已删；那个方法用 (prisma as any) 抹掉了类型，编译器看不见 —— 这道合规闸
    // 在删列后其实已经失效，构建却是绿的。
    // ownerId 由事件带入，不再为拿它多查一次库。
    const access = await this.customerAccessService.resolve(ownerId);
    const deposit = await this.depositService.findOne(depositId);

    // 分流要的 cause / releasePolicy 只有限制账的原始行有 —— `CustomerAccess` 结构性
    // 给不出：`disclosed` 只装 DISCLOSED 行，而最要紧的 SANCTION 是 SILENT，压根不在
    // 里面。所以这里直接读一次限制账。
    const openRows: RestrictionRow[] =
      await this.customerRestrictionsService.listOpen(ownerId);
    // scope 展开：SANCTION 与 ADMIN_SUSPENSION 的 scope 都是 'ALL'，直接字符串比
    // `=== 'DEPOSIT'` 会把这两种最要紧的因由全漏掉。
    const depositBlockers = openRows.filter((row) =>
      row.scopes.some((scope) => scope === 'ALL' || scope === 'DEPOSIT'),
    );

    // ── L1 快照（§5）─────────────────────────────────────────────────────────
    // 逐格只写这一刻**真判过**的（B2 判据：写不实的 PASS 是伪证据，比不记录更糟）。
    //  · CUSTOMER_ELIGIBILITY / CUSTOMER_RESTRICTION —— **不传**：L1GateService 自判，
    //    传了也会被它的 SELF_OWNED_CHECKS 静默丢弃。
    //  · SINGLE_LIMIT —— 建单时 `detected()` 判过下限（低于则出生带 BELOW_MIN 标记）。
    //    带着标记的单那一格就是没过，照实记 FAIL。
    //  · ACCOUNT_READINESS —— 建单时 `detected()` 无条件校验过收款钱包存在且资产匹配，
    //    不过整单不建 → 能走到这里的单这一格必然为真。
    //  · TRADING_READINESS —— **SKIPPED，不是 PASS**：`assertTradingEligibility` 对
    //    DEPOSIT 刻意跳过 `assertTradingReady`（onboarding.service.ts:1192-1194），
    //    真正判法币提现地址的是放行前的 `assertTradingReadyOrHold`，跑在本评估点之后。
    //  · 其余四格（累计额度 / 大额审批 / 余额 / 报价）由 L1GateService 的 NA 表处理。
    const belowMin = deposit.limitHoldReason === 'BELOW_MIN';
    const preChecks: L1Check[] = [
      belowMin
        ? {
            code: 'SINGLE_LIMIT',
            outcome: 'FAIL',
            detail: '建单时判定金额低于 DEPOSIT 单笔下限（BELOW_MIN），等运营处置',
          }
        : {
            code: 'SINGLE_LIMIT',
            outcome: 'PASS',
            detail: '建单时已过 DEPOSIT 单笔下限判定（充值是被动入金，只判下限、无上限）',
          },
      {
        code: 'ACCOUNT_READINESS',
        outcome: 'PASS',
        detail: '建单时校验过收款钱包存在且资产匹配（不匹配则整单不建）',
      },
      {
        code: 'TRADING_READINESS',
        outcome: 'SKIPPED',
        detail:
          '交易起始就绪（法币提现地址）由放行前的 assertTradingReadyOrHold 校验，本评估点在其之前',
      },
    ];
    const l1 = await this.l1Gate.evaluate({
      domain: 'DEPOSIT',
      customerId: ownerId,
      preChecks,
    });
    // 三条分支（冻 / 挂 / 放行）都要留下证据，所以落库放在分流之前。
    await this.depositService.saveL1Snapshot(depositId, JSON.stringify(l1));

    if (access.blocked.has('DEPOSIT')) {
      // 分流（业主 2026-08-22 裁定一）：命中 DEPOSIT 的 OPEN 便签里只要有一条
      // releasePolicy === 'MLRO_APPROVAL' → 执法级 → FROZEN（保持此前行为）；
      // 全是 OPS_APPROVAL → 行政级（账户暂停这类）→ OPERATION_PENDING。
      // 按 releasePolicy 派生而不是写死 cause 名单：日后新增一个 MLRO 级 cause
      // 会自动走对分支。
      // depositBlockers 为空 = access 说卡住、限制账却查不出卡 DEPOSIT 的 OPEN 行
      //（两次读之间刚被撕掉之类的内部不一致）——分类不出来就**不降级**，保持 FROZEN。
      const enforcement =
        depositBlockers.length === 0 ||
        depositBlockers.some((row) => row.releasePolicy === 'MLRO_APPROVAL');

      if (enforcement) {
        this.logger.warn(
          `Gate 0 FAIL: deposit ${depositId} — customer DEPOSIT capability is blocked`,
        );
        await this.depositService.updateStatus(
          depositId,
          { action: DepositTransactionAction.FREEZE },
          {
            reason: 'Customer DEPOSIT capability is restricted',
            actor: { actorType: 'SYSTEM', actorId: 'COMPLIANCE_GATE_0' },
          },
        );
        return;
      }

      await this.holdAtGate0(
        deposit,
        l1.holdReason ?? 'CAPABILITY_RESTRICTED',
        'Gate 0: customer DEPOSIT capability is restricted by an operational (non-enforcement) hold — awaiting ops disposition',
      );
      return;
    }

    // §4：此前 Gate 0 只判 blocked，lifecycle 只写进审计 metadata —— 一个已销户/
    // 停用但一张便签都没贴的客户，充值照样走得通。lifecycle 非 ACTIVE 属行政性
    // （不是执法），走挂起分支。
    if (access.lifecycle !== 'ACTIVE') {
      await this.holdAtGate0(
        deposit,
        l1.holdReason ?? 'LIFECYCLE_NOT_ACTIVE',
        `Gate 0: customer lifecycle is ${access.lifecycle} (not ACTIVE) — awaiting ops disposition`,
      );
      return;
    }

    this.logger.log(`Gate 0 PASS: deposit ${depositId}`);

    // 站1b-β：GATE0_PASSED 留痕删除——每单必过属高频噪音，资格快照已落单上 l1Snapshot 列。

    try {
      await this.submitSumsubTxns(deposit);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `Sumsub submit failed for deposit ${depositId}: ${error.message} — ` +
          `deposit remains COMPLIANCE_PENDING for manual handling/retry; Gate 0 continues`,
      );
    }
  }

  /**
   * Gate 0 的**行政级**挂起（B4 裁定一的「非执法级」那一半）：钱已经在
   * DEPOSIT_SUSPENSE 里，拒不了，只能挂在 OPERATION_PENDING 上等运营处置。
   *
   * 与执法级（FROZEN）的区别只在出场：这条挂起由运营用 `waiveLimitHold` 解除
   * （§3 已把它从只认 BELOW_MIN 放宽到认任何非空挂起原因），FROZEN 只能走
   * MLRO 解冻审批。
   *
   * ⚠️ 挂起原因取自刚落库的快照 `holdReason`，两者由此天然一致 —— 不要在这里
   * 另算一份，那会长出「列上写 A、快照里写 B」的第二真相。
   *
   * ⚠️ 但**已有的挂起原因优先保留**（`BELOW_MIN` 是建单时按金额下限落的）：
   * `limitHoldReason` 这一列有两个主人 —— `BELOW_MIN` 是这笔单**自身**的属性
   * （金额低于配置下限），Gate 0 这条是**客户**的属性（被停用/生命周期非 ACTIVE）。
   * 覆盖写会把 `BELOW_MIN` 抹掉，后果有三：waive 后这笔低于下限的钱直接入客户
   * 余额、`DEPOSIT_HELD`(reasonCode=BELOW_MIN) 审计从未写过、且没收弧（`initiateConfiscation`
   * 与落地前置都硬钉 `BELOW_MIN`）永远走不进去 —— 小额充值的专属处置被从另一个
   * 方向绕掉。两个原因并存时列上留 `BELOW_MIN`，客户级那条在 `l1Snapshot` 里有
   * 完整记录（含 `holdReason` 与逐格 detail），且单子照样被路由到 OPERATION_PENDING。
   *
   * ⚠️ 挂起原因非空 = 该单对客户面三处读侧（findAll / findOneForCustomer /
   * findOneForCustomerByDepositNo）整单不可见。这是维持现状的刻意选择（业主：
   * 页面不漏字即可），不是疏漏。**挂着的时候**藏；一旦走上退回弧，行政级这两个
   * 原因会被清掉（见 clearAdministrativeHoldOnReturn），客户看得见钱退回去了。
   *
   * 挂起路径**不提交 Sumsub** —— 与紧邻的 FROZEN 分支同形状：客户当下不该交易，
   * 没有必要为他起一个 KYT 案子。
   */
  private async holdAtGate0(deposit: any, holdReason: string, reason: string) {
    // 已有挂起原因优先（见方法头 ⚠️）：不覆盖建单时落的 BELOW_MIN。
    const effectiveHoldReason: string = deposit.limitHoldReason ?? holdReason;
    // 两者不一致 = 这笔单同时背着自身的金额原因和客户级原因；日志/审计两个都写出来，
    // 免得运营在列上只看见 BELOW_MIN、不知道客户当下还被停用着。
    const holdTrace =
      effectiveHoldReason === holdReason
        ? `holdReason=${holdReason}`
        : `holdReason=${effectiveHoldReason} (kept; Gate 0 also flagged ${holdReason})`;

    this.logger.warn(
      `Gate 0 HOLD: deposit ${deposit.id} — ${reason} (${holdTrace})`,
    );

    await this.depositService.updateStatus(
      deposit.id,
      { action: DepositTransactionAction.OPERATION_PENDING, reason },
      {
        actor: { actorType: 'SYSTEM', actorId: 'COMPLIANCE_GATE_0' },
        sourcePlatform: 'SYSTEM',
        extraData: { limitHoldReason: effectiveHoldReason },
      },
    );

    // 状态跃迁审计走动态动作名（DEPOSIT_COMPLIANCE_PENDING_TO_OPERATION_PENDING），
    // 不新造审计动作常量 —— 本批不做审计专项。
    //
    // ⚠️ requestId 必传：没有它幂等键退化成
    // `entityType|entityId|action|NO_REQUEST_ID`，**同一笔单的第二次 Gate 0 挂起会被
    // 静默去重**。而二次挂起是常规操作 —— freeze→unfreeze(RESUME 回 COMPLIANCE_PENDING)
    // →Gate 0 重跑重新挂起，或 waive→重新挂起。少这一行 = 取证链缺一次挂起事实。
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_HELD',
      reasonCode: holdReason,
      reason: `${reason} (${holdTrace})`,
      fromStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      toStatus: DepositTransactionStatus.OPERATION_PENDING,
    });
  }

  /**
   * Gate 0 submission entry: submits the deposit to Sumsub KYT so a verdict webhook
   * can later drive the state machine. One deposit → one txn; `type` is decided by
   * resolveKytTxnType (VARA判定,spec §3). Idempotent on sumsubTxnId (protects
   * against runGate0 re-entry). If the customer has no sumsubApplicantId yet, warns
   * and skips — the deposit stays in COMPLIANCE_PENDING awaiting manual handling
   * rather than crashing.
   *
   * ⚠️ 硬前提:合规须先把筛查规则作用域改为 types:["finance","travelRule"] 并确认,
   * 否则 travelRule 单不进规则 = 筛查真空(且 TR 单正是最大额那批)。确认后置为 true。
   * 开关关闭时仍只提交一笔,但强制 type='finance'(退回旧筛查覆盖面,不产生真空);
   * decision.reason 无论开关状态都落审计,以便观察判定器实际会怎么走。
   */
  private async submitSumsubTxns(deposit: any): Promise<void> {
    // 该开关守的风险是**真实 Sumsub 集成**特有的:租户规则作用域若只含 finance,
    // travelRule 单不进规则 = 筛查真空。mock 模式下没有真实规则引擎,该风险结构性
    // 不存在 —— 用真实集成的安全阀顺手锁死演示/e2e 是范畴错误,会让判定器在整个
    // demo 与 Docker 交付里恒不生效(2026-07-31 验收实测:2090 USDT + VASP 落 finance)。
    const SINGLE_TXN_SUBMIT_ENABLED =
      process.env.SUMSUB_SINGLE_TXN_SUBMIT === 'true' ||
      process.env.SUMSUB_MOCK_MODE === 'true';

    if (deposit.sumsubTxnId) {
      this.logger.debug(
        `Sumsub submit skip: deposit ${deposit.id} already has sumsubTxnId (idempotent)`,
      );
      return;
    }

    const applicantId = deposit.customer?.sumsubApplicantId;
    if (!applicantId) {
      this.logger.warn(
        `Sumsub submit skip: deposit ${deposit.id} customer ${deposit.ownerId} has no sumsubApplicantId — staying in COMPLIANCE_PENDING for manual handling`,
      );
      return;
    }

    const isCrypto = deposit.asset?.type === 'CRYPTO';
    const currencyType: 'fiat' | 'crypto' = isCrypto ? 'crypto' : 'fiat';
    const amount = Number(deposit.amount);
    const currencyCode = deposit.asset?.currency;

    const decision = resolveKytTxnType({
      assetType: deposit.asset?.type,
      currency: deposit.asset?.currency,
      amount,
      counterpartyIsVasp: deposit.counterpartyIsVasp,
    });
    const submitType = SINGLE_TXN_SUBMIT_ENABLED ? decision.type : 'finance';

    const result = await this.sumsubTxnClient.submitTxn({
      applicantId,
      clientTxnId: deposit.depositNo,
      type: submitType,
      direction: 'in',
      amount,
      currencyCode,
      currencyType,
    });

    await this.depositService.setSumsubTxn(deposit.id, {
      sumsubTxnId: result.txnId,
      sumsubTxnType: submitType,
    });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_SUMSUB_SUBMITTED',
      reason: 'Deposit submitted to Sumsub KYT for transaction monitoring',
      metadata: { sumsubTxnId: result.txnId, txnType: submitType, decisionReason: decision.reason },
    });

    this.logger.log(
      `Sumsub txn submitted for deposit ${deposit.id}: type=${submitType} txnId=${result.txnId} (decision=${decision.type}/${decision.reason})`,
    );
  }

  /**
   * 进入 applyKytVerdict 时直接 no-op(幂等,接住迟到的 webhook)。
   *
   * A5(2026-08-13)扩容 + 改名:原名 KYT_VERDICT_TERMINAL_STATUSES 只装 5 个终态,
   * 三个**在途处置态**(CONFISCATING/RETURNING/SEIZING)不在里面 → 一笔正在没收/退回/
   * 上缴的单收到迟到裁决时,会**先执行闸门回写 + 存证**(把原制裁裁决/风险分/原始报文整份
   * 覆盖掉),然后才因为状态机没有对应边而抛错、webhook 重试进死信。最隐蔽的是"迟到的
   * approved"——它连错都不报,静默把上缴中订单的裁决改成通过。
   * 这三个态是「几步之内自动收敛的过渡态」,处置期间不该被任何裁决打断,故一并忽略。
   * 集合已不全是终态,遂改名 IGNORED。
   */
  private static readonly KYT_VERDICT_IGNORED_STATUSES = new Set([
    // 终态
    DepositTransactionStatus.SUCCESS,
    DepositTransactionStatus.FAILED,
    DepositTransactionStatus.CONFISCATED,
    DepositTransactionStatus.RETURNED,
    DepositTransactionStatus.SEIZED,
    // 在途处置态(A5)
    DepositTransactionStatus.CONFISCATING,
    DepositTransactionStatus.RETURNING,
    DepositTransactionStatus.SEIZING,
  ]);

  /**
   * Sumsub KYT 裁决落地入口(DepositKytVerdictHandler 调用)。State-aware:
   * 已终态 no-op;已在目标态(重复 webhook)也 no-op。spec §5.1b + 校正(FROZEN 零记账)。
   */
  async applyKytVerdict(
    depositId: string,
    v: {
      verdict: 'approved' | 'rejected' | 'awaitUser' | 'onHold';
      riskScore?: number | null;
      sceneTag?: SceneTag;
      dispoTag?: DispoTag;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void> {
    const deposit = await this.depositService.findOne(depositId);
    if (!deposit) {
      this.logger.warn(`applyKytVerdict: deposit ${depositId} not found`);
      return;
    }

    // ── ② 判定：必须先于任何写库动作（spec §2.1）──────────────────────────
    const status = deposit.status as DepositTransactionStatus;
    const landing = this.decideVerdictLanding(status, v.verdict);

    if (landing === 'IGNORE') {
      this.logger.debug(
        `applyKytVerdict no-op: deposit ${depositId} in ignored status (${status})`,
      );

      // 终审必修(2026-08-20):忽略分支先落"IGNORED"取证行 —— recordVerdictIgnored
      // 内部自带 .catch,永不抛,保证无论下面冻人是否成功,这条裁决"曾经到过、带
      // 什么 sceneTag"至少留一条痕(metadata 现补了 sceneTag/dispoTag,见其 JSDoc)。
      // 顺序是刻意的:若反过来先冻人、冻人的 open() 抛出(它没有 .catch,是真实的
      // DB 写入,允许失败去触发 webhook 重试),这条 IGNORED 记录就整趟都不会落下,
      // 而 open() 本身的失败不该连累这条本就该发生的取证记录——两件事谁失败都不该
      // 拖累另一件已经能做的事先做完。
      await this.recordVerdictIgnored(deposit, v, status);

      // 单据状态不该决定「人」要不要被限制 —— 与 swap-workflow.service.ts 里
      // REJECTED/SUCCESS carve-out 同一条原则(那里的注释原文:
      // "The order's own state must not decide whether the PERSON gets restricted.")。
      //
      // 真实路径:客户因**别的**因由(ADMIN_SUSPENSION,等级升级被拒 / 补料周期
      // 终止 / admin 手工停用,都是 scope=['ALL'] 会广播)被摁住 → 本域监听器把
      // 这笔在途单冻成 FROZEN → 该单自己的 SANCTION_APPLICANT 裁决随后到达 →
      // 撞上这道闸(decideVerdictLanding 对 FROZEN 一律判 IGNORE)。若在这里直接
      // return,制裁命中被整条丢弃:人不会被冻,运营解除那张 ADMIN_SUSPENSION 便签
      // 后客户完全自由,而审计里也看不出曾有过制裁命中(证据写回在本闸之后,
      // recordVerdictIgnored 的 metadata 此前又不带 sceneTag)。
      //
      // open() 不碰单据状态、且幂等(同客户同 cause 第 2..N 次命中 created=false,
      // 见 customer-restrictions.service.ts openWithin 的 R4 归一),所以这里调它
      // **不破坏**第一批立的「判定先于写库」不变量 —— 状态机仍然一步不动,只是
      // 客户维度多了一张限制便签。
      if (v.sceneTag === 'SANCTION_APPLICANT') {
        await this.customerRestrictionsService.open({
          customerId: deposit.ownerId,
          cause: 'SANCTION',
          reason: `Deposit ${deposit.depositNo} KYT rejected: applicant sanctioned (verdict arrived while order already ${status})`,
          caseRef: deposit.depositNo,
          openedBy: 'system',
        });

        // 站1b-β：独立留痕并入 DEPOSIT_KYT_VERDICT_IGNORED（metadata.sceneTag 已携制裁信号）；冻人动作留痕在客户域限制账。
      }

      return;
    }

    // ── ③ 落地：判定已过 DISPATCH，此刻才允许写证据 ────────────────────────
    // 闸门字段回写:状态机负责"这笔单去哪",闸门字段负责"operator 看得出为什么"。
    await this.writeBackVerdict(deposit, v.verdict, v.riskScore);

    // Sumsub getTxn 原始报文存证。
    if (v.detailRaw !== undefined) {
      await this.depositService.saveTxnDetail(deposit.id, JSON.stringify(v.detailRaw));
    }

    switch (v.verdict) {
      case 'approved':
        await this.applyKytApproved(deposit);
        return;
      case 'awaitUser':
        await this.applyKytAwaitUser(deposit, v.sceneTag, v.applicantActions);
        return;
      case 'onHold':
        await this.applyKytOnHold(deposit);
        return;
      case 'rejected':
        await this.applyKytRejected(deposit, v.sceneTag, v.dispoTag);
        return;
    }
  }

  /**
   * 判定这条裁决该怎么落地。**必须在任何写库动作之前调用。**
   *
   * FROZEN 一律判 IGNORE 的依据：该状态下没有任何 verdict 能合法推动状态机 ——
   *   approved  → applyKytApproved 自己的 FROZEN 守卫 no-op
   *   onHold    → applyKytOnHold 的 status !== COMPLIANCE_PENDING 守卫 no-op
   *   awaitUser → applyKytAwaitUser 全段无 FROZEN 守卫，updateStatus 从 FROZEN
   *               推 ACTION_PENDING 必抛（FROZEN 只有 RESUME/SEIZE 两条出边）
   *   rejected  → SANCTION/FROZEN_BY_MLRO 支要 FREEZE，无自环边，必抛
   * 修复前只有 approvedWillNoOpFrozen 挡 approved 一种，其余三种会先把制裁证据
   * 整份覆盖再静默 no-op。**注意：FROZEN 不加进 KYT_VERDICT_IGNORED_STATUSES**
   * —— 那个集合另有语义（在途处置态），且加进去会影响别处的读取。
   */
  private decideVerdictLanding(
    status: DepositTransactionStatus,
    verdict: 'approved' | 'rejected' | 'awaitUser' | 'onHold',
  ): VerdictLanding {
    if (DepositWorkflowService.KYT_VERDICT_IGNORED_STATUSES.has(status)) return 'IGNORE';
    if (status === DepositTransactionStatus.FROZEN) return 'IGNORE';
    // onHold 只在 COMPLIANCE_PENDING 上有意义（applyKytOnHold 自己的守卫即如此）。
    // 其余状态下它必然静默 no-op —— 判 IGNORE，证据不写、留一条审计。
    // ⚠️ 这一格与 FROZEN 是同族：本批的不变量是「判定必须先于写库」，
    // 只挡 FROZEN 而放过这里，等于同一个洞换个状态继续流血。
    if (verdict === 'onHold' && status !== DepositTransactionStatus.COMPLIANCE_PENDING) {
      return 'IGNORE';
    }
    return 'DISPATCH';
  }

  /**
   * 忽略 ≠ 静默：落一条审计，取证时能指着说"系统收到了、判定不适用、记下来了"。
   *
   * requestId 拼 randomUUID 是**有意为之**（业主 2026-08-19 拍板）：同一笔单收到
   * 3 次迟到裁决要写 3 行，"来了几次"本身是证据。audit-logs.service 的 requestId
   * 去重能力在此被刻意关闭，勿改成稳定键。
   *
   * .catch 是 load-bearing：三个 handler 全无 try/catch，异常会上抛到
   * SumsubIngestionService 的 dispatch catch → retryCount+1 → >=3 进 DEAD。
   * 审计写失败不该把一个本该静默忽略的 webhook 变成死信。但不再哑吞 —— 记 error。
   *
   * 终审必修(2026-08-20):metadata 补 sceneTag/dispoTag —— 此前迟到的
   * SANCTION_APPLICANT/SANCTION_COUNTERPARTY 裁决撞上 IGNORE 分支时，这两个
   * 标签整个不落地，取证链在这里断了一截（MLRO 查这条审计只看得到
   * verdict='rejected'，看不出是不是制裁命中）。
   */
  private async recordVerdictIgnored(
    deposit: any,
    v: { verdict: string; riskScore?: number | null; sceneTag?: SceneTag; dispoTag?: DispoTag },
    status: DepositTransactionStatus,
  ): Promise<void> {
    await this.depositAudit(deposit, {
        action: 'DEPOSIT_KYT_VERDICT_IGNORED',
        reason: `Late KYT verdict '${v.verdict}' ignored — deposit is ${status} (terminal, disposition in flight, or frozen); existing verdict/evidence left untouched`,
        metadata: {
          verdict: v.verdict, status,
          riskScore: v.riskScore ?? null, sceneTag: v.sceneTag ?? null, dispoTag: v.dispoTag ?? null,
        },
      })
      .catch((err) => {
        this.logger.error(`DEPOSIT_KYT_VERDICT_IGNORED audit failed for ${deposit.depositNo}: ${err?.message}`);
      });
  }

  /** webhook 裁决 → 展示投影(sumsubVerdict/sumsubScore)。仅供 L2 显示,不作决策依据。 */
  private async writeBackVerdict(deposit: any, verdict: string, score: number | null | undefined) {
    await this.depositService.updateSumsubVerdict(deposit.id, verdict, score ?? deposit.sumsubScore ?? null);
  }

  /**
   * Trading-ready 闸(法币提现地址,2026-07-11 不变量):approve 前必须客户已设置 active
   * 法币提现地址,否则原地 hold(不改状态)+ 记 DEPOSIT_HELD(reasonCode=NOT_TRADING_READY) 审计。
   * `checkAutoApproval`(老 kyt/tr mock 路径)与 `applyKytApproved`(新 KYT-only 路径)
   * 共享此 helper,消除两路门禁漂移(I1 修复)。
   * 返回 true = trading-ready,调用方可继续;false = 已 hold,调用方须 return。
   */
  private async assertTradingReadyOrHold(deposit: any): Promise<boolean> {
    const ready = await this.withdrawalAddresses.hasActiveFiatWithdrawalAddress(deposit.ownerId);
    if (ready) return true;

    this.logger.warn(
      `Trading-ready gate hold: deposit ${deposit.id} customer ${deposit.ownerId} not trading-ready (no active fiat withdrawal address)`,
    );
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_HELD',
      reasonCode: 'NOT_TRADING_READY',
      reason: 'Deposit held: customer has no active fiat withdrawal address (not trading-ready)',
    });
    return false;
  }

  /**
   * 入账前的**挂起闸**：`limitHoldReason` 非空 = 这笔单还挂着，**一律不得入账**。
   *
   * 返回 true = 已被挂起(调用方须 return,不得放行)。
   *
   * ⚠️ 2026-08-22 终审 Critical：本方法此前叫 `holdBelowMinIfNeeded`、只认
   * `'BELOW_MIN'`。那在 `limitHoldReason` 值域只有一个成员时是等价的 —— 于是
   * 「落到 SUCCESS 的单，`limitHoldReason` 必为 null」这条不变量一直成立，客户面
   * 三处读侧（findAll / findOneForCustomer / findOneForCustomerByDepositNo，判据都是
   * 「非空即整单不可见」）就靠它。B4 的 `holdAtGate0` 把值域扩到三个
   * （+ CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE）之后，只认 BELOW_MIN 就漏：
   * approveDeposit 的白名单有四个入口（COMPLIANCE_PENDING / ACTION_PENDING /
   * MANUAL_CHECKING / OPERATION_PENDING），当时只有 OPERATION_PENDING 那一条被
   * 单独的 no-op 特判盖住。终审实测复现的漏法（钱对、记录消失）：
   *   Gate 0 行政级挂起 → OPERATION_PENDING(CAPABILITY_RESTRICTED)
   *   → 后开的制裁便签广播 freeze → FROZEN
   *   → 误报，MLRO 解冻 RESUME → COMPLIANCE_PENDING（**这一路不清挂起原因**）
   *   → Gate 0 重跑 PASS → 送 Sumsub → KYT approved → approveDeposit
   *     此时 oldStatus=COMPLIANCE_PENDING，特判不适用、旧闸不认 →
   *     TB 过账落 SUCCESS，而 limitHoldReason 仍是 'CAPABILITY_RESTRICTED'
   *     → 余额加了全额，单子对客户永久不可见（列表无、筛选桶无、详情 404），
   *       且没有任何调用方会再清这一列。
   * 判据泛化成「非空即挂」后，四条入口一次性全部恢复不变量。**不要再收窄回
   * 特定原因名** —— 那等于把这个洞按原样装回去。
   *
   * 判定依据是单子当前落库的 `limitHoldReason`,**不在此处重查限额规则** —— 规则可能在
   * 单子生命周期内被改,用落库的标记更稳定、可追溯。BELOW_MIN 的边界沿用建单时的
   * `amount < min`,即恰好等于下限放行。
   *
   * ⚠️ 已经在 OPERATION_PENDING 的单：no-op 返回 true（不再尝试 operation_pending
   * 动作 —— 转移表在这个状态上没有自环边，会抛 Invalid action）。合法的重复调用
   * （operator 手滑双击、上游重放）由此得到干净的早退。真正解除挂起走
   * `waiveLimitHold`。
   *
   * ⚠️ 审计动作归一 `DEPOSIT_HELD`（站1b-β 词表），**实际挂起原因**进 reasonCode
   * 说真话（硬写 BELOW_MIN 语义到一笔行政级挂起上是伪证据），状态变化进从/到两列。
   */
  private async holdIfHeld(deposit: any): Promise<boolean> {
    const holdReason: string | null = deposit.limitHoldReason ?? null;
    if (!holdReason) return false;

    if (deposit.status === DepositTransactionStatus.OPERATION_PENDING) {
      this.logger.debug(
        `approveDeposit no-op: deposit ${deposit.id} already OPERATION_PENDING with hold intact ` +
          `(${holdReason}) — repeat approve ignored, release the hold first`,
      );
      return true;
    }

    const belowMin = holdReason === 'BELOW_MIN';
    const reason = belowMin
      ? 'Compliance approved; amount below configured minimum — awaiting ops disposition'
      : `Compliance approved; deposit still held (${holdReason}) — awaiting ops disposition`;

    await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.OPERATION_PENDING,
        reason,
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'SYSTEM' },
        sourcePlatform: 'SYSTEM',
      },
    );

    if (belowMin) {
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_HELD',
        reasonCode: 'BELOW_MIN',
        reason: 'Deposit held: compliance approved but amount below configured minimum (BELOW_MIN)',
        metadata: { amount: String(deposit.amount), limitHoldReason: holdReason },
      });
    } else {
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_HELD',
        reasonCode: holdReason,
        reason: `Compliance approved but the deposit hold is still in place (${holdReason}) — not credited, awaiting ops disposition`,
        fromStatus: deposit.status,
        toStatus: DepositTransactionStatus.OPERATION_PENDING,
      });
    }

    this.logger.warn(
      `Hold intact: deposit ${deposit.id} approved by compliance but still held (${holdReason}) — OPERATION_PENDING`,
    );
    return true;
  }

  private async applyKytApproved(deposit: any) {
    // FROZEN 在 decideVerdictLanding 已一律判 IGNORE（含 approved，留 DEPOSIT_KYT_VERDICT_IGNORED
    // 审计），到不了这里——旧的方法内 FROZEN 守卫已随站1b-α 删除（保护上收，不双写）。
    const ready = await this.assertTradingReadyOrHold(deposit);
    if (!ready) return;

    if (deposit.status === DepositTransactionStatus.MANUAL_CHECKING) {
      // 误报翻案:此前进了人工复核,官方裁决翻回 approved。记账/SUCCESS 由下面的
      // approveDeposit 统一处理,这里只补一条“翻案”审计。
      // 站1b-β：翻案不再单独留痕——approveDeposit 的 DEPOSIT_APPROVED 携 fromStatus=MANUAL_CHECKING 即翻案证据。
    }
    // 金额闸(BELOW_MIN)已下沉到 approveDeposit() 内部——它是资金入账唯一出口,
    // 这里不再重复判定(见 approveDeposit 的 JSDoc)。
    await this.approveDeposit(deposit.id);
  }

  private async applyKytAwaitUser(
    deposit: any,
    sceneTag?: SceneTag,
    applicantActions?: { applicantActionId: string; externalActionId: string }[],
  ) {
    const incoming = applicantActions ?? [];

    // 集合同步先做:无论状态动不动,子表都必须与报文的**全量列表**对齐。
    const { added, retired } = await this.applicantActions.syncApplicantActions(
      deposit.id,
      incoming,
      sceneTag,
    );

    // I1 修复(反直觉,细说原因):两个 Sumsub client 在
    // scoringResult.applicantActions 缺席时都返回 undefined,handler 组装报文时
    // `...(applicantActions?.length && {...})` 又把空数组拍成 undefined——于是这里
    // 的 incoming 完全可能是 []。若同步之后这笔单一条未提交行都没有,绝不能放它
    // 进入/停留在 ACTION_PENDING:那是一个"ACTION_PENDING 但零条可提交项"的死角——
    // 客户列表徽章显示 ACTION REQUIRED、落 ACTION_REQUIRED 桶,但详情页因
    // `actions.some(a => !a.submittedAt)` 为 false 不渲染任何入口,7 天后 SLA 定时器
    // 还会把它打成 MANUAL_CHECKING、理由写"客户未按时补料"——把锅扣在一个根本无从
    // 操作的客户头上。判据必须是"同步后是否还有未提交行"(hasOutstanding),不能只
    // 看 incoming 是否为空:报文也可能带的全是已经提交过的旧 id,同样零未提交。
    const hasOutstanding = await this.applicantActions.hasOutstanding(deposit.id);

    if (deposit.status === DepositTransactionStatus.ACTION_PENDING) {
      if (!hasOutstanding) {
        // 同状态分支同款死角:"全删成空集"不能当正常的 reissue 处理——
        // 不清缓存、不推进,只记一条 warn 留痕,供排查上游报文异常。
        this.logger.warn(
          `applyKytAwaitUser: deposit ${deposit.id} synced to zero outstanding actions while already ACTION_PENDING, refusing to treat as reissue`,
        );
        // 站1b-β：空清单异常留痕删除（业主裁定），warn 日志足够。
        return;
      }

      // 已在 ACTION_PENDING:集合已同步——no-op 返回。
      // (旧 I2 清缓存弧随 actionSubmittedAt 死列于站1b-α 一并删除:守卫读的列
      //  从无非空写入方,整弧不可达;clearDepositCache/DEPOSIT_ACTION_REISSUED
      //  同殉。原文与设计理由见 git 史。)
      return;
    }

    if (!hasOutstanding) {
      // 跨状态弧(COMPLIANCE_PENDING/MANUAL_CHECKING → ACTION_PENDING)同款死角:
      // 同步之后没有任何未提交行,不能推进到 ACTION_PENDING——单子留在原状态,
      // 只记一条 warn 留痕。
      this.logger.warn(
        `applyKytAwaitUser: deposit ${deposit.id} received awaitUser verdict with zero outstanding actions after sync, keeping status ${deposit.status}`,
      );
      // 站1b-β：空清单异常留痕删除（业主裁定），warn 日志足够。
      return;
    }

    const manualReason =
      sceneTag === 'PEP_APPLICANT' || sceneTag === 'PEP_COUNTERPARTY' ? 'EDD_PEP' : 'CLIENT_ACTION';
    const oldStatus = deposit.status;
    // slaDeadline/slaBreached 不在这里写:进入 ACTION_PENDING 由 updateStatus
    // 内部的 resolveSlaFields 统一算,这里再传会覆盖收口处刚算好的值。
    const updated = await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.ACTION_PENDING,
        reason: 'KYT verdict: awaitUser',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
        sourcePlatform: 'SYSTEM',
        extraData: {
          manualReason,
        },
      },
    );

    await this.depositAudit(updated, {
      action: 'DEPOSIT_ACTION_REQUIRED',
      reason: `KYT verdict: awaitUser (manualReason=${manualReason})`,
      fromStatus: oldStatus,
      toStatus: updated.status,
      metadata: { manualReason },
    });
  }

  /**
   * Sumsub onHold 回调：只记录「官员接手在看了」这一事实。
   *
   * ⚠️ 2026-08-21：本方法**不再**设 slaDeadline。SLA 按「状态」计时
   * （进入 COMPLIANCE_PENDING 时由 DepositTransactionsService.resolveSlaFields 设），
   * 与状态内部收到什么 webhook 无关。此前把计时挂在这里，导致「没收到 onHold 的单
   * 永远不计时」——那正是「Sumsub 一直不回、单子永远挂在合规中」的成因。
   * 不要把 SLA 逻辑再绑回任何 webhook 上。
   */
  private async applyKytOnHold(deposit: any) {
    // Minor b 修复:状态守卫——onHold 只对当前在 COMPLIANCE_PENDING 的 deposit 生效。
    // 迟到的 onHold webhook(deposit 已转到 ACTION_PENDING/MANUAL_CHECKING/FROZEN 等其它
    // 状态)no-op,防止记多余 DEPOSIT_ONHOLD 审计。
    if (deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING) {
      this.logger.debug(
        `applyKytOnHold no-op: deposit ${deposit.id} not in COMPLIANCE_PENDING (status=${deposit.status}), late onHold webhook ignored`,
      );
      return;
    }

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_ONHOLD',
      reason: 'KYT verdict: onHold, awaiting officer review',
      metadata: { note: 'onHold 不影响 SLA —— SLA 按状态计时,见 DEPOSIT_SLA_MINUTES_BY_STATUS' },
    });
  }

  private async applyKytRejected(
    deposit: any,
    sceneTag?: SceneTag,
    dispoTag?: DispoTag,
  ) {
    const isApplicantSanction = sceneTag === 'SANCTION_APPLICANT';
    if (
      isApplicantSanction ||
      sceneTag === 'SANCTION_COUNTERPARTY' ||
      dispoTag === 'FROZEN_BY_MLRO'
    ) {
      if (deposit.status === DepositTransactionStatus.FROZEN) return; // 已在目标态,防重复 webhook

      // 客户本人命中 → 先冻人、再冻单。
      //
      // 顺序是 load-bearing 的：两者分属两次独立提交（open() 自开
      // $transaction，updateStatus 是独立 update），中途崩溃必然留半成品。
      // 先冻人的残局是「人冻了、单没冻」：
      //   - updateStatus 抛异常但进程还活着 → open() 广播的 CUSTOMER_RESTRICTION_OPENED
      //     会被本域自己的 onCustomerRestrictionOpened 接住，把在途单（含这一笔）冻掉，
      //     内存事件当场自愈。
      //   - 进程直接崩溃 → 内存事件和挂起的 listener promise 一起死，指望不上它；真正
      //     兜底的是 Sumsub webhook 重试：重跑 applyKytVerdict，open() 幂等返回
      //     created=false，照常往下冻单。
      // 无论走哪条兜底路径，即便真留下「人冻了、单没冻」的窗口，新单进
      // COMPLIANCE_PENDING 时 Gate 0（本文件 runGate0）会读限制账直接冻掉，提现/兑换
      // 也被能力闸硬挡 —— 损害收敛。反过来「单冻了、人没冻」，客户下一单畅通无阻，方向
      // 危险。不要因为"看起来能合并"或"先改状态更直觉"调换。
      if (isApplicantSanction) {
        await this.customerRestrictionsService.open({
          customerId: deposit.ownerId,
          cause: 'SANCTION',
          reason: `Deposit ${deposit.depositNo} KYT rejected: applicant sanctioned`,
          // caseRef 传单号只为可读；SANCTION 是客户级因由，openWithin 会归一成
          // customerNo（restriction-cause.constant.ts R4）。哪笔单牵出来的由上面
          // 的 reason 和审计承载。
          caseRef: deposit.depositNo,
          openedBy: 'system',
        });
      }

      await this.depositService.updateStatus(
        deposit.id,
        { action: DepositTransactionAction.FREEZE, reason: 'KYT verdict: rejected' },
        {
          actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
          sourcePlatform: 'SYSTEM',
        },
      );
      // 校正:FROZEN 零记账——钱留在 DEPOSIT_SUSPENSE,不释放/不过账。
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_FROZEN',
        fromStatus: deposit.status,
        toStatus: DepositTransactionStatus.FROZEN,
        reason: isApplicantSanction
          ? 'KYT verdict rejected: SANCTION_APPLICANT hit (order frozen + customer restricted)'
          : sceneTag === 'SANCTION_COUNTERPARTY'
            ? 'KYT verdict rejected: SANCTION_COUNTERPARTY hit (order frozen only)'
            : 'KYT verdict rejected: FROZEN_BY_MLRO disposition',
        metadata: { sceneTag: sceneTag ?? null, dispoTag: dispoTag ?? null },
      });
      return;
    }

    if (dispoTag === 'RETURN_TO_SENDER') {
      if (deposit.status === DepositTransactionStatus.RETURNING) return; // 已在目标态,防重复 webhook

      // A2 着陆垫(2026-08-13):initiateReturn 只接受 RETURNABLE_STATUSES(C1 后为
      // MANUAL_CHECKING / OPERATION_PENDING),非该态一律抛
      // BadRequestException——而本方法下面只 catch ConflictException,异常会一路上抛,
      // webhook 三次重试后进死信:不开审批、不流转、不记审计,界面上"点了没反应",
      // 钱一直压在 DEPOSIT_SUSPENSE 里。而合规官最标准的操作恰恰是「一边打 RETURN_TO_SENDER
      // tag 一边驳回」,此刻单子还在 COMPLIANCE_PENDING/ACTION_PENDING。
      // 修法:先落 MANUAL_CHECKING(tag 写进 reason 供合规官重驱),与提现域
      // withdraw-workflow.service.ts 的同名着陆垫同构。
      if (deposit.status !== DepositTransactionStatus.MANUAL_CHECKING) {
        await this.depositService.updateStatus(
          deposit.id,
          {
            action: DepositTransactionAction.KYT_REJECTED,
            reason: `KYT verdict: rejected, officer RETURN_TO_SENDER tag arrived early (status=${deposit.status}) — landed in manual review for re-drive`,
          },
          {
            actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
            sourcePlatform: 'SYSTEM',
          },
        );
        await this.depositAudit(deposit, {
          action: 'DEPOSIT_MANUAL_CHECKING',
          reasonCode: 'KYT_REJECTED',
          reason: `RETURN_TO_SENDER tag arrived while status=${deposit.status} — landed in manual review; officer can re-drive the return from there`,
          metadata: { earlyReturnTag: true },
        });
        return;
      }

      // A2: 不再直推 RETURNING——改开 maker-checker 审批(MLRO 单步),deposit 留
      // MANUAL_CHECKING;批准后的实际结算(出场腿/记账)留 A3(见 initiateReturn/onReturnDecided)。
      try {
        await this.initiateReturn(
          deposit.id,
          { reason: 'KYT verdict rejected: RETURN_TO_SENDER disposition' },
          DepositWorkflowService.KYT_VERDICT_ACTOR,
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          // Minor (A2 review): this catch assumes ConflictException can only come from
          // initiateReturn's own anti-dup guard (an already-open DEPOSIT_RETURN approval)
          // — initiateReturn's only other throw is BadRequestException (wrong status /
          // blank reason), never caught here. If initiateReturn's error surface ever
          // grows a second ConflictException source, this blanket catch would swallow it.
          // 已有一笔在途的退回审批——重复 webhook 命中防重闸,幂等 no-op。
          this.logger.debug(
            `applyKytRejected RETURN_TO_SENDER: deposit ${deposit.id} already has a pending return approval`,
          );
          return;
        }
        throw err;
      }
      return;
    }

    // 无处置 tag → 转人工复核
    if (deposit.status === DepositTransactionStatus.MANUAL_CHECKING) return; // 已在目标态,防重复 webhook

    await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.KYT_REJECTED,
        reason: 'KYT verdict: rejected, no disposition tag',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
        sourcePlatform: 'SYSTEM',
      },
    );
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_MANUAL_CHECKING',
      reasonCode: 'KYT_REJECTED',
      reason: 'KYT verdict rejected: routed to manual compliance review',
    });
  }


  async checkAutoApproval(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);

    // Task 7 companion fix: this is waiveLimitHold's re-evaluation entry point, and a
    // waived BELOW_MIN hold now lives on OPERATION_PENDING (not COMPLIANCE_PENDING —
    // that edge moved with the confiscation/waive entry conditions). Without this,
    // waiveLimitHold silently never re-approves an OPERATION_PENDING deposit.
    if (
      deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING &&
      deposit.status !== DepositTransactionStatus.OPERATION_PENDING
    ) {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} status is ${deposit.status}`,
      );
      return;
    }

    // 放行由 webhook 裁决驱动;这里读的是裁决字段(不是展示用的翻译值)。
    if (deposit.sumsubVerdict !== 'approved') {
      this.logger.debug(`Auto-approval skip: deposit ${depositId} sumsubVerdict=${deposit.sumsubVerdict}`);
      return;
    }
    // 原 travelRuleStatus 那道闸整条删除 —— 一笔单只有一个 type,不存在「另一腿未过」。

    const autoApproveDeposit = await this.depositService.findOne(depositId);
    const autoApproveAccess = await this.customerAccessService.resolve(autoApproveDeposit.ownerId);
    if (autoApproveAccess.blocked.has('DEPOSIT')) {
      this.logger.warn(
        `Auto-approval skip: deposit ${depositId} — customer DEPOSIT capability is blocked`,
      );
      return;
    }

    const ready = await this.assertTradingReadyOrHold(deposit);
    if (!ready) return;

    // 金额闸(BELOW_MIN)已下沉到 approveDeposit() 内部——它是资金入账唯一出口,
    // 这里不再重复判定(见 approveDeposit 的 JSDoc)。
    this.logger.log(
      `All gates PASSED for deposit ${depositId} — auto-approving`,
    );
    await this.approveDeposit(depositId);
  }

  /**
   * 充值资金入账的**唯一出口**——所有放行路径(applyKytApproved 的 webhook 驱动路径、
   * checkAutoApproval 的老 mock 自动放行路径、admin 直调 PATCH /deposit-transactions/:id/status
   * {action: approve} 的人工路径)最终都汇聚到这一个函数记账+转 SUCCESS。
   *
   * 挂起闸(`limitHoldReason` 非空即挂,见 holdIfHeld)因此也装在这里,紧跟在 oldStatus
   * 白名单校验通过之后、任何记账/状态推进之前:装在出口上只需把一次关,不会再出现"调用点
   * 忘了加闸"——历史上就出现过 admin 直接 PATCH 状态接口绕过 applyKytApproved/
   * checkAutoApproval 里各自的闸、直接把 BELOW_MIN 单放行入账的资金安全缺口。
   * 不要再往调用点(applyKytApproved/checkAutoApproval 等)上加这道闸。
   *
   * ⚠️ 2026-08-22 终审 Critical：这道闸此前只认 `BELOW_MIN`，且「已在 OPERATION_PENDING
   * 且挂起未解除」的 no-op 被写成 `oldStatus === OPERATION_PENDING` 的独立特判 ——
   * 白名单里另外三个入口（COMPLIANCE_PENDING / ACTION_PENDING / MANUAL_CHECKING）
   * 一个都没盖到，带着行政级挂起原因绕回这三态的单会带着 `limitHoldReason` 落 SUCCESS
   * （复现路径见 holdIfHeld 的 JSDoc）。现在特判并入 holdIfHeld，判据泛化成「非空即挂」，
   * 四条入口共用同一道闸。
   */
  async approveDeposit(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);
    const oldStatus = deposit.status;

    if (
      oldStatus !== DepositTransactionStatus.COMPLIANCE_PENDING &&
      oldStatus !== DepositTransactionStatus.ACTION_PENDING &&
      oldStatus !== DepositTransactionStatus.MANUAL_CHECKING &&
      // Task 7 companion fix: OPERATION_PENDING is the waived-hold re-approval path
      // (waiveLimitHold clears limitHoldReason then re-runs checkAutoApproval, which
      // now calls in here). A still-held OPERATION_PENDING deposit reaching this
      // point without going through the waive is handled inside holdIfHeld (explicit
      // no-op) — the transition table has no operation_pending edge from an
      // already-OPERATION_PENDING deposit, so re-issuing the action would throw
      // instead of a clean no-op; no silent bypass either way.
      oldStatus !== DepositTransactionStatus.OPERATION_PENDING
    ) {
      // FROZEN is the sanctions/MLRO-hold case: a caller reaching this path is a
      // request (HTTP PATCH via the controller), not the webhook no-op path
      // (applyKytApproved has its own earlier FROZEN guard and never calls in
      // here). A blocked single-operator attempt to release frozen funds is
      // exactly the event regulators expect to see recorded — audit it and fail
      // loud instead of a silent 200.
      if (oldStatus === DepositTransactionStatus.FROZEN) {
        this.logger.warn(
          `Blocked approve on FROZEN deposit ${depositId}: sanctions/MLRO hold requires unfreeze maker-checker, not a direct approve.`,
        );
        await this.depositAudit(deposit, {
          action: 'DEPOSIT_APPROVED',
          outcome: AuditOutcome.DENIED,
          reasonCode: 'FROZEN',
          reason: 'Blocked: attempted approve on a FROZEN deposit — requires unfreeze approval (MLRO), not a direct approve',
          sourcePlatform: 'ADMIN_API',
        });
        throw new BadRequestException({
          code: 'DEPOSIT_APPROVE_BLOCKED_FROZEN',
          message:
            'Deposit is FROZEN — release requires the unfreeze maker-checker approval, not a direct approve.',
        });
      }
      this.logger.warn(`Deposit ${depositId} in ${oldStatus}, cannot approve.`);
      return;
    }

    // 挂起闸：`limitHoldReason` 非空 = 不得入账。四条白名单入口共用这一道
    //（含「已在 OPERATION_PENDING、挂起未解除」的重复调用 no-op —— 并入 holdIfHeld，
    // 不再是这里的 oldStatus 特判，那个特判只盖得住四条里的一条）。
    if (await this.holdIfHeld(deposit)) return;


    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      try {
        const [payinFundsOrder] = await this.fundsOrders.findByParent(
          { depositTransactionId: deposit.id },
          { legSeq: 1 },
        );
        await this.executeDepositAccounting(deposit, 'STEP_2', payinFundsOrder);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`TB Step 2 failed for deposit ${depositId}: ${error.message}`);
        await this.depositAudit(deposit, {
          action: 'DEPOSIT_APPROVED',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'ACCOUNTING',
          reason: `TB Step 2 failed: ${error.message}`,
          metadata: { eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE', step: 'STEP_2' },
        });
        return;
      }
    }

    const approvedRow = await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.APPROVE,
    });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_APPROVED',
      reason: 'Compliance approved, funds credited to client',
      fromStatus: oldStatus,
      toStatus: approvedRow.status,
    });


    this.logger.log(`Deposit ${depositId} approved and credited.`);
  }

  async adminFreeze(
    depositId: string,
    reason: string | undefined,
    actor: { actorId: string; actorRole?: string },
  ) {
    const deposit = await this.depositService.findOne(depositId);
    const updated = await this.depositService.updateStatus(
      depositId,
      { action: DepositTransactionAction.FREEZE, reason },
      {
        actor: {
          actorType: 'ADMIN',
          actorId: actor.actorId,
          actorRole: actor.actorRole,
        },
        sourcePlatform: 'ADMIN_API',
      },
    );
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_FROZEN',
      fromStatus: deposit.status,
      toStatus: updated.status,
      reason: reason || 'Admin freeze',
      actor: {
        actorType: 'ADMIN',
        actorNo: actor.actorId,
        actorDisplayName: actor.actorId,
        actorRolesAtTime: [actor.actorRole || 'UNKNOWN'],
      },
      sourcePlatform: 'ADMIN_API',
    });
    return updated;
  }

  /**
   * PASS (release) disposition: ops 解除这一笔单的挂起。
   * This does NOT approve/入账 the deposit — it clears the hold and re-runs
   * `checkAutoApproval`. Single-operator action — no maker-checker.
   *
   * ⚠️ 2026-08-22 终审 I1 · 这段 JSDoc 此前写的是「re-runs checkAutoApproval so the
   * deposit proceeds through the normal L2 compliance gates」——**这个承诺兑现不了**，
   * 已订正为下面的如实描述：
   *
   *   `checkAutoApproval` 只在这笔单**已经有 Sumsub 裁决**（`sumsubVerdict === 'approved'`）
   *   时才会往下推进；裁决为 null 时它提前 return。而 **Gate 0 挂起的单从未送检** ——
   *   `holdAtGate0` 那条分支刻意不调 `submitSumsubTxns`。所以：
   *     · BELOW_MIN 挂起（合规已过之后才落的闸）→ 有裁决 → waive 后确实会自动放行。
   *     · 行政级挂起（CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE，Gate 0 落的）
   *       → **没有裁决** → waive 之后 `checkAutoApproval` 静默早退，单子停在
   *       OPERATION_PENDING、无挂起、无 KYT 案，**不会**自动走合规。
   *
   *   此时这笔单的处境：waive 再点会抛（挂起已清）、没收要求 BELOW_MIN、详情页没有
   *   Approve 按钮，实际只剩「原路退回汇款人」一条出路，否则钱一直压在 DEPOSIT_SUSPENSE。
   *   `OPERATION_PENDING --resume--> COMPLIANCE_PENDING` 这条能重新武装 Gate 0 的边
   *   **不存在**（FROZEN 有、这里没有），所以也重跑不了。
   *
   *   三个候选解法（挂起分支也送检 / 补 resume 边 / 维持现状但把文案说清）待业主拍板，
   *   已登记 BACKLOG。**本批不改行为。**
   *
   * B4（§3）：守卫从只认 `BELOW_MIN` 放宽到**任何非空挂起原因**。原因是 Gate 0
   * 开始往 OPERATION_PENDING 上落行政级挂起（CAPABILITY_RESTRICTED /
   * LIFECYCLE_NOT_ACTIVE）之后，这类单若还只有 BELOW_MIN 能 waive，就**出场无路**
   * ——没收那条路刻意不放宽（见 initiateConfiscation），approve 在挂起未解除时
   * 是 no-op，钱会一直压在 DEPOSIT_SUSPENSE 里。
   *
   * ⚠️ 放宽的是「不再挑挂起原因」，**不是**「没有挂起也能 waive」：`!limitHoldReason`
   * （null / 空串）照旧拒。
   */
  async waiveLimitHold(
    depositId: string,
    actor: { actorId: string; actorRole?: string },
  ) {
    const deposit = await this.depositService.findOne(depositId);
    if (
      !deposit.limitHoldReason ||
      deposit.status !== DepositTransactionStatus.OPERATION_PENDING
    ) {
      throw new BadRequestException(
        'Deposit has no hold to release',
      );
    }

    await this.depositService.clearLimitHold(depositId);

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_LIMIT_WAIVED',
      reason: `Ops released the deposit hold (${deposit.limitHoldReason}); compliance gates still apply`,
      metadata: { amount: String(deposit.amount), limitHoldReason: deposit.limitHoldReason },
      actor: {
        actorType: 'ADMIN',
        actorNo: actor.actorId,
        actorDisplayName: actor.actorId,
        actorRolesAtTime: [actor.actorRole || 'UNKNOWN'],
      },
      sourcePlatform: 'ADMIN_API',
    });

    await this.checkAutoApproval(depositId);
  }

  /**
   * CONFISCATE disposition (initiate side): ops proposes taking a below-min deposit
   * as a T&C handling fee. High-risk (moves customer-attributed money to platform
   * revenue) → routed through V1 maker-checker approval (single-step OPS_OFFICER),
   * unlike the single-operator PASS/waive. This only opens the approval case + audits
   * the request; the two-leg posting + status→CONFISCATED lands in D7's decided-event
   * handler (Rule 5: initiate reads only, never writes the deposit table here).
   */
  async initiateConfiscation(
    depositId: string,
    dto: { reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Confiscation reason is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (
      deposit.limitHoldReason !== 'BELOW_MIN' ||
      deposit.status !== DepositTransactionStatus.OPERATION_PENDING
    ) {
      throw new BadRequestException(
        'Deposit has no BELOW_MIN hold to confiscate',
      );
    }

    // Anti-dup: a deposit must not accrue two open confiscation approvals.
    const openConfiscations = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_CONFISCATION,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openConfiscations.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending confiscation approval; resolve it before submitting another.`,
      );
    }

    // Mint the trace id ONCE and reuse it in both the create and submit DTOs — the
    // approvals engine mints its own id when createDto.traceId is undefined, then asserts
    // create/submit trace consistency, so a recomputed/divergent id (null-traceId path)
    // would reject the whole confiscation. Mirrors transaction-limit initiateCreate/Change.
    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_CONFISCATION,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
          basis: 'T&C below-minimum deposit handling fee',
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_CONFISCATION_REQUESTED',
      reason: 'Ops requested confiscation of below-minimum deposit as T&C handling fee',
      approvalNo: approvalCase.approvalNo,
      metadata: { amount: String(deposit.amount) },
      actor: this.toAuditActor(actor),
      sourcePlatform: 'ADMIN_API',
    });

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * CONFISCATE disposition (decided side, D7): the V1 approval opened by
   * initiateConfiscation reached a decision. On APPROVED, START the confiscation
   * (two PENDING accounting legs + legSeq 2 funds order CREATED + status→CONFISCATING;
   * the POST/settle half lands in C3). On any other outcome the deposit stays
   * OPERATION_PENDING with its BELOW_MIN hold intact — the approvals engine owns the
   * rejection/cancel/expire audit trail, so this is a clean no-op (idempotent).
   *
   * entityRef is the deposit id. A foreign entityRef (some other workflow's) makes
   * findOne throw NotFound → graceful no-op. An already-CONFISCATED deposit (replayed
   * decided event) → no-op.
   */
  @OnEvent('workflow.deposit-confiscation.decided', { async: true })
  async onConfiscationDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit confiscation decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // entityRef belongs to another workflow's entity — not ours, ignore.
        return;
      }
      throw err;
    }

    // Idempotent replay no-op: both CONFISCATED (settle done) and CONFISCATING (start done,
    // settle in flight) are already-handled states. Without CONFISCATING here, a replayed
    // decided event mid-flight would fall into the drift-precondition guard below and record
    // a MISLEADING "drifted out of confiscable state" FAILED audit for a perfectly healthy move.
    if (
      deposit.status === DepositTransactionStatus.CONFISCATED ||
      deposit.status === DepositTransactionStatus.CONFISCATING
    ) {
      this.logger.debug(`Deposit ${deposit.depositNo} already ${deposit.status} — skipping decided replay.`);
      return;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} confiscation ${event.decision} (case ${event.approvalNo}) — hold intact, no confiscation.`,
      );
      return;
    }

    // Re-assert the confiscable precondition BEFORE posting anything. initiateConfiscation
    // (D6) writes NOTHING to the deposit, so while the approval sat PENDING the deposit
    // stayed mutable — a concurrent waiveLimitHold→approve (→SUCCESS) can have drifted it
    // out of the confiscable state (OPERATION_PENDING's only other edge is
    // confiscate_start, so SUCCESS is the sole drift target since the state-machine
    // narrowing removed OPERATION_PENDING's reject/freeze/action_pending edges). Posting
    // the two legs against a SUCCESS deposit would zero CLIENT_ASSET while CLIENT_PAYABLE
    // still owes the customer → phantom liability / double-spend (and the negative
    // suspense would net the L/E identity, hiding it from recon). Guard: post NO legs,
    // create NO funds order, change NO status when drifted — just leave an audit trail for
    // ops.
    if (
      deposit.status !== DepositTransactionStatus.OPERATION_PENDING ||
      deposit.limitHoldReason !== 'BELOW_MIN'
    ) {
      this.logger.warn(
        `Confiscation skipped: deposit ${deposit.depositNo} no longer confiscable ` +
          `(status=${deposit.status}, hold=${deposit.limitHoldReason})`,
      );
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_CONFISCATION_STARTED',
        outcome: AuditOutcome.DENIED,
        reasonCode: 'NOT_CONFISCABLE',
        reason:
          'Approved confiscation not executed: deposit drifted out of confiscable state ' +
          '(waived/rejected before approval landed)',
        approvalNo: event.approvalNo,
        causationId: event.approvalId,
        metadata: { status: deposit.status },
      });
      return;
    }

    await this.startConfiscation(deposit, event.approvalNo, event.approvalId);
  }

  /**
   * 没收弧处置说明书（地基站 2026-08-26：钱侧六件套收敛进 DispositionService，
   * 本弧只保留业务判断与留痕；账本/资金单机制见 disposition.service.ts 头注，
   * 六件套原文见 git 历史）。两笔锁定：①反冲暂扣（SUSPENSE→CLIENT_ASSET，逐字
   * 反转 payin STEP_1）②没收计入其他收入（FIRM_ASSET→INCOME_OTHER，与服务费
   * 隔离）；均为行内重分类、非外部穿越。目的地=公司 F_FEE 钱包（by-wallet 对账锚）。
   */
  private confiscationSpec(
    deposit: any,
    firmFeeWallet: { id: string; address?: string | null; iban?: string | null },
  ): DispositionSpec {
    const asset = deposit.asset;
    if (!asset) throw new Error(`Deposit ${deposit.id} has no associated asset`);
    if (!asset.tbLedgerId) throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    const customerWalletRef: string | null = deposit.toWalletId ?? null;
    return {
      kind: 'CONFISCATE', sourceType: 'DEPOSIT', sourceNo: deposit.depositNo,
      traceId: deposit.traceId || deposit.id,
      ledger: asset.tbLedgerId, currency: asset.currency, decimals: asset.decimals,
      amount: String(deposit.amount), legSeq: 2,
      buildLegInput: (attempt: number) => ({
        depositTransactionId: deposit.id, legSeq: 2, attempt,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: deposit.assetId, amount: String(deposit.amount), netAmount: String(deposit.amount),
        fromWalletId: deposit.toWalletId ?? null, fromAddress: deposit.toAddress ?? undefined, fromIban: deposit.toIban ?? undefined,
        toWalletId: firmFeeWallet.id, toAddress: firmFeeWallet.address ?? undefined, toIban: firmFeeWallet.iban ?? undefined,
        traceId: deposit.traceId || undefined,
      }),
      tbLegs: [
        {
          transferCode: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET,
          eventCode: 'CONFISCATE_REVERSE_SUSPENSE', voidEventCode: 'CONFISCATE_REVERSE_SUSPENSE_VOID',
          debit: { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId },
          credit: { code: TB_ACCOUNT_CODES.CLIENT_ASSET, ownerType: 'SYSTEM' },
          debitCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          memo: 'Below-min confiscation reverse suspense (pending)',
          debitWalletRef: customerWalletRef, creditWalletRef: customerWalletRef, isExternalCrossing: false,
        },
        {
          transferCode: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_INCOME_OTHER,
          eventCode: 'CONFISCATE_INCOME_OTHER', voidEventCode: 'CONFISCATE_INCOME_OTHER_VOID',
          debit: { code: TB_ACCOUNT_CODES.FIRM_ASSET, ownerType: 'SYSTEM' },
          credit: { code: TB_ACCOUNT_CODES.INCOME_OTHER, ownerType: 'SYSTEM' },
          debitCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_OTHER],
          memo: 'Below-min confiscation fee income (pending)',
          debitWalletRef: null, creditWalletRef: firmFeeWallet.id, isExternalCrossing: false,
        },
      ],
    };
  }

  /**
   * 起始半程（先账后状态）：engine.initiate 幂等复用既有 legSeq 2 单（防
   * startConfiscation 被重复调用，与腿级重试无关）+ 挂两笔 pending，随后才翻
   * CONFISCATE_START。settle 半程见 settleConfiscation。
   */
  private async startConfiscation(deposit: any, approvalNo?: string, causationId?: string) {
    const firmFeeWallet = await this.systemWalletResolver.resolve(deposit.assetId, 'F_FEE');
    const spec = this.confiscationSpec(deposit, firmFeeWallet);
    await this.disposition.initiate(spec);

    await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CONFISCATE_START, reason: 'Below-min confiscation started (funds in transit)' });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_CONFISCATION_STARTED',
      approvalNo,
      causationId,
      metadata: { amount: String(deposit.amount) },
    });
  }

  /**
   * settle 半程路由。守卫与 attempt 语义同六件套时代：终态腿才读库、只有仍在
   * CONFISCATING 的单在途（重放事件幂等 no-op）；两分支都必须收下 event.attempt——
   * 腿会重建到 attempt 2/3，settle/void 用错 attempt 就 post 到已 void 的旧 id 上。
   */
  private async onConfiscationLegChanged(event: FundsOrderStatusChangedEvent) {
    const depositId = event.parent.depositTransactionId;
    if (!depositId) return;

    const TERMINAL_LEG_STATUSES: string[] = [
      FundsOrderStatus.CONFIRMED,
      FundsOrderStatus.FAILED,
      FundsOrderStatus.TIMEOUT,
    ];
    if (!TERMINAL_LEG_STATUSES.includes(event.newStatus)) return;

    const deposit = await this.depositService.findOne(depositId);
    if (!deposit) return;
    if (deposit.status !== DepositTransactionStatus.CONFISCATING) return; // already settled / not in transit

    const firmFeeWallet = await this.systemWalletResolver.resolve(deposit.assetId, 'F_FEE');
    const spec = this.confiscationSpec(deposit, firmFeeWallet);

    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        await this.settleConfiscation(spec, deposit, event.fundsOrderId, event.attempt);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onConfiscationLegFailed(spec, deposit, event.fundsOrderId, event.newStatus, event.attempt);
        break;
    }
  }

  /**
   * 没收腿 FAILED/TIMEOUT——与退回/上缴弧同一形状（业主 2026-08-22 定稿：资金单
   * 有问题就重试三次，还不行原地标红）。void 本 attempt 两笔 pending → 未耗尽则
   * 重建 attempt+1，耗尽则红旗停手；deposit 始终留在 CONFISCATING。整体 try/catch
   * 不上抛（@OnEvent 里抛没人接）。
   */
  private async onConfiscationLegFailed(
    spec: DispositionSpec,
    deposit: any,
    fundsOrderId: string,
    legStatus: string,
    attempt: number,
  ) {
    try {
      await this.disposition.voidAttempt(spec, attempt);

      const MAX = 3;
      if (attempt < MAX) {
        const nextAttempt = attempt + 1;
        const { fundsOrderNo } = await this.disposition.rebuild(spec, nextAttempt);

        await this.depositAudit(deposit, {
          action: 'DEPOSIT_CONFISCATION_RETRIED',
          reason: `Confiscation leg attempt ${attempt} ${legStatus} — rebuilt attempt ${nextAttempt}`,
          fundsOrderNo,
          metadata: { fundsOrderId, attempt: nextAttempt },
        });
        return;
      }

      // 重试三级梯耗尽 —— 单子留在 CONFISCATING 原地不动,靠红标让运营看见。
      // 「卡住了」是一面旗,不是一个状态（业主 2026-08-22 定稿）。
      await this.depositService.markNeedsReview(deposit.id);
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_CONFISCATION_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'LEG_EXHAUSTED',
        reason: `Confiscation leg failed after ${attempt} attempts — manual intervention required (deposit stays CONFISCATING)`,
        metadata: { fundsOrderId, attempt },
      });
    } catch (err: any) {
      this.logger.error(
        `onConfiscationLegFailed crashed for deposit ${deposit.depositNo} attempt ${attempt}: ${err.message} — deposit stays CONFISCATING, pending legs may still be locked`,
      );
      // 崩溃路径同样置旗:pending 可能还锁着,更需要被看见。markNeedsReview 自带
      // try/catch 兜底——它失败不能盖掉下面这条 UNLOCK_FAILED 审计。
      await this.depositService.markNeedsReview(deposit.id).catch((e) =>
        this.logger.error(`markNeedsReview failed for deposit ${deposit.depositNo}: ${e.message}`),
      );
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_CONFISCATION_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'CRASHED',
        reason: `onConfiscationLegFailed crashed (attempt ${attempt}): ${err.message} — manual intervention required (deposit stays CONFISCATING)`,
        metadata: { fundsOrderId, attempt, legStatus, error: err.message },
      }).catch(() => undefined);
    }
  }

  /**
   * settle 半程：engine.settle post 两笔 pending（3× 瞬时重试在引擎内），成功才
   * 翻 CONFISCATE_SETTLE + 留痕 + 腿收口；耗尽则留 CONFISCATING + FAILED 留痕
   * （no revert, no rethrow——语义与六件套时代逐字一致）。
   */
  private async settleConfiscation(spec: DispositionSpec, deposit: any, fundsOrderId: string, attempt: number) {
    const result = await this.disposition.settle(spec, fundsOrderId, attempt);
    if (!result.ok) {
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_CONFISCATION_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'SETTLE_EXHAUSTED',
        reason: `Settle failed after 3 retries — manual intervention required (deposit stays CONFISCATING)`,
        metadata: { fundsOrderId, error: result.error },
      });
      return; // stay CONFISCATING, no revert, no rethrow (silent stop in the async listener)
    }
    const settledRow = await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CONFISCATE_SETTLE, reason: 'Below-min confiscation settled' });
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_CONFISCATION_EXECUTED',
      fromStatus: DepositTransactionStatus.CONFISCATING,
      toStatus: settledRow.status,
      metadata: { fundsOrderId },
    });
    await this.clearDispositionLeg(deposit, fundsOrderId);
  }

  /**
   * 状态机收窄后 FAIL 的唯一入口是 PAYIN_PENDING(见 deposit-transactions.service.ts
   * transitions 表)。原守卫是黑名单(只挡 FAILED/FROZEN/REJECTED),收窄后
   * COMPLIANCE_PENDING 及之后的状态都没有 fail 边——黑名单守卫会放行到
   * updateStatus 抛 Invalid action。改成白名单:只有 PAYIN_PENDING 才 FAIL,其余状态
   * (payin 已确认之后的事后掉链/链上重组)no-op + warn,不落审计(BACKLOG 待补)。
   */
  private async onPayinFailed(depositId: string, fundsOrderId: string) {
    const deposit = await this.depositService.findOne(depositId);
    if (!deposit) return;

    if (deposit.status !== DepositTransactionStatus.PAYIN_PENDING) {
      this.logger.warn(
        `onPayinFailed no-op: deposit ${deposit.id} status is ${deposit.status} (not PAYIN_PENDING) — payin already confirmed, cannot FAIL a post-confirmation status`,
      );
      return;
    }

    const oldStatus = deposit.status;
    const updated = await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.FAIL,
      reason: 'Payin funds order failed',
    });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_PAYIN_COMPLETED',
      outcome: AuditOutcome.FAILED,
      reasonCode: 'PAYIN_FAILED',
      reason: 'Payin funds order failed',
      fromStatus: oldStatus,
      toStatus: updated.status,
      metadata: { fundsOrderId },
    });
  }

  private async onPayinConfirmed(depositId: string, fundsOrderId: string, effectiveDate?: string) {
    const deposit = await this.depositService.findOne(depositId);
    if (!deposit) return;

    const fundsOrder = await this.fundsOrders.findById(fundsOrderId);
    if (fundsOrder && fundsOrder.status === FundsOrderStatus.CLEARED) {
      this.logger.debug(`Funds order ${fundsOrderId} already CLEARED. Skipping.`);
      return;
    }

    if (deposit.status !== DepositTransactionStatus.PAYIN_PENDING) {
      this.logger.debug(`Deposit ${deposit.id} status ${deposit.status} not eligible for payin_confirmed.`);
      return;
    }


    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      try {
        await this.executeDepositAccounting(deposit, 'STEP_1', fundsOrder, effectiveDate);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`TB Step 1 failed for deposit ${deposit.id}: ${error.message}`);
        await this.depositAudit(deposit, {
          action: 'DEPOSIT_PAYIN_COMPLETED',
          outcome: AuditOutcome.FAILED,
          reasonCode: 'ACCOUNTING',
          reason: `TB Step 1 failed: ${error.message}`,
          metadata: { eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE', step: 'STEP_1', fundsOrderId },
        });
        return;
      }
    }

    const confirmedRow = await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.PAYIN_CONFIRMED,
    });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_PAYIN_COMPLETED',
      reason: 'Payin confirmed, deposit entering compliance review',
      fromStatus: DepositTransactionStatus.PAYIN_PENDING,
      toStatus: confirmedRow.status,
      fundsOrderNo: fundsOrder?.fundsOrderNo ?? undefined,
      metadata: { fundsOrderId },
    });

    await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');

    this.logger.log(`Deposit ${deposit.id} now COMPLIANCE_PENDING. Funds order ${fundsOrderId} CLEARED.`);
  }

  private async executeDepositAccounting(
    deposit: any,
    step: 'STEP_1' | 'STEP_2',
    fundsOrder?: any,
    effectiveDate?: string,
  ) {
    const asset = deposit.asset;
    if (!asset) {
      throw new Error(`Deposit ${deposit.id} has no associated asset`);
    }
    if (!asset.tbLedgerId) {
      throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    }

    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);

    // Phase B per-physical-wallet recon: the deposit's payin funds_order pins the
    // specific wallet that received the funds. Falls back to the deposit's own
    // toWalletId when the funds_order isn't passed.
    const walletRef: string | null =
      fundsOrder?.toWalletId ?? deposit.toWalletId ?? null;
    // externalRef 归 funds_order 所有(CONFIRMED 时按资产类型铸)。STEP_1 是外部穿越腿,
    // 读单一源,不再本地 coalesce。STEP_2(下方)是纯重分类,保持 externalRef:null。
    const externalRef: string | null = fundsOrder
      ? this.fundsOrders.resolveExternalRef(fundsOrder)
      : null;

    if (step === 'STEP_1') {
      // Real-time 1:1: debit the aggregate CLIENT_ASSET (SYSTEM), credit DEPOSIT_SUSPENSE (CUSTOMER)
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_ASSET,
        ledger,
        ownerType: 'SYSTEM',
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Payin confirmed, funds in compliance hold (CLIENT_ASSET→DEPOSIT_SUSPENSE)',
          // Phase B: inbound real-world recognition — both aggregate (CLIENT_ASSET) and
          // SUSPENSE legs reference the specific wallet that received the on-chain / bank inbound.
          debitWalletRef: walletRef,
          creditWalletRef: walletRef,
          externalRef,
          isExternalCrossing: true,
          ...(effectiveDate && { effectiveDate }),
        },
      });

      this.logger.log(`TB Step 1 complete: CLIENT_ASSET→DEPOSIT_SUSPENSE for deposit ${deposit.depositNo}`);
    } else {
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
          assetCurrency: asset.currency,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Compliance approved, funds credited to client payable',
          // Phase B: pure ledger reclass — money doesn't move physically, both legs sit on the same wallet,
          // no external statement entry, not a real-world crossing.
          debitWalletRef: walletRef,
          creditWalletRef: walletRef,
          externalRef: null,
          isExternalCrossing: false,
          ...(effectiveDate && { effectiveDate }),
        },
      });

      this.logger.log(`TB Step 2 complete: DEPOSIT_SUSPENSE→CLIENT_PAYABLE for deposit ${deposit.depositNo}`);
    }
  }

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  /**
   * ⚠️ `requestId`（可选）：不传时审计幂等键退化成
   * `entityType|entityId|action|NO_REQUEST_ID` —— **同一笔单的同一条状态跃迁第二次
   * 就会被静默去重**。会重复发生的跃迁（如 Gate 0 挂起：freeze→unfreeze→重新挂起、
   * 或 waive→重新挂起）必须传一个唯一值，否则监管面的取证链从第一天就缺行。
   */
  /**
   * 充值域新合同信封（站1b-β）：统一 actionDomain=DEPOSIT、category=BUSINESS、
   * 旅程号从单上继承（CREATED=START 铸号落列，见 detected()）、subjects 四角色
   * （主体=单号｜归属=客户号｜凭据=审批号｜牵连=资金单号）。requestId 沿用
   * 「码_单号_uuid」模板防静默去重。causationId 语义：直接引发本条的前件
   * （异步审批驱动的码传 approval 事件 id）。
   */
  private async depositAudit(
    deposit: any,
    patch: {
      action: string;
      outcome?: AuditOutcome;
      reasonCode?: string;
      reason?: string;
      fromStatus?: string;
      toStatus?: string;
      approvalNo?: string;
      causationId?: string;
      fundsOrderNo?: string;
      metadata?: Record<string, unknown>;
      /** 人为动作传 actor → 走 recordByActor；缺省系统动作走 recordSystem */
      actor?: ReturnType<DepositWorkflowService['toAuditActor']>;
      sourcePlatform?: string;
    },
  ): Promise<void> {
    const customerNo: string | null =
      deposit.customer?.customerNo ?? deposit.ownerNo ?? null;
    const subjects: AuditSubjectInput[] = [
      {
        subjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        subjectNo: deposit.depositNo,
        subjectRole: AuditSubjectRole.PRIMARY,
      },
    ];
    if (customerNo) {
      subjects.push({ subjectType: 'CUSTOMER', subjectNo: customerNo, subjectRole: AuditSubjectRole.OWNER });
    }
    if (patch.approvalNo) {
      subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    }
    if (patch.fundsOrderNo) {
      subjects.push({ subjectType: 'FUNDS_ORDER', subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    }
    const input = {
      action: patch.action,
      actionDomain: 'DEPOSIT',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      primarySubjectNo: deposit.depositNo,
      ownerCustomerNo: customerNo ?? undefined,
      correlationId: deposit.correlationId ?? undefined,
      causationId: patch.causationId,
      outcome: patch.outcome ?? AuditOutcome.SUCCESS,
      reasonCode: patch.reasonCode,
      reason: patch.reason,
      fromStatus: patch.fromStatus,
      toStatus: patch.toStatus,
      approvalNo: patch.approvalNo,
      subjects,
      traceId: deposit.traceId || undefined,
      metadata: patch.metadata,
      requestId: `${patch.action}_${deposit.depositNo}_${randomUUID()}`,
      sourcePlatform: patch.sourcePlatform ?? 'SYSTEM',
    };
    if (patch.actor) {
      await this.auditLogsService.recordByActor(input as any, patch.actor as any);
    } else {
      await this.auditLogsService.recordSystem(input as any);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // A2 — RETURN / SEIZE / UNFREEZE maker-checker approval gates (计划2).
  // Each initiate* mirrors initiateConfiscation's structure exactly: reads the
  // deposit, checks a precondition + an open-approval anti-dup guard, opens the
  // V1 approval case, audits the request — and writes NOTHING to the deposit
  // table (Rule 5: initiate reads only). Each on*Decided listener mirrors
  // onConfiscationDecided's routing (APPROVED → execute, else → audit trail
  // already owned by the approvals engine, deposit stays put) but the "execute"
  // side is a stub for this task — real settlement (out-leg posting, status
  // transitions) lands in A3 (return) / A4 (seize) / A5 (unfreeze).
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * RETURN disposition (initiate side, A2): KYT verdict says RETURN_TO_SENDER while the
   * deposit sits in MANUAL_CHECKING — or (C1, 2026-08-22) ops presses "Initiate Return to
   * Sender" on an OPERATION_PENDING hold. High-risk (moves customer money back out) → routed
   * through V1 maker-checker approval (single-step MLRO). Only opens the approval case +
   * audits the request; the actual return leg posting + status→RETURNING/RETURNED lands
   * in A3's decided-event handler.
   */
  async initiateReturn(
    depositId: string,
    dto: { reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Return reason is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (!DepositWorkflowService.RETURNABLE_STATUSES.includes(deposit.status)) {
      throw new BadRequestException(
        'Deposit is not in a returnable status (MANUAL_CHECKING / OPERATION_PENDING), cannot open a return approval',
      );
    }

    // Fix 4: a return-to-sender needs somewhere to send it back to — returnSpec 的 legInput
    // reads deposit.fromAddress/fromIban as the destination. Without either, onReturnApproved
    // would build a legSeq 3 funds order with a blank destination and no way to ever settle it.
    if (!deposit.fromAddress?.trim() && !deposit.fromIban?.trim()) {
      throw new BadRequestException(
        'Deposit has no sender address/IBAN on file — nothing to return the funds to',
      );
    }

    // Anti-dup: a deposit must not accrue two open return approvals.
    const openReturns = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_RETURN,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openReturns.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending return approval; resolve it before submitting another.`,
      );
    }

    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_RETURN,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_RETURN_REQUESTED',
      reason: dto.reason,
      approvalNo: approvalCase.approvalNo,
      metadata: { amount: String(deposit.amount) },
      actor: this.toAuditActor(actor),
      sourcePlatform: 'ADMIN_API',
    });

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * SEIZE disposition (initiate side, A2): ops proposes seizing a FROZEN deposit under a
   * government order (asset forfeiture, distinct from the below-min T&C CONFISCATION
   * disposition). High-risk (moves customer-attributed money to government custody) →
   * routed through V1 maker-checker approval (two-step SENIOR_MANAGEMENT_OFFICER → MLRO,
   * four-eyes). Only opens the approval case + audits the request; the actual seize leg
   * posting + status→SEIZING/SEIZED lands in A4's decided-event handler.
   */
  async initiateSeize(
    depositId: string,
    dto: { reason: string; orderRef: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Seize reason is required');
    }
    if (!dto.orderRef?.trim()) {
      throw new BadRequestException('Government order reference is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.FROZEN) {
      throw new BadRequestException('Deposit is not FROZEN, cannot open a seize approval');
    }

    // Anti-dup: a deposit must not accrue two open seize approvals.
    const openSeizures = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_SEIZE,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openSeizures.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending seize approval; resolve it before submitting another.`,
      );
    }

    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_SEIZE,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
          orderRef: dto.orderRef,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_SEIZE_REQUESTED',
      reason: dto.reason,
      approvalNo: approvalCase.approvalNo,
      metadata: { amount: String(deposit.amount), orderRef: dto.orderRef },
      actor: this.toAuditActor(actor),
      sourcePlatform: 'ADMIN_API',
    });

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * UNFREEZE disposition (initiate side, A2): ops proposes unfreezing a FROZEN deposit
   * under a delisting/unfreeze order (sanction list correction, MLRO clearance, etc.).
   * Routed through V1 maker-checker approval (single-step MLRO). Only opens the approval
   * case + audits the request; the actual resume-into-compliance-flow lands in A5's
   * decided-event handler.
   */
  async initiateUnfreeze(
    depositId: string,
    dto: { reason: string; orderRef: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Unfreeze reason is required');
    }
    if (!dto.orderRef?.trim()) {
      throw new BadRequestException('Delisting/unfreeze order reference is required');
    }

    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.FROZEN) {
      throw new BadRequestException('Deposit is not FROZEN, cannot open an unfreeze approval');
    }

    // Anti-dup: a deposit must not accrue two open unfreeze approvals.
    const openUnfreezes = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_UNFREEZE,
      entityRef: deposit.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openUnfreezes.total > 0) {
      throw new ConflictException(
        `Deposit ${deposit.depositNo} already has a pending unfreeze approval; resolve it before submitting another.`,
      );
    }

    const traceId = deposit.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.DEPOSIT_UNFREEZE,
        entityRef: deposit.id,
        traceId,
        objectSnapshot: {
          depositNo: deposit.depositNo,
          amount: String(deposit.amount),
          assetId: deposit.assetId,
          orderRef: dto.orderRef,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_UNFREEZE_REQUESTED',
      reason: dto.reason,
      approvalNo: approvalCase.approvalNo,
      metadata: { amount: String(deposit.amount), orderRef: dto.orderRef },
      actor: this.toAuditActor(actor),
      sourcePlatform: 'ADMIN_API',
    });

    return {
      depositNo: deposit.depositNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * RETURN decided (A2): the V1 approval opened by initiateReturn reached a decision.
   * APPROVED → delegate to the onReturnApproved stub (real settlement lands in A3). Any
   * other outcome → the approvals engine already owns the rejection/cancel/expire audit
   * trail; this is a no-op log, deposit stays MANUAL_CHECKING.
   */
  @OnEvent('workflow.deposit-return.decided', { async: true })
  async onReturnDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit return decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // entityRef belongs to another workflow's entity — not ours, ignore.
        return;
      }
      throw err;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} return ${event.decision} (case ${event.approvalNo}) — original state intact, no return executed.`,
      );
      return;
    }

    await this.onReturnApproved(deposit, event);
  }

  /**
   * Start an approved return-to-sender (A3, "start" half). 先账后状态: PENDING-lock the
   * single reverse-suspense leg + create the legSeq 3 funds order in CREATED
   * (advanceable, NOT auto-cleared) BEFORE flipping the deposit to RETURNING via
   * RETURN. The matching POST/settle half lands in settleReturn, which reproduces
   * the pending transfer via deterministicTransferId('DEPOSIT', depositNo, eventCode,
   * attempt) — so eventCode + legIndex(=attempt) here are load-bearing.
   *
   * Mirrors startConfiscation's structure but with ONE leg, not two: return only
   * reverses the customer's suspense (DR DEPOSIT_SUSPENSE(CUSTOMER) / CR
   * CLIENT_ASSET(SYSTEM) — exact reverse of the payin STEP_1, same direction as
   * confiscation's leg1). Unlike confiscation (an internal reclass), this leg is a
   * genuine external crossing — the funds order's destination is the ORIGINAL
   * SENDER (deposit.fromAddress/fromIban), not a firm wallet, and toWalletId is
   * null (external, not platform-owned). Idempotent: reuse an existing legSeq 3
   * order rather than creating a duplicate on replay.
   *
   * Guarded to only run from a RETURNABLE_STATUSES state (MANUAL_CHECKING /
   * OPERATION_PENDING) — a replayed decided event arriving after the deposit already
   * left that state (already RETURNING/RETURNED, or drifted somewhere else) is a no-op
   * rather than crashing on an invalid state-machine transition.
   */
  /**
   * 退回弧处置说明书（地基站 2026-08-26：钱侧六件套收敛进 DispositionService，
   * 六件套原文见 git 历史）。单腿反冲暂扣（SUSPENSE→CLIENT_ASSET），真外部穿越：
   * 钱确实离开客户托管、原路退回原发款方（目的地锁死 deposit.fromAddress/fromIban，
   * 退第三方=洗白通道，禁止）。settle 后对 LOCK 行补记 POST 语义 + 外部参考号。
   */
  private returnSpec(deposit: any): DispositionSpec {
    const asset = deposit.asset;
    if (!asset) throw new Error(`Deposit ${deposit.id} has no associated asset`);
    if (!asset.tbLedgerId) throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    const customerWalletRef: string | null = deposit.toWalletId ?? null;
    return {
      kind: 'RETURN', sourceType: 'DEPOSIT', sourceNo: deposit.depositNo,
      traceId: deposit.traceId || deposit.id,
      ledger: asset.tbLedgerId, currency: asset.currency, decimals: asset.decimals,
      amount: String(deposit.amount), legSeq: 3,
      buildLegInput: (attempt: number) => ({
        depositTransactionId: deposit.id, legSeq: 3, attempt,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: deposit.assetId, amount: String(deposit.amount), netAmount: String(deposit.amount),
        fromWalletId: deposit.toWalletId ?? null, fromAddress: deposit.toAddress ?? undefined, fromIban: deposit.toIban ?? undefined,
        toWalletId: null, toAddress: deposit.fromAddress ?? undefined, toIban: deposit.fromIban ?? undefined,
        traceId: deposit.traceId || undefined,
      }),
      tbLegs: [
        {
          transferCode: TB_TRANSFER_CODES.DEPOSIT_RETURN_PENDING,
          eventCode: 'DEPOSIT_RETURN_PENDING', voidEventCode: 'DEPOSIT_RETURN_VOID',
          debit: { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId },
          credit: { code: TB_ACCOUNT_CODES.CLIENT_ASSET, ownerType: 'SYSTEM' },
          debitCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          memo: 'Return to sender (pending)',
          debitWalletRef: customerWalletRef, creditWalletRef: customerWalletRef, isExternalCrossing: true,
        },
      ],
      postEnrich: { eventCode: 'DEPOSIT_RETURN_POST', memo: 'Return to sender confirmed externally', isExternalCrossing: true },
    };
  }

  /**
   * 退回落地时按挂起原因分别处理 `limitHoldReason`（业主裁定见
   * ADMINISTRATIVE_HOLD_REASONS 的注释）。返回本次真正清掉的原因，没清则 null。
   *
   *   CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE → 清掉，客户看得见这笔退回
   *   BELOW_MIN                                    → 保留，继续对客户隐藏
   *   null / 空串（没挂起过，走 MANUAL_CHECKING 老路）→ 无事发生
   *
   * ⚠️ 调用点在 `updateStatus(RETURN)` **之后**，不是之前。两个写没有事务包着，
   *    顺序决定中间态：
   *      先清后翻 —— 中间这一刻单子是 OPERATION_PENDING 且已无挂起,对客户可见
   *      （收敛成 PROCESSING）；若接着 updateStatus 崩了,这个「本该藏着的挂起单
   *      被永久曝光」的残局留在库里,是一个**新增**的失败模式。
   *      先翻后清 —— 中间这一刻单子是 RETURNING 但仍挂着,对客户不可见；若接着
   *      clear 崩了,残局恰好等于本次修复前的既有行为,不新增任何失败模式。
   *
   * ⚠️ 复用 depositService.clearLimitHold（Rule 5：不直写 domain 表），但**不动**
   *    waiveLimitHold 的语义 —— 那是运营手动解除的入口（B4 §3 已放宽到认任何非空
   *    挂起原因），挑不挑原因这件事只发生在这里。
   */
  private async clearAdministrativeHoldOnReturn(deposit: any): Promise<string | null> {
    const holdReason: string | null = deposit.limitHoldReason ?? null;
    if (
      !holdReason ||
      !DepositWorkflowService.ADMINISTRATIVE_HOLD_REASONS.has(holdReason)
    ) {
      return null;
    }

    await this.depositService.clearLimitHold(deposit.id);
    this.logger.log(
      `Deposit ${deposit.depositNo} return: cleared administrative hold (${holdReason}) — the return is now visible to the customer`,
    );
    return holdReason;
  }

  private async onReturnApproved(deposit: any, event?: ApprovalDecidedEvent) {
    if (!DepositWorkflowService.RETURNABLE_STATUSES.includes(deposit.status)) {
      this.logger.debug(
        `onReturnApproved no-op: deposit ${deposit.id} not in a returnable status (status=${deposit.status})`,
      );
      return;
    }

    const returnLeg = await this.disposition.initiate(this.returnSpec(deposit));

    await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.RETURN,
      reason: 'Return to sender approved (funds in transit)',
    });

    const clearedHoldReason = await this.clearAdministrativeHoldOnReturn(deposit);

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_RETURN_STARTED',
      approvalNo: event?.approvalNo,
      causationId: event?.approvalId,
      fundsOrderNo: returnLeg.fundsOrderNo,
      // clearedLimitHoldReason：本次退回清掉的行政级挂起原因（没清则 null）。挂起原因
      // 决定客户看不看得见这笔单,属 operator 可见的状态变化 —— 按铁律留痕,但复用
      // DEPOSIT_RETURN_STARTED 这条已有审计的 metadata,不新造审计动作常量。
      metadata: { amount: String(deposit.amount), clearedLimitHoldReason: clearedHoldReason },
    });
  }

  /**
   * settle 半程路由。守卫同六件套时代：只有仍在 RETURNING 的单在途（重放事件幂等
   * no-op）；两分支都收 event.attempt（腿会重建，settle/void 用错 attempt 全落空）。
   */
  private async onReturnLegChanged(event: FundsOrderStatusChangedEvent) {
    const depositId = event.parent.depositTransactionId;
    if (!depositId) return;
    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.RETURNING) return; // already settled / not in transit

    const spec = this.returnSpec(deposit);
    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        await this.settleReturn(spec, deposit, event.fundsOrderId, event.attempt);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onReturnLegFailed(spec, deposit, event.fundsOrderId, event.attempt);
        break;
    }
  }

  /**
   * settle 半程：engine.settle post + POST 语义补记（携外部参考号），成功才翻
   * RETURNED_DONE + 留痕 + 腿收口；耗尽留 RETURNING + STUCK 留痕（no revert,
   * no rethrow——语义与六件套时代逐字一致）。
   */
  private async settleReturn(spec: DispositionSpec, deposit: any, fundsOrderId: string, attempt: number) {
    const result = await this.disposition.settle(spec, fundsOrderId, attempt);
    if (!result.ok) {
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_RETURN_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'SETTLE_EXHAUSTED',
        reason: `Settle failed after 3 retries — manual intervention required (deposit stays RETURNING)`,
        metadata: { fundsOrderId, error: result.error },
      });
      return; // stay RETURNING, no revert, no rethrow (silent stop in the async listener)
    }
    const settledRow = await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.RETURNED_DONE, reason: 'Return to sender settled' });
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_RETURNED',
      fromStatus: DepositTransactionStatus.RETURNING,
      toStatus: settledRow.status,
      metadata: { fundsOrderId, externalRef: result.externalRef },
    });
    await this.clearDispositionLeg(deposit, fundsOrderId);
  }

  /**
   * 退回腿 FAILED/TIMEOUT：void 本 attempt → 未耗尽重建 attempt+1，耗尽红旗停手；
   * deposit 始终留在 RETURNING。整体 try/catch 不上抛（@OnEvent 里抛没人接）。
   */
  private async onReturnLegFailed(spec: DispositionSpec, deposit: any, fundsOrderId: string, attempt: number) {
    try {
      await this.disposition.voidAttempt(spec, attempt);

      const MAX = 3;
      if (attempt < MAX) {
        const nextAttempt = attempt + 1;
        const { fundsOrderNo } = await this.disposition.rebuild(spec, nextAttempt);

        await this.depositAudit(deposit, {
          action: 'DEPOSIT_RETURN_RETRIED',
          reason: `Return leg attempt ${attempt} failed — rebuilt attempt ${nextAttempt}`,
          fundsOrderNo,
          metadata: { fundsOrderId, attempt: nextAttempt },
        });
        return;
      }

      // 重试三级梯耗尽 —— 单子留在 RETURNING 原地不动,靠红标让运营看见。
      // 「卡住了」是一面旗,不是一个状态（业主 2026-08-22 定稿）。
      await this.depositService.markNeedsReview(deposit.id);

      await this.depositAudit(deposit, {
        action: 'DEPOSIT_RETURN_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'LEG_EXHAUSTED',
        reason: `Return leg failed after ${attempt} attempts — manual intervention required (deposit stays RETURNING)`,
        metadata: { fundsOrderId, attempt },
      });
    } catch (err: any) {
      this.logger.error(`onReturnLegFailed crashed for deposit ${deposit.depositNo} attempt ${attempt}: ${err.message}`);
      // 崩溃路径同样置旗:pending 可能还锁着,更需要被看见。markNeedsReview 自带
      // try/catch 兜底——它失败不能盖掉下面这条 STUCK 审计。
      await this.depositService.markNeedsReview(deposit.id).catch((e) =>
        this.logger.error(`markNeedsReview failed for deposit ${deposit.depositNo}: ${e.message}`),
      );
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_RETURN_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'CRASHED',
        reason: `onReturnLegFailed crashed (attempt ${attempt}): ${err.message} — manual intervention required (deposit stays RETURNING)`,
        metadata: { fundsOrderId, attempt, error: err.message },
      }).catch(() => undefined);
    }
  }

  /** 腿收口（三弧共用；engine.clearLeg 幂等，失败仅腿状态滞后不伤资金——降日志，不留审计）。 */
  private async clearDispositionLeg(deposit: any, fundsOrderId: string): Promise<void> {
    const clearErr = await this.disposition.clearLeg(fundsOrderId);
    if (!clearErr) return;
    this.logger.warn(
      `Disposition leg for deposit ${deposit.depositNo} settled but funds order ${fundsOrderId} could not be CLEARED (${clearErr}) — funds order status lags, no accounting impact`,
    );
  }

  /**
   * SEIZE decided (A2): the V1 approval opened by initiateSeize reached a decision.
   * APPROVED → delegate to the onSeizeApproved stub (real settlement lands in A4). Any
   * other outcome → the approvals engine already owns the rejection/cancel/expire audit
   * trail; this is a no-op log, deposit stays FROZEN.
   */
  @OnEvent('workflow.deposit-seize.decided', { async: true })
  async onSeizeDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit seize decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return;
      }
      throw err;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} seize ${event.decision} (case ${event.approvalNo}) — original state intact, no seize executed.`,
      );
      return;
    }

    await this.onSeizeApproved(deposit, event);
  }

  /**
   * Fetch the government seizure order reference (orderRef) from the APPROVED
   * DEPOSIT_SEIZE approval case's objectSnapshot. Neither call site that needs it
   * (onSeizeApproved — first pending lock; onSeizeLegFailed — retry rebuild)
   * carries orderRef through directly: `ApprovalDecidedEvent.metadata` is always
   * `{}` (see `emitDecidedEvent` in approval-handler.base.ts), so both re-derive it
   * here — same read shape as the anti-dup PENDING queries above (initiateSeize),
   * just filtered to the APPROVED case instead. Precedent for this re-fetch pattern:
   * `transaction-limit-rule-workflow.service.ts → onChangeDecided` does the same
   * `approvalsService.getById(...).objectSnapshot` read after a decided event.
   *
   * orderRef is the SOLE 8-year retention anchor for the seized funds' offline
   * handoff — the government/law-enforcement receiving account is deliberately
   * NEVER modeled in this system (owner decision 2026-07-28: seizure is an offline
   * legal handoff via a dedicated legal/finance channel, not a payment this system
   * executes; if a real "law-enforcement handoff ledger" is ever needed, that is a
   * separate feature, not this arc). Throws rather than silently defaulting to an
   * empty string — mirrors the existing `if (!asset) throw new Error(...)` style
   * invariant guards in this file (returnSpec/confiscationSpec 系列) for a
   * condition that should never happen given initiateSeize enforces orderRef
   * non-empty at approval-open time.
   */
  private async fetchSeizeOrderRef(depositId: string): Promise<string> {
    const { items } = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_SEIZE,
      entityRef: depositId,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    });
    const snapshot = items[0]?.objectSnapshot as { orderRef?: string } | null;
    const orderRef = snapshot?.orderRef;
    if (!orderRef) {
      throw new Error(
        `Deposit ${depositId}: no APPROVED DEPOSIT_SEIZE case with an orderRef found in objectSnapshot`,
      );
    }
    return orderRef;
  }

  /**
   * 上缴弧处置说明书（地基站 2026-08-26：钱侧六件套收敛进 DispositionService，
   * 六件套原文见 git 历史）。单腿反冲暂扣（SUSPENSE→CLIENT_ASSET），真外部穿越：
   * 钱经线下法务/财务专用通道移交政府。目的账户刻意不建模（toWalletId/toAddress/
   * toIban 全空）——orderRef（政府令文书号）嵌在锁定腿 memo 里，是 8 年留档的唯一
   * 追溯锚（业主口径 2026-07-28）。void 沿用同名事件码（历史如此，保真不改）；
   * settle 不做 POST 补记（目的地不建模，无外部参考号可记）。
   */
  private seizeSpec(deposit: any, orderRef: string): DispositionSpec {
    const asset = deposit.asset;
    if (!asset) throw new Error(`Deposit ${deposit.id} has no associated asset`);
    if (!asset.tbLedgerId) throw new Error(`Asset ${asset.currency} has no tbLedgerId`);
    const customerWalletRef: string | null = deposit.toWalletId ?? null;
    return {
      kind: 'SEIZE', sourceType: 'DEPOSIT', sourceNo: deposit.depositNo,
      traceId: deposit.traceId || deposit.id,
      ledger: asset.tbLedgerId, currency: asset.currency, decimals: asset.decimals,
      amount: String(deposit.amount), legSeq: 4,
      buildLegInput: (attempt: number) => ({
        depositTransactionId: deposit.id, legSeq: 4, attempt,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: deposit.assetId, amount: String(deposit.amount), netAmount: String(deposit.amount),
        fromWalletId: deposit.toWalletId ?? null, fromAddress: deposit.toAddress ?? undefined, fromIban: deposit.toIban ?? undefined,
        toWalletId: null,
        traceId: deposit.traceId || undefined,
      }),
      tbLegs: [
        {
          transferCode: TB_TRANSFER_CODES.DEPOSIT_SEIZE_PENDING,
          eventCode: 'SEIZE_REVERSE_SUSPENSE', voidEventCode: 'SEIZE_REVERSE_SUSPENSE',
          debit: { code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId },
          credit: { code: TB_ACCOUNT_CODES.CLIENT_ASSET, ownerType: 'SYSTEM' },
          debitCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCoa: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          memo: `Government seizure order ${orderRef} — funds leaving client custody (pending)`,
          debitWalletRef: customerWalletRef, creditWalletRef: customerWalletRef, isExternalCrossing: true,
        },
      ],
    };
  }

  /**
   * Start an approved government seizure (A4, "start" half) — SINGLE-leg structure
   * (2026-07-28 owner final-review correction: the A6 COA break was traced to the
   * leg's credit account being wrong — CR FIRM_SEIZED instead of CR CLIENT_ASSET —
   * not to a missing second leg. Fixing the credit account makes this single leg
   * self-balancing on its own, structurally identical to the return arc; see
   * seizeSpec for the account pair). 先账后状态: pending-lock the single
   * leg + create the legSeq 4 funds order in CREATED (advanceable, NOT
   * auto-cleared) BEFORE flipping the deposit to SEIZING via SEIZE. The matching
   * POST/settle half lands in settleSeize.
   *
   * Guarded to only run from FROZEN — a replayed decided event arriving after the
   * deposit already left FROZEN is a no-op rather than crashing.
   */
  private async onSeizeApproved(deposit: any, event?: ApprovalDecidedEvent) {
    if (deposit.status !== DepositTransactionStatus.FROZEN) {
      this.logger.debug(
        `onSeizeApproved no-op: deposit ${deposit.id} not in FROZEN (status=${deposit.status})`,
      );
      return;
    }

    // 上缴目的账户刻意留空:线下法务/财务专用通道移交政府,系统不建模政府收款账;
    // orderRef(政府令文书号)是 8 年留档的唯一追溯锚点(业主口径 2026-07-28)。
    const orderRef = await this.fetchSeizeOrderRef(deposit.id);

    const seizeLeg = await this.disposition.initiate(this.seizeSpec(deposit, orderRef));

    await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.SEIZE,
      reason: 'Seizure approved (funds in transit to government custody)',
    });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_SEIZE_STARTED',
      approvalNo: event?.approvalNo,
      causationId: event?.approvalId,
      fundsOrderNo: seizeLeg.fundsOrderNo,
      metadata: { amount: String(deposit.amount), orderRef },
    });
  }

  /**
   * settle 半程路由。守卫同六件套时代：只有仍在 SEIZING 的单在途（重放事件幂等
   * no-op）。settle/void 不用 memo，spec 的 orderRef 传空串即可；重建路径在
   * onSeizeLegFailed 里重取真 orderRef（本调用点不携带它——沿袭原实现）。
   */
  private async onSeizeLegChanged(event: FundsOrderStatusChangedEvent) {
    const depositId = event.parent.depositTransactionId;
    if (!depositId) return;
    const deposit = await this.depositService.findOne(depositId);
    if (deposit.status !== DepositTransactionStatus.SEIZING) return; // already settled / not in transit

    const spec = this.seizeSpec(deposit, '');
    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        await this.settleSeize(spec, deposit, event.fundsOrderId, event.attempt);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onSeizeLegFailed(spec, deposit, event.fundsOrderId, event.attempt);
        break;
    }
  }

  /**
   * settle 半程：engine.settle post 单腿（无 POST 补记——目的地不建模），成功才翻
   * SEIZED_DONE + 留痕 + 腿收口；耗尽留 SEIZING + STUCK 留痕（no revert, no
   * rethrow——语义与六件套时代逐字一致）。
   */
  private async settleSeize(spec: DispositionSpec, deposit: any, fundsOrderId: string, attempt: number) {
    const result = await this.disposition.settle(spec, fundsOrderId, attempt);
    if (!result.ok) {
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_SEIZE_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'SETTLE_EXHAUSTED',
        reason: `Settle failed after 3 retries — manual intervention required (deposit stays SEIZING)`,
        metadata: { fundsOrderId, error: result.error },
      });
      return; // stay SEIZING, no revert, no rethrow (silent stop in the async listener)
    }
    const settledRow = await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.SEIZED_DONE, reason: 'Seizure settled — funds handed off to government custody' });
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_SEIZED',
      fromStatus: DepositTransactionStatus.SEIZING,
      toStatus: settledRow.status,
      metadata: { fundsOrderId },
    });
    await this.clearDispositionLeg(deposit, fundsOrderId);
  }

  /**
   * 上缴腿 FAILED/TIMEOUT：void 本 attempt → 未耗尽则重取 orderRef、重建 attempt+1
   * （fetchSeizeOrderRef 可能抛——APPROVED 案缺 orderRef——故整体 try/catch），
   * 耗尽红旗停手；deposit 始终留在 SEIZING。
   */
  private async onSeizeLegFailed(spec: DispositionSpec, deposit: any, fundsOrderId: string, attempt: number) {
    try {
      await this.disposition.voidAttempt(spec, attempt);

      const MAX = 3;
      if (attempt < MAX) {
        const nextAttempt = attempt + 1;
        const orderRef = await this.fetchSeizeOrderRef(deposit.id);
        const { fundsOrderNo } = await this.disposition.rebuild(this.seizeSpec(deposit, orderRef), nextAttempt);

        await this.depositAudit(deposit, {
          action: 'DEPOSIT_SEIZE_RETRIED',
          reason: `Seize leg attempt ${attempt} failed — rebuilt attempt ${nextAttempt}`,
          fundsOrderNo,
          metadata: { fundsOrderId, attempt: nextAttempt },
        });
        return;
      }

      // 重试三级梯耗尽 —— 单子留在 SEIZING 原地不动,靠红标让运营看见。
      // 「卡住了」是一面旗,不是一个状态（业主 2026-08-22 定稿）。
      await this.depositService.markNeedsReview(deposit.id);

      await this.depositAudit(deposit, {
        action: 'DEPOSIT_SEIZE_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'LEG_EXHAUSTED',
        reason: `Seize leg failed after ${attempt} attempts — manual intervention required (deposit stays SEIZING)`,
        metadata: { fundsOrderId, attempt },
      });
    } catch (err: any) {
      this.logger.error(`onSeizeLegFailed crashed for deposit ${deposit.depositNo} attempt ${attempt}: ${err.message}`);
      // 崩溃路径同样置旗:pending 可能还锁着,更需要被看见。markNeedsReview 自带
      // try/catch 兜底——它失败不能盖掉下面这条 STUCK 审计。
      await this.depositService.markNeedsReview(deposit.id).catch((e) =>
        this.logger.error(`markNeedsReview failed for deposit ${deposit.depositNo}: ${e.message}`),
      );
      await this.depositAudit(deposit, {
        action: 'DEPOSIT_SEIZE_STUCK',
        outcome: AuditOutcome.FAILED,
        reasonCode: 'CRASHED',
        reason: `onSeizeLegFailed crashed (attempt ${attempt}): ${err.message} — manual intervention required (deposit stays SEIZING)`,
        metadata: { fundsOrderId, attempt, error: err.message },
      }).catch(() => undefined);
    }
  }

  /**
   * UNFREEZE decided (A2): the V1 approval opened by initiateUnfreeze reached a decision.
   * APPROVED → delegate to the onUnfreezeApproved stub (real resume-into-compliance-flow
   * lands in A5). Any other outcome → the approvals engine already owns the
   * rejection/cancel/expire audit trail; this is a no-op log, deposit stays FROZEN.
   */
  @OnEvent('workflow.deposit-unfreeze.decided', { async: true })
  async onUnfreezeDecided(event: ApprovalDecidedEvent) {
    const entityRef = event?.entityRef;
    if (!entityRef) {
      this.logger.warn('Deposit unfreeze decided event missing entityRef');
      return;
    }

    let deposit: any;
    try {
      deposit = await this.depositService.findOne(entityRef);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return;
      }
      throw err;
    }

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Deposit ${deposit.depositNo} unfreeze ${event.decision} (case ${event.approvalNo}) — original state intact, no unfreeze executed.`,
      );
      return;
    }

    await this.onUnfreezeApproved(deposit, event);
  }

  /**
   * Re-derive the delisting/unfreeze order reference (orderRef) from the APPROVED
   * DEPOSIT_UNFREEZE approval case's objectSnapshot. onUnfreezeApproved doesn't carry
   * orderRef through directly: `ApprovalDecidedEvent.metadata` is always `{}` (see
   * `emitDecidedEvent` in approval-handler.base.ts) — same re-fetch pattern as A4's
   * `fetchSeizeOrderRef`. Throws rather than silently defaulting to an empty string:
   * initiateUnfreeze enforces orderRef non-empty at approval-open time, so a missing
   * orderRef here means data corruption, not a normal path — and this fetch runs
   * BEFORE any state mutation, so a throw here leaves the deposit untouched (still
   * FROZEN), mirroring onSeizeApproved's guard-before-mutate ordering.
   */
  private async fetchUnfreezeOrderRef(depositId: string): Promise<string> {
    const { items } = await this.approvalsService.list({
      actionType: ApprovalActionTypes.DEPOSIT_UNFREEZE,
      entityRef: depositId,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    });
    const snapshot = items[0]?.objectSnapshot as { orderRef?: string } | null;
    const orderRef = snapshot?.orderRef;
    if (!orderRef) {
      throw new Error(
        `Deposit ${depositId}: no APPROVED DEPOSIT_UNFREEZE case with an orderRef found in objectSnapshot`,
      );
    }
    return orderRef;
  }

  /**
   * A5: trigger a Sumsub rescore of the deposit's KYT txn after it has already
   * resumed into COMPLIANCE_PENDING — the whole point of the unfreeze arc (a fresh
   * verdict driving the state machine post-resume, instead of sitting on a stale
   * pre-freeze one). One deposit has exactly one Sumsub txn now (finance/travelRule
   * legs collapsed into the single sumsubTxnId column), so there is only one rescore
   * call, not two.
   *
   * rescore is an EXTERNAL HTTP call — MUST be try/catch'd. By the time this runs the
   * deposit has already committed to COMPLIANCE_PENDING with its DEPOSIT_UNFROZEN
   * audit written, so a failed rescore must only warn and let webhook/manual re-submit
   * recover later; it must NEVER crash or roll back the already-committed resume
   * (plan-1 终审 I2 教训: submitSumsubTxns 当年缺 try/catch,一 throw 就会 strand deposit —
   * don't repeat that here).
   *
   * No sumsubTxnId (old deposit / never submitted to Sumsub) → skip entirely,
   * just warn.
   */
  private async triggerUnfreezeRescore(deposit: any): Promise<void> {
    if (!deposit.sumsubTxnId) {
      this.logger.warn(
        `Unfreeze rescore skip: deposit ${deposit.id} has no sumsubTxnId — never submitted to Sumsub`,
      );
      return;
    }

    try {
      await this.sumsubTxnClient.rescore(deposit.sumsubTxnId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `Unfreeze rescore failed for deposit ${deposit.id}: ${error.message} — ` +
          `deposit remains COMPLIANCE_PENDING for webhook/manual re-submit`,
      );
    }
  }

  /**
   * UNFREEZE approved (A5): resume the deposit back into the compliance flow. 零记账
   * — the money never left DEPOSIT_SUSPENSE while FROZEN, so there is no reverse leg
   * to book (unlike return/seize/confiscate). Order of operations:
   *   1. Guard: only runs from FROZEN — a replayed decided event arriving after the
   *      deposit already left FROZEN is a no-op rather than crashing.
   *   2. Fetch orderRef BEFORE mutating anything (see fetchUnfreezeOrderRef) — if the
   *      APPROVED case has no orderRef, throw and leave the deposit untouched.
   *   3. RESUME → COMPLIANCE_PENDING (via depositService.updateStatus, Rule 5).
   *   4. Audit DEPOSIT_UNFROZEN with orderRef in the reason (8-year retention trail,
   *      same rationale as A4's seizure orderRef).
   *   5. Best-effort Sumsub rescore (see triggerUnfreezeRescore) — never crashes.
   */
  private async onUnfreezeApproved(deposit: any, event?: ApprovalDecidedEvent) {
    if (deposit.status !== DepositTransactionStatus.FROZEN) {
      this.logger.debug(
        `onUnfreezeApproved no-op: deposit ${deposit.id} not in FROZEN (status=${deposit.status})`,
      );
      return;
    }

    const orderRef = await this.fetchUnfreezeOrderRef(deposit.id);

    const resumedRow = await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.RESUME,
      reason: `Unfreeze approved (order ${orderRef}) — resumed into compliance flow`,
    });

    await this.depositAudit(deposit, {
      action: 'DEPOSIT_UNFROZEN',
      approvalNo: event?.approvalNo,
      causationId: event?.approvalId,
      reason: `Unfreeze order ${orderRef} — deposit resumed to COMPLIANCE_PENDING`,
      fromStatus: DepositTransactionStatus.FROZEN,
      toStatus: resumedRow.status,
      metadata: { orderRef },
    });

    await this.triggerUnfreezeRescore(deposit);
  }
  /**
   * 客户被贴了「卡住全部能力」的便签（制裁 / 行政暂停）→ 把他名下所有非终态单冻住。
   * 事件登记见 common/events/domain-events.constants.ts CUSTOMER_RESTRICTION_OPENED。
   * scope < ALL 的便签不发这个事件（设计稿 §3.5：材料过期不该把已在路上的单拽回来）。
   */
  @OnEvent(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, { async: true })
  async onCustomerRestrictionOpened(event: {
    customerId: string;
    restrictionNo: string;
    cause: string;
    blocksAllCapabilities: true;
    traceId: string;
  }): Promise<void> {
    const inflight = await this.depositService.findNonTerminalByOwner(event.customerId);
    for (const d of inflight) {
      // 逐项容错：一笔冻不动（例如已在无 freeze 出边的中间态）不能连累其余几笔。
      try {
        await this.depositService.updateStatus(
          d.id,
          { action: DepositTransactionAction.FREEZE },
          {
            reason: `Customer restriction ${event.restrictionNo} (${event.cause}) opened`,
            actor: { actorType: 'SYSTEM', actorId: 'CUSTOMER_RESTRICTION' },
          },
        );
        // 铁律①：有持久状态、operator 可见 → 必须写审计。
        // ⚠️ 充值域的 updateStatus 自身不写审计（提现的写），所以这里必须自己补，
        // 否则批量冻结在审计里完全不可见。action 复用 DEPOSIT_FROZEN，让"按
        // action 查所有冻结"能一次查全；来源差异由 reason 承载。
        //
        // 审计调用独立 catch（2026-08-20 修订）：不能和上面的 updateStatus 共享
        // 这个 try 块——若共享，审计写入失败会被下面的 catch 回读判据误判成
        // 「良性自咬」（因为单这时确实已经 FROZEN），只打 debug，审计缺失却无人
        // 知晓。审计失败与状态跃迁失败必须分开：这里失败只以 logger.error 现身，
        // 绝不让一笔已经冻结成功的单被判成失败。
        await this.depositAudit(d, {
            action: 'DEPOSIT_FROZEN',
            fromStatus: d.status,
            toStatus: DepositTransactionStatus.FROZEN,
            reason: `Frozen by customer restriction ${event.restrictionNo} (${event.cause})`,
            metadata: { restrictionNo: event.restrictionNo, cause: event.cause },
          })
          .catch((err) => {
            this.logger.error(
              `Failed to write DEPOSIT_FROZEN audit for ${d.depositNo} (restriction ${event.restrictionNo}): ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      } catch (e) {
        // 自咬（2026-08-20 修订）：open() 广播是 fire-and-forget，扫描发生在主路径
        // updateStatus(FREEZE) 提交之前 —— findNonTerminalByOwner 扫到本单时它的
        // 快照仍是 COMPLIANCE_PENDING（notIn 拦不住触发单自己），但轮到本轮循环
        // 对它执行 FREEZE 时，触发路径往往已经把它冻上了（FROZEN 无 FREEZE 自环
        // 边）→ updateStatus 必抛。这不是真失败——单已经冻好，只是被触发路径抢先。
        // 判据：重新读一次当前状态，已是 FROZEN 就是良性抢跑，降级 debug；否则才
        // 是真失败，照旧 warn（不靠匹配异常消息字符串，措辞一改就失效）。
        let alreadyFrozen = false;
        try {
          const current = await this.depositService.findOne(d.id);
          alreadyFrozen = current.status === DepositTransactionStatus.FROZEN;
        } catch {
          // 状态复核本身失败（例如单已被删）—— 不能判定良性，走下面 warn 分支。
        }
        if (alreadyFrozen) {
          this.logger.debug(
            `In-flight deposit ${d.depositNo} already FROZEN when restriction ${event.restrictionNo} scan reached it — beaten by the triggering path (open() 广播早于本单主路径提交), not a real failure.`,
          );
        } else {
          this.logger.warn(
            `Failed to freeze in-flight deposit ${d.depositNo} for restriction ${event.restrictionNo}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    }
  }

}
