// 一期调账单（spec v2）。开单只落库；落账在审批通过后（Task 5）。
// 本期无订单层、无资金单、无真实转账——不许顺手给它建资金单。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateReferenceNo } from '../../../../common/utils/no-generator.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../../governance/approvals/approvals.service';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { AccountingService } from '../../../accounting/tigerbeetle/accounting.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ADJUSTMENT_TRANSITIONS, AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { CreateAdjustmentDto } from '../dto/adjustment.dto';
import { bigintToDecimal } from '../../../funds-layer/accounting/tb-amount.util';
import {
  Book, Direction, ReasonCode, REASON_SPECS,
  assertReasonAllowed, requiresRelatedOrder, resolvePostingLegs, resolveReattributionLegs,
} from './adjustment-rules';
import { DispositionService } from './disposition.service';

@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly dispositions: DispositionService,
  ) {}

  assertTransition(from: string, to: string): void {
    const allowed = ADJUSTMENT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`调账单非法状态迁移：${from} → ${to}`);
    }
  }

  /**
   * 审批页文案：把后果展开成一句人话。审批看不见后果就是橡皮图章。
   *
   * Fix 1b（末站整改）：此前直接把 amount 当最小单位数字打印（"20000（最小单位）
   * AED" 而不是 200.00 AED——在审批人唯一读到金额的这一屏错读两个数量级），且
   * 直接打印 reasonCode 原始枚举而不是 REASON_SPECS 里已经算好的 customerLabel。
   * decimals 由调用方传入（copy getAdjustment/getCase 的资产查法，见 submit()），
   * 保持本函数本身是不做 IO 的纯函数、单测不用起 DB/mock Prisma。
   */
  describeImpact(row: {
    book: string; ownerNo: string | null; amount: string; assetCode: string;
    direction: string; reasonCode: string; reasonInternal: string;
    toOwnerNo?: string | null;
  }, decimals: number): string {
    // 第四族改记（spec §6）：三族的「余额增加/减少」话术套上来是错的——钱在托管里
    // 一分没动，只是主人记错了。审批人要读到的是「从谁名下去了谁名下」，
    // 以及「客户资产总额不变」这个判断该不该批的关键事实。
    if (row.direction === 'REATTRIBUTE') {
      const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
      return `本单将把 ${majorAmount} ${row.assetCode} 从客户 ${row.ownerNo ?? '(未知)'} 名下改记到客户 ${row.toOwnerNo ?? '(未知)'} 名下；`
           + `客户资产总额不变；理由：${row.reasonInternal}`;
    }
    const dir = row.direction === 'REDUCE' ? '减少' : '增加';
    const who = row.book === 'CLIENT' ? `客户 ${row.ownerNo ?? '(未知)'}` : '公司自有资金';
    const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
    // internalLabel 而不是 customerLabel——后者对公司侧两个成因刻意为 null，
    // 借用它会让审批页回落打印裸枚举「成因：BANK_CHARGE」（末站评审 Minor 1）。
    const label = REASON_SPECS[row.reasonCode as ReasonCode]?.internalLabel ?? row.reasonCode;
    return `本单将使${who} 余额${dir} ${majorAmount} ${row.assetCode}；`
         + `成因：${label}；理由：${row.reasonInternal}`;
  }

  /**
   * Fix 3（末站整改，§4 边界线守卫）：relatedOrderNo 必须指向一张已存在的
   * 充值/提现/兑换单——有原单 = KYT 已对它跑过，改金额不算绕闸；无原单 = 凭空
   * 加钱。三张表各自查一次、命中就短路，不用 Promise.all 是为了单测里只需要
   * mock 命中的那张表，不必给全部三张表都摆一个 mock（同案例走查也只会命中
   * 其中一张）。
   */
  private async relatedOrderExists(orderNo: string): Promise<boolean> {
    const deposit = await (this.prisma as any).depositTransaction.findUnique({
      where: { depositNo: orderNo }, select: { id: true },
    });
    if (deposit) return true;
    const withdraw = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { withdrawNo: orderNo }, select: { id: true },
    });
    if (withdraw) return true;
    const swap = await (this.prisma as any).swapTransaction.findUnique({
      where: { swapNo: orderNo }, select: { id: true },
    });
    return !!swap;
  }

  async createDraft(dto: CreateAdjustmentDto, actor: ApprovalActorContext) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${dto.caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('只能对打开中的案件开调账单');

    const book: Book = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    const direction = dto.direction as Direction;

    // 第四族改记：不走 book×direction 语义（CUSTOMER_REATTRIBUTION 的 directions
    // 是空数组，assertReasonAllowed 对它任何方向都拒）——必须在那道闸之前分流出去。
    if (dto.reasonCode === 'CUSTOMER_REATTRIBUTION') {
      return this.createReattributionDraft(dto, kase, actor);
    }

    // 闸一：成因 × 账簿 × 方向 合法性
    assertReasonAllowed(dto.reasonCode as ReasonCode, book, direction);

    // 闸一之二：生效日不得晚于案件业务日。
    // 一张调账单修的是**案件那一天**的账，所以它必须落在那一天（或更早）的账期里
    // ——这正是「生效日」这个字段存在的意义。生效日晚于案件业务日时，重跑该案件
    // 业务日的对账取不到这笔分录（effectiveCutoffFilter 按生效日卡截止点），
    // 差额永远归不了零，案子永远平不掉。
    // 2026-08-29 业主走查实证：前端把生效日默认成「今天」（8-29），案件业务日是
    // 8-28，调账单落了账、重跑对账内部余额一分没动。前端默认值已改成案件业务日，
    // 这条守卫是后端的兜底，防止再从别的入口把日期填到未来。
    if (dto.effectiveDate > kase.businessDate) {
      throw new BadRequestException(
        `生效日 ${dto.effectiveDate} 晚于案件业务日 ${kase.businessDate}——`
        + '调账单修的是案件那一天的账，落在之后的账期里，重跑对账看不到这笔分录，差额平不了。',
      );
    }

    // 闸二：§4 边界线——客户账簿加钱必须指向一张已存在的原单。
    // Fix 3（末站整改）：此前只查非空，不查存在——任意非空字符串都放行，等于
    // 边界线守卫本身可以被一个假单号绕过（本分支自己的 e2e 场景 2 就传了个
    // 不存在的 'WD-E2E-ADJ-C2-0001' 并成功过账，是这条缺口的现成实证）。
    if (requiresRelatedOrder(book, direction)) {
      const relatedOrderNo = dto.relatedOrderNo?.trim();
      if (!relatedOrderNo) {
        throw new BadRequestException(
          '客户账簿加钱必须指明关联原单号——无原单即凭空给客户加钱，会绕过 KYT 与合规闸；'
          + '若为未归属入金，请走充值域补录入站信号。',
        );
      }
      if (!(await this.relatedOrderExists(relatedOrderNo))) {
        throw new BadRequestException(
          `关联原单号不存在：${relatedOrderNo}——必须指向一张已存在的充值/提现/兑换单，`
          + '否则等于凭空给客户加钱，绕过 KYT 与合规闸。',
        );
      }
    }

    // 落账时 resolveTbAccountId 要客户 UUID，case 上只有业务号，这里换一次。
    // Task 6 修复：Prisma 模型是 CustomerMain（customerMain 委托），不是 customer——
    // 原写法在真实 Prisma Client 上是 undefined.findUnique，单测用的 mock 按调用方
    // 写死了 customer 键所以没测出来，任何客户账簿（ownerNo 非空）案件一开单就 500。
    const owner = kase.ownerNo
      ? await (this.prisma as any).customerMain.findUnique({ where: { customerNo: kase.ownerNo }, select: { id: true } })
      : null;

    const row = await (this.prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: generateReferenceNo('ADJ'),
        caseNo: dto.caseNo,
        explainedFlowId: dto.explainedFlowId ?? null,
        explainedExternalLineId: dto.explainedExternalLineId ?? null,
        walletRef: kase.walletRef,
        book,
        direction,
        reasonCode: dto.reasonCode,
        relatedOrderNo: dto.relatedOrderNo ?? null,
        assetCode: kase.assetCode,
        amount: dto.amount,
        effectiveDate: dto.effectiveDate,
        reasonInternal: dto.reasonInternal,
        reasonCustomer: dto.reasonCustomer,
        ownerNo: kase.ownerNo ?? null,
        ownerId: owner?.id ?? null,
        traceId: kase.traceId ?? null,
        // 保持原口径：优先业务号（管理台展示列、铁律⑥不许暴露 UUID），
        // 落不到才退回 UUID——与改前 operatorId = req.user?.userNo || req.user?.sub
        // 的取值顺序一致，这里只是不再让控制器把 actor 提前塌缩成一个字符串。
        createdByUserId: actor.userNo ?? actor.userId,
        status: AdjustmentStatus.DRAFT,
      },
    });
    await this.afterDraftCreated(row, dto, actor);
    return { adjustmentNo: row.adjustmentNo };
  }

  /**
   * 第四族改记开单（spec §6）：caseNo = 错记方案件，toCaseNo = 正主方案件。
   * 两案必须同业务日（跨日改记本轮不做）、同资产、都在 CUSTOMER 账簿、都 OPEN。
   * 正主方是加钱 → 原单守卫沿用（原单 = 记在错记方名下的那张真实充值单，
   * KYT 对这笔钱跑过——放行依据与一期边界线同源；换主后合规复核登记 BACKLOG）。
   * direction 落 'REATTRIBUTE'——它不参与 book×direction 语义，分录由族定。
   */
  private async createReattributionDraft(dto: CreateAdjustmentDto, fromCase: any, actor: ApprovalActorContext) {
    if (!dto.toCaseNo) throw new BadRequestException('改记必须指明正主方案件号（toCaseNo）');
    const toCase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.toCaseNo } });
    if (!toCase) throw new NotFoundException(`正主方案件不存在：${dto.toCaseNo}`);
    if (toCase.status !== 'OPEN') throw new BadRequestException('正主方案件不是打开状态');
    if (fromCase.book === 'FIRM' || toCase.book === 'FIRM') throw new BadRequestException('改记只发生在客户账簿之间');
    if (fromCase.businessDate !== toCase.businessDate) {
      throw new BadRequestException(`两案业务日不同（${fromCase.businessDate} vs ${toCase.businessDate}）——跨日改记本轮不做`);
    }
    if (fromCase.assetCode !== toCase.assetCode) throw new BadRequestException('两案资产不同，改记说不通');
    if (dto.effectiveDate > fromCase.businessDate) {
      throw new BadRequestException(`生效日 ${dto.effectiveDate} 晚于案件业务日 ${fromCase.businessDate}`);
    }
    const relatedOrderNo = dto.relatedOrderNo?.trim();
    if (!relatedOrderNo || !(await this.relatedOrderExists(relatedOrderNo))) {
      throw new BadRequestException('改记必须指向一张已存在的原单（记在错记方名下的那笔真实充值/提现）——KYT 对这笔钱跑过才放行');
    }
    const owner = fromCase.ownerNo
      ? await (this.prisma as any).customerMain.findUnique({ where: { customerNo: fromCase.ownerNo }, select: { id: true } })
      : null;
    const row = await (this.prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: generateReferenceNo('ADJ'),
        caseNo: dto.caseNo,
        explainedFlowId: dto.explainedFlowId ?? null,           // 错记方内部流水锚
        explainedExternalLineId: dto.explainedExternalLineId ?? null, // 正主方外部行锚
        walletRef: fromCase.walletRef,
        toWalletRef: toCase.walletRef,
        toOwnerNo: toCase.ownerNo ?? null,
        book: 'CLIENT',
        direction: 'REATTRIBUTE',
        reasonCode: dto.reasonCode,
        relatedOrderNo,
        assetCode: fromCase.assetCode,
        amount: dto.amount,
        effectiveDate: dto.effectiveDate,
        reasonInternal: dto.reasonInternal,
        reasonCustomer: dto.reasonCustomer,
        ownerNo: fromCase.ownerNo ?? null,
        ownerId: owner?.id ?? null,
        traceId: fromCase.traceId ?? null,
        createdByUserId: actor.userNo ?? actor.userId,
        status: AdjustmentStatus.DRAFT,
      },
    });
    await this.afterDraftCreated(row, dto, actor);
    return { adjustmentNo: row.adjustmentNo };
  }

  /** 开单收尾（四族通用）：DRAFTED 审计（铁律①，销 BACKLOG「createDraft 零审计」）+ 定性联动。 */
  private async afterDraftCreated(row: any, dto: CreateAdjustmentDto, actor: ApprovalActorContext): Promise<void> {
    const actorDisplay = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        action: 'RECON_ADJUSTMENT_DRAFTED',
        actionDomain: 'RECON',
        primarySubjectType: AuditEntityTypes.RECON_ADJUSTMENT,
        primarySubjectNo: row.adjustmentNo,
        ownerCustomerNo: row.ownerNo ?? undefined,
        reasonCode: row.reasonCode,        // requiredFields 顶层
        amount: row.amount,
        subjects: [
          { subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.adjustmentNo, subjectRole: 'PRIMARY' },
          { subjectType: 'RECONCILIATION_CASE', subjectNo: row.caseNo, subjectRole: 'RELATED' },
        ],
        reason: row.reasonInternal,
        requestId: `RECON_ADJUSTMENT_DRAFTED_${row.adjustmentNo}_${randomUUID()}`,
        metadata: { reasonCode: row.reasonCode, direction: row.direction, amount: row.amount, book: row.book, toOwnerNo: row.toOwnerNo ?? null },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );
    if (dto.dispositionNo) await this.dispositions.linkAdjustment(dto.dispositionNo, row.adjustmentNo);
  }

  async submit(adjustmentNo: string, actor: ApprovalActorContext) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.PENDING_APPROVAL);

    // 真实签名：createAndSubmit(createDto, submitDto, actor, client?, options?)
    //   CreateApprovalDto = { actionType, entityRef, objectSnapshot?, traceId? }
    //   SubmitApprovalDto = { reason?, traceId? }
    //   ApprovalActorContext = { actorType: 'ADMIN', userId, userNo?, role?, roleCodes }
    // Fix 1b：describeImpact 要按资产 decimals 把最小单位缩放成人看得懂的金额——
    // 查法照抄 getAdjustment()/getCase() 的资产查询（同一张 asset 表，同一个字段）。
    const assetRow = await (this.prisma as any).asset.findUnique({
      where: { code: row.assetCode }, select: { decimals: true },
    });
    const impact = this.describeImpact(row, assetRow?.decimals ?? 0);
    // Fix 2（末站整改）：这里此前自己拼一个 { userId: operatorId, userNo: operatorId,
    // roleCodes: ['ADMIN'] }——operatorId 是控制器传来的一个已经塌缩过的字符串
    // （业务号或退回 UUID，两种都可能），roleCodes 更是纯造假。approvals.service.ts
    // 的自审拦截比较的是 actor.userId === approval.createdByUserId，而 checker 侧
    // （approvals.controller.ts ensureAdmin）用的 actor.userId 永远是 JWT 的真实
    // UUID——口径不一致，同一个人开单又批自己的单永远比不上、SoD 静默失效。改成
    // 把控制器传下来的真实 actor 原样喂给 createAndSubmit，不再现造一个。
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: 'RECON_ADJUSTMENT_POST',
        entityRef: adjustmentNo,          // handler 靠它回查，不另造 payload
        // 铁律⑥：不放 walletRef——它就是 Wallet.id（内部 UUID），ApprovalDetailPage
        // 的 Technical Detail 用 JsonBlock 把整个 objectSnapshot 原样渲染成不折叠
        // 的 <pre>，会把 UUID 直接摆上审批页。案件已经用业务键 caseNo 标识，
        // impact 已经把后果说成人话，approver 不需要内部钱包引用。
        objectSnapshot: {
          adjustmentNo, caseNo: row.caseNo, book: row.book,
          direction: row.direction, reasonCode: row.reasonCode,
          customerLabel: REASON_SPECS[row.reasonCode as ReasonCode]?.customerLabel ?? null,
          amount: row.amount, assetCode: row.assetCode, ownerNo: row.ownerNo, impact,
          // 第四族改记：审批页要看见正主是谁，否则审批人只看到"错记方少了一笔"，看不到钱去了哪。
          toOwnerNo: row.toOwnerNo ?? null,
        },
        traceId: row.traceId ?? undefined,
      },
      { reason: impact, traceId: row.traceId ?? undefined },
      actor,
    );

    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: {
        status: AdjustmentStatus.PENDING_APPROVAL,
        approvalCaseId: approval.id,
        approvalNo: approval.approvalNo,
      },
    });
  }

  /**
   * Task 6: 详情读模型（GET /admin/reconciliation/adjustments/:adjustmentNo）。
   * 铁律⑥ 对外用业务键——排除 id/ownerId/approvalCaseId/walletRef/toWalletRef 与
   * 两个解释锚（explainedFlowId / explainedExternalLineId 是 account_flows /
   * external_statement_lines 的内部 UUID，界面不得展示）；两个 walletRef 各换成
   * walletNo / toWalletNo（同 reconciliation-query.service.ts getCase 里 walletRow 的查法）。
   *
   * ⚠ toWalletRef 是 T6 顺手收的口：Task 5 让它真正落库之后，排除清单还只剔
   * walletRef——改记单一被查询，正主方钱包的内部 UUID 就随返回体吐出去了。
   */
  async getAdjustment(adjustmentNo: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);

    // 两侧钱包同一个查法（跨钱包合成案件的 'XREF:' 前缀不是真 Wallet.id，查了必空）。
    const walletNoOf = async (ref: string | null | undefined): Promise<string | null> => {
      if (!ref || String(ref).startsWith('XREF:')) return null;
      const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: ref }, select: { walletNo: true } });
      return wallet?.walletNo ?? null;
    };

    // Task 7（admin 详情页）：decimals 供前端 分→元 缩放显示（T4 canon2 惯例，与
    // getCase 同款查法，前端不得自建 code→名字映射表——见
    // tb-account-codes.constant.ts:38）；分录预览的借/贷助记码由 (book, direction)
    // 纯函数推导，不落库、不改行为，复用 onApproved 已经在用的同一对工具函数。
    const assetRow = await (this.prisma as any).asset.findUnique({
      where: { code: row.assetCode }, select: { decimals: true },
    });
    // 第四族走第五种组合。落回 resolvePostingLegs 会把 REATTRIBUTE 当成非 REDUCE
    // 的「增加」，预览显示成「借客户托管 / 贷客户应付」——与真实落账的两腿正相反，
    // 详情页与账本各说各话。
    const legs = row.direction === 'REATTRIBUTE'
      ? resolveReattributionLegs()
      : resolvePostingLegs(row.book as Book, row.direction as Direction);

    const {
      id: _id,
      ownerId: _ownerId,
      approvalCaseId: _approvalCaseId,
      explainedFlowId: _explainedFlowId,
      explainedExternalLineId: _explainedExternalLineId,
      walletRef: _walletRef,
      toWalletRef: _toWalletRef,
      ...rest
    } = row;
    return {
      ...rest,
      walletNo: await walletNoOf(row.walletRef),
      toWalletNo: await walletNoOf(row.toWalletRef),
      decimals: assetRow?.decimals ?? 0,
      debitAccountCode: TB_CODE_TO_COA[legs.debitCode] ?? null,
      creditAccountCode: TB_CODE_TO_COA[legs.creditCode] ?? null,
    };
  }

  // deciderNo：事件里现成的业务号（handler 侧改取 decisionByUserNo 后新增，
  // 见 adjustment-approval.service.ts）。铁律⑥ 与 createdByUserId 同一惯例——
  // 优先业务号，落不到才退回 deciderId（EXPIRED 路径没有裁决人，deciderId
  // 本身就是 'SYSTEM' 兜底）。不收 deciderRole——本方法不写审计，没有落点，
  // 收了也是死参数。
  async onRejected(adjustmentNo: string, deciderId: string, deciderNo?: string | null) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.REJECTED);
    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: deciderNo ?? deciderId },
    });
  }

  /**
   * Task 5 落账：审批通过后一次性记账 + 置 POSTED。
   * ⚠ 落在 @OnEvent handler 里跑（AdjustmentApprovalService.handleApproved）——
   * 审批端点会先返回 APPROVED，这里才异步执行；handler 抛出的异常本仓库
   * 现状不外传（见 PRODUCTION-NOTES 2026-08-28），如实描述，不在此处补 try/catch。
   *
   * deciderNo/deciderRole：事件里现成的业务号/角色，handler 侧改取
   * decisionByUserNo/decisionByRole 后新增（见 adjustment-approval.service.ts）。
   * 铁律⑥：evidence.actorId、decidedByUserId、审计 actorNo/actorDisplayName
   * 三个落点都优先业务号（与 createdByUserId 同一惯例），落不到才退回
   * deciderId；actorRolesAtTime 用真实角色取代硬编码 ['ADMIN']——RECON_
   * ADJUSTMENT_POST 是单步 OPS_OFFICER 策略，审计快照此前记的是一个与
   * 事实不符的角色。
   */
  async onApproved(adjustmentNo: string, deciderId: string, deciderNo?: string | null, deciderRole?: string | null): Promise<void> {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);

    // 第四族改记（spec §6）：分录不由 book × direction 推导，两腿是同一个科目、
    // 不同 ownerUuid。分流在状态闸之前——改记路径自带同一道闸，不重复走。
    if (row.direction === 'REATTRIBUTE') {
      return this.postReattribution(row, deciderId, deciderNo, deciderRole);
    }

    this.assertTransition(row.status, AdjustmentStatus.POSTED);

    // 铁律⑥：对人可见的三个落点（evidence.actorId / decidedByUserId / 审计
    // actorNo·actorDisplayName）一律用它，不直接用 deciderId（JWT UUID）。
    const deciderDisplay = deciderNo ?? deciderId;

    const legs = resolvePostingLegs(row.book as Book, row.direction as Direction);

    // ⚠ ledger 必须按资产的 **currency** 取，不是 assetCode。
    // `TB_LEDGERS` 的键是币种（AED / USDT），而 `reconciliation_cases.assetCode`
    // 存的是 `asset.code`——法币两者恰好同名（AED），加密币不同（code 'USDT-TRON'
    // vs currency 'USDT'）。早先直接拿 assetCode 索引，法币一路绿、**所有加密币
    // 案件必然 ledger=undefined**，resolveTbAccountId 抛 NotFoundException，
    // 而 handler 的异常本仓库现状不外传（PRODUCTION-NOTES 2026-08-28），
    // 于是调账单永远停在 PENDING_APPROVAL、无人被告知。走查时真踩到过。
    // 全仓惯例见 withdraw-workflow.service.ts:471/1158/1662，都是 asset.currency。
    const assetRow = await (this.prisma as any).asset.findUnique({
      where: { code: row.assetCode }, select: { currency: true },
    });
    const ledger = TB_LEDGERS[assetRow?.currency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new NotFoundException(
        `资产 ${row.assetCode} 解析不出账本 ledger（currency=${assetRow?.currency ?? '未找到该资产'}）`,
      );
    }

    // 科目 → TbAccountRegistry 里的真实 ownerType。客户负债类(CLIENT_PAYABLE/
    // DEPOSIT_SUSPENSE)按客户 UUID 登记；其余（聚合资产 CLIENT_ASSET/FIRM_ASSET、
    // 公司权益 FIRM_OPS/FIRM_SET、收入 INCOME_*）一律 'SYSTEM'——见
    // asset-provisioning.service.ts:46 与 seed.business.ts:711 的真实登记调用，
    // 'FIRM' 不是本仓库任何地方登记过的 ownerType，传了会导致 resolveTbAccountId
    // 查不到注册行而抛 NotFoundException（mock 测试若只断言 code 不断言
    // ownerType，这类问题不会被测出来——账户找错了，测试却是绿的）。
    const ownerFor = (code: number) =>
      code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE
        ? { ownerType: 'CUSTOMER' as const, ownerUuid: row.ownerId }
        : { ownerType: 'SYSTEM' as const };

    const debitAccountId = await this.accounting.resolveTbAccountId({ code: legs.debitCode, ledger, ...ownerFor(legs.debitCode) } as any);
    const creditAccountId = await this.accounting.resolveTbAccountId({ code: legs.creditCode, ledger, ...ownerFor(legs.creditCode) } as any);

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount: BigInt(row.amount),
      ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'RECON_ADJUSTMENT',
        sourceNo: row.adjustmentNo,
        eventCode: 'RECON_ADJUSTMENT_POSTED',
        traceId: row.traceId || row.adjustmentNo,
        debitCode: TB_CODE_TO_COA[legs.debitCode],
        creditCode: TB_CODE_TO_COA[legs.creditCode],
        // ⚠ assetCurrency 必须是 asset.currency，不是 assetCode——同一个 code≠
        // currency 的坑上面 :296-303 刚论证过（USDT-TRON vs USDT）。这里落到
        // account_flows.assetCode / tb_transfer_evidence.assetCode，前端筛选
        // 用的是 asset.currency：传错的话，加密币调账分录在按币种筛选时会从
        // 列表里消失（本仓库已为同一类错误付过一次学费，见 commit eaaf5eae）。
        assetCurrency: assetRow?.currency ?? row.assetCode,
        actorType: 'ADMIN',
        actorId: deciderDisplay,
        memo: row.reasonInternal,
        // ⚠ 必须落到出问题的那个钱包，否则 delta 不归零、case 无法自愈
        debitWalletRef: row.walletRef,
        creditWalletRef: row.walletRef,
        // 调账是纯账面重分类，不出现在任何外部账单上——置 false 才不会被
        // wallet-flow-matcher 当成「内部有外部无」的孤儿行
        isExternalCrossing: false,
        effectiveDate: row.effectiveDate,
      },
    });

    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: {
        status: AdjustmentStatus.POSTED,
        decidedByUserId: deciderDisplay,
        postedAt: new Date(),
        tbTransferId: tbTransferId.toString(),
      },
    });

    // 信封照 push-order.service.ts:235 `recordPush` 抄——对账件的现成范本。
    // RECON_CASE 不是词表里的登记名（词表里案件叫 RECONCILIATION_CASE，同模块开案审计
    // wallet-recon-run.service.ts 就是用这个词）——用错词会让「按案件查这笔调账」这条链路串不起来。
    const subjects: any[] = [
      { subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.adjustmentNo, subjectRole: 'PRIMARY' },
    ];
    if (row.ownerNo) subjects.push({ subjectType: 'CUSTOMER', subjectNo: row.ownerNo, subjectRole: 'OWNER' });
    if (row.caseNo) subjects.push({ subjectType: 'RECONCILIATION_CASE', subjectNo: row.caseNo, subjectRole: 'RELATED' });

    await this.auditLogs.recordByActor(
      {
        action: 'RECON_ADJUSTMENT_POSTED',
        actionDomain: 'RECON',
        primarySubjectType: AuditEntityTypes.RECON_ADJUSTMENT,
        primarySubjectNo: row.adjustmentNo,
        ownerCustomerNo: row.ownerNo,
        // INHERIT 码，assertActionSpec 对空 correlationId 直接拒写——回落表达式与
        // evidence.traceId（上面 :181）保持一致，两侧不许各写各的。
        correlationId: row.traceId || row.adjustmentNo,
        fromStatus: AdjustmentStatus.PENDING_APPROVAL,
        toStatus: AdjustmentStatus.POSTED,
        subjects,
        reason: row.reasonInternal,
        // requiredFields 读的是顶层字段，不是 metadata——这三个必须在这一层重复一份
        // （即便 metadata 里也有），否则 assertActionSpec 会拒写：账已过、单已 POSTED，
        // 这一步再拒就是「落了账却没留痕」，静默踩铁律①。
        reasonCode: row.reasonCode,
        amount: row.amount,
        effectiveDate: row.effectiveDate,
        requestId: `RECON_ADJUSTMENT_POSTED_${row.adjustmentNo}_${randomUUID()}`,
        metadata: {
          reasonCode: row.reasonCode, direction: row.direction, amount: row.amount,
          effectiveDate: row.effectiveDate, relatedOrderNo: row.relatedOrderNo, book: row.book,
        },
        sourcePlatform: 'ADMIN',
      } as any,
      {
        actorType: 'ADMIN', actorNo: deciderDisplay, actorDisplayName: deciderDisplay,
        // 真实审批角色取代硬编码 ['ADMIN']——RECON_ADJUSTMENT_POST 是单步
        // OPS_OFFICER 策略，硬编码会让审计记下一个与事实不符的角色快照。
        // 兜底 'ADMIN' 只在旧签名两参调用（deciderRole 缺省）时触发，与此前
        // 行为等价，不影响既有单测。
        actorRolesAtTime: [deciderRole ?? 'ADMIN'],
      },
    );
  }

  /**
   * 第四族落账（spec §6）：借 错记方应付 / 贷 正主方应付。
   *
   * 客户资产腿（CLIENT_ASSET）刻意不出现——托管里的钱一分没动，动的只是
   * 「这笔钱是谁的」。两腿是**同一个科目 CLIENT_PAYABLE、不同 ownerUuid**，
   * 这就是负债换主人的全部机制；写成资产腿参与的组合等于凭空搬动托管余额。
   *
   * 落账路径上的坑与 onApproved 主路径同源（那边的行内注释逐条论证过成因与
   * 事故现场，这里不重复誊，只标出四个必须照办的点）：
   *   ① ledger 按 asset.**currency** 取，不是 assetCode（USDT-TRON vs USDT）；
   *   ② CLIENT_PAYABLE 在 TbAccountRegistry 里按客户 UUID 登记 → ownerType 必须
   *      是 'CUSTOMER' 并带 ownerUuid；
   *   ③ evidence.assetCurrency 同样是 currency，传 code 会让加密币分录在按币种
   *      筛选时从列表里消失；
   *   ④ evidence 两腿钱包**各落各的**——错记方降、正主方升，两案的差额才各自
   *      归零，重对账时两个案子一起自愈（这一条是第四族独有的，主路径两腿同钱包）。
   */
  private async postReattribution(row: any, deciderId: string, deciderNo?: string | null, deciderRole?: string | null): Promise<void> {
    this.assertTransition(row.status, AdjustmentStatus.POSTED);
    const deciderDisplay = deciderNo ?? deciderId;

    const assetRow = await (this.prisma as any).asset.findUnique({
      where: { code: row.assetCode }, select: { currency: true },
    });
    const ledger = TB_LEDGERS[assetRow?.currency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new NotFoundException(
        `资产 ${row.assetCode} 解析不出账本 ledger（currency=${assetRow?.currency ?? '未找到该资产'}）`,
      );
    }

    // 正主方单上只有业务号（铁律⑥ 落库口径），落账要 UUID 才定位得到它的负债户。
    const toOwner = row.toOwnerNo
      ? await (this.prisma as any).customerMain.findUnique({ where: { customerNo: row.toOwnerNo }, select: { id: true } })
      : null;
    if (!row.ownerId || !toOwner?.id) {
      throw new NotFoundException(
        `改记两端客户解析失败（错记方 ownerId=${row.ownerId ?? '空'}、正主方 toOwnerNo=${row.toOwnerNo ?? '空'}）`,
      );
    }

    const legs = resolveReattributionLegs();
    const debitAccountId = await this.accounting.resolveTbAccountId({ code: legs.debitCode, ledger, ownerType: 'CUSTOMER', ownerUuid: row.ownerId } as any);
    const creditAccountId = await this.accounting.resolveTbAccountId({ code: legs.creditCode, ledger, ownerType: 'CUSTOMER', ownerUuid: toOwner.id } as any);

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount: BigInt(row.amount),
      ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'RECON_ADJUSTMENT',
        sourceNo: row.adjustmentNo,
        eventCode: 'RECON_ADJUSTMENT_POSTED',
        traceId: row.traceId || row.adjustmentNo,
        debitCode: TB_CODE_TO_COA[legs.debitCode],
        creditCode: TB_CODE_TO_COA[legs.creditCode],
        assetCurrency: assetRow?.currency ?? row.assetCode,
        actorType: 'ADMIN',
        actorId: deciderDisplay,
        memo: row.reasonInternal,
        // 两腿各落各的钱包：错记方余额降、正主方余额升，两案各自的 delta 才归零。
        debitWalletRef: row.walletRef,
        creditWalletRef: row.toWalletRef,
        // 纯账面重分类，不出现在任何外部账单上——置 false 才不会被
        // wallet-flow-matcher 当成「内部有外部无」的孤儿行。
        isExternalCrossing: false,
        effectiveDate: row.effectiveDate,
      },
    });

    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo: row.adjustmentNo },
      data: {
        status: AdjustmentStatus.POSTED,
        decidedByUserId: deciderDisplay,
        postedAt: new Date(),
        tbTransferId: tbTransferId.toString(),
      },
    });

    // 审计信封与主路径同构（同一个码、同一份 requiredFields 合同），差异有两处：
    // metadata 多一条正主方线索，subjects 多一个正主方 OWNER。
    const subjects: any[] = [
      { subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.adjustmentNo, subjectRole: 'PRIMARY' },
    ];
    if (row.ownerNo) subjects.push({ subjectType: 'CUSTOMER', subjectNo: row.ownerNo, subjectRole: 'OWNER' });
    // ⚠ 本仓**第一个双 OWNER 事件**（此前每条审计事件至多一个 OWNER 主体，全是
    // 单客户事件）。改记贷记的是正主方的客户负债——**B 的余额真的变了**，不是
    // 旁观者；而审计子表按 subjects 建索引、metadata 不进索引，只把 toOwnerNo
    // 塞进 metadata 等于「改了 B 的钱、按 B 查不到」，铁律① 在这条路径上不成立。
    // 角色取 OWNER 不取 COUNTERPARTY：后者的定义是「外部 VASP / 收款人 / 汇款人」
    // （audit-log.dto.ts AuditSubjectRole），内部客户不贴合。
    // persistSubjects 只约束 PRIMARY 至多一个，不拒第二个 OWNER。
    if (row.toOwnerNo) subjects.push({ subjectType: 'CUSTOMER', subjectNo: row.toOwnerNo, subjectRole: 'OWNER' });
    if (row.caseNo) subjects.push({ subjectType: 'RECONCILIATION_CASE', subjectNo: row.caseNo, subjectRole: 'RELATED' });

    await this.auditLogs.recordByActor(
      {
        action: 'RECON_ADJUSTMENT_POSTED',
        actionDomain: 'RECON',
        primarySubjectType: AuditEntityTypes.RECON_ADJUSTMENT,
        primarySubjectNo: row.adjustmentNo,
        ownerCustomerNo: row.ownerNo,
        // INHERIT 码，assertActionSpec 对空 correlationId 直接拒写——回落表达式与
        // evidence.traceId 保持一致，两侧不许各写各的。
        correlationId: row.traceId || row.adjustmentNo,
        fromStatus: AdjustmentStatus.PENDING_APPROVAL,
        toStatus: AdjustmentStatus.POSTED,
        subjects,
        reason: row.reasonInternal,
        // requiredFields 读的是顶层字段，不是 metadata——这三个必须在这一层重复一份，
        // 否则 assertActionSpec 会拒写：账已过、单已 POSTED，这一步再拒就是
        // 「落了账却没留痕」，静默踩铁律①。
        reasonCode: row.reasonCode,
        amount: row.amount,
        effectiveDate: row.effectiveDate,
        requestId: `RECON_ADJUSTMENT_POSTED_${row.adjustmentNo}_${randomUUID()}`,
        metadata: {
          reasonCode: row.reasonCode, direction: row.direction, amount: row.amount,
          effectiveDate: row.effectiveDate, relatedOrderNo: row.relatedOrderNo, book: row.book,
          toOwnerNo: row.toOwnerNo ?? null,
        },
        sourcePlatform: 'ADMIN',
      } as any,
      {
        actorType: 'ADMIN', actorNo: deciderDisplay, actorDisplayName: deciderDisplay,
        actorRolesAtTime: [deciderRole ?? 'ADMIN'],
      },
    );
  }
}
