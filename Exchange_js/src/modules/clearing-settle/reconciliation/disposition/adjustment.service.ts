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
  assertReasonAllowed, requiresRelatedOrder, resolvePostingLegs,
} from './adjustment-rules';

@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
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
  }, decimals: number): string {
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

    // 闸一：成因 × 账簿 × 方向 合法性
    assertReasonAllowed(dto.reasonCode as ReasonCode, book, direction);

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
        lineItemId: dto.lineItemId,
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
    return { adjustmentNo: row.adjustmentNo };
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
        objectSnapshot: {
          adjustmentNo, caseNo: row.caseNo, walletRef: row.walletRef, book: row.book,
          direction: row.direction, reasonCode: row.reasonCode,
          customerLabel: REASON_SPECS[row.reasonCode as ReasonCode]?.customerLabel ?? null,
          amount: row.amount, assetCode: row.assetCode, ownerNo: row.ownerNo, impact,
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
   * 铁律⑥ 对外用业务键——排除 id/ownerId/approvalCaseId/lineItemId 四个内部 UUID
   * （ownerId 的界面禁令见 schema 字段注释），walletRef 换成 walletNo（同
   * reconciliation-query.service.ts getCase 里 walletRow 的查法）。
   */
  async getAdjustment(adjustmentNo: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);

    const wallet = row.walletRef && !String(row.walletRef).startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({ where: { id: row.walletRef }, select: { walletNo: true } })
      : null;

    // Task 7（admin 详情页）：decimals 供前端 分→元 缩放显示（T4 canon2 惯例，与
    // getCase 同款查法，前端不得自建 code→名字映射表——见
    // tb-account-codes.constant.ts:38）；分录预览的借/贷助记码由 (book, direction)
    // 纯函数推导，不落库、不改行为，复用 onApproved 已经在用的同一对工具函数。
    const assetRow = await (this.prisma as any).asset.findUnique({
      where: { code: row.assetCode }, select: { decimals: true },
    });
    const legs = resolvePostingLegs(row.book as Book, row.direction as Direction);

    const { id: _id, ownerId: _ownerId, approvalCaseId: _approvalCaseId, lineItemId: _lineItemId, walletRef: _walletRef, ...rest } = row;
    return {
      ...rest,
      walletNo: wallet?.walletNo ?? null,
      decimals: assetRow?.decimals ?? 0,
      debitAccountCode: TB_CODE_TO_COA[legs.debitCode] ?? null,
      creditAccountCode: TB_CODE_TO_COA[legs.creditCode] ?? null,
    };
  }

  async onRejected(adjustmentNo: string, deciderId: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.REJECTED);
    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: deciderId },
    });
  }

  /**
   * Task 5 落账：审批通过后一次性记账 + 置 POSTED。
   * ⚠ 落在 @OnEvent handler 里跑（AdjustmentApprovalService.handleApproved）——
   * 审批端点会先返回 APPROVED，这里才异步执行；handler 抛出的异常本仓库
   * 现状不外传（见 PRODUCTION-NOTES 2026-08-28），如实描述，不在此处补 try/catch。
   */
  async onApproved(adjustmentNo: string, deciderId: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.POSTED);

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
        assetCurrency: row.assetCode,
        actorType: 'ADMIN',
        actorId: deciderId,
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
        decidedByUserId: deciderId,
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
      { actorType: 'ADMIN', actorNo: deciderId, actorDisplayName: deciderId, actorRolesAtTime: ['ADMIN'] },
    );
  }
}
