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
import { AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ADJUSTMENT_TRANSITIONS, AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { AdjustmentListRow, CreateAdjustmentDto } from '../dto/adjustment.dto';
import { bigintToDecimal } from '../../../funds-layer/accounting/tb-amount.util';
import { bigintToHex, deterministicTransferId } from '../../../accounting/tigerbeetle/utils/tb-id.util';
import {
  Book, Direction, ReasonCode, REASON_SPECS, RECON_ADJUSTMENT_SOURCE_TYPE, RECON_ADJUSTMENT_CASH_EVENT_CODE,
  assertReasonAllowed, requiresRelatedOrder, resolvePostingLegs, resolveReattributionLegs,
} from './adjustment-rules';
import { AdjustFamily, DispositionKind, causeDisplayLabel } from './cause-registry';
import { assertAgingWriteOffAllowed, assertIncidentWriteOffAllowed, writeOffPathOf } from './write-off-guards';
import { DispositionService } from './disposition.service';
import { resolveWalletNo } from '../domain/wallet-no.util';
import { decimalsMapOf } from '../domain/asset-decimals.util';

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
      throw new BadRequestException(`Illegal adjustment status transition: ${from} → ${to}`);
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
    toOwnerNo?: string | null; caseNo?: string | null;
  }, decimals: number, extra?: {
    walletNo?: string | null; agedDays?: number | null; findingNote?: string | null;
    // 平账三期 Task 10 评审 Fix 3：锚中定性行带事故号时由调用方（submit()）传入，
    // 用来在 UNEXPLAINED_WRITE_OFF 分支里分流出事故路文案。
    incidentNo?: string | null;
    // 成因 = OTHER 时由调用方（submit()）从锚中定性行带入的「Other cause」一行，
    // 审批句里的 cause 打成 `Other · <otherCause>` 而不是裸 Other。
    otherCause?: string | null;
  }): string {
    // 第四族改记（spec §6）：三族的「余额增加/减少」话术套上来是错的——钱在托管里
    // 一分没动，只是主人记错了。审批人要读到的是「从谁名下去了谁名下」，
    // 以及「客户资产总额不变」这个判断该不该批的关键事实。
    if (row.direction === 'REATTRIBUTE') {
      const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
      return `This adjustment reattributes ${majorAmount} ${row.assetCode} from customer ${row.ownerNo ?? '(unknown)'} to customer ${row.toOwnerNo ?? '(unknown)'}; `
           + `total customer assets are unchanged; reason: ${row.reasonInternal}`;
    }
    // 第五族核销（spec §3.7）：审批人要读到的是「哪个池子、哪个钱包、差额往哪去、悬了多久、查过什么」。
    // 评审修复（I1）：公司簿同样有事故升级路（LARGE_UNEXPLAINED，公司池版）——事故已经
    // 定损，继续说「悬了多久、查过什么」是文不对题；对齐客户簿既有事故句式，带上事故
    // 单号 + 金额锁定的依据。
    if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF') {
      const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
      const outlet = row.direction === 'REDUCE' ? 'recognized as reconciliation write-off loss' : 'recorded as other income';
      if (extra?.incidentNo) {
        return `Firm pool write-off (incident ${extra.incidentNo} assessed ${majorAmount} ${row.assetCode}): wallet ${extra?.walletNo ?? '(unknown)'} ${row.assetCode} difference ${majorAmount} ${outlet}; `
             + `amount is locked to the incident's assessed loss; investigation conclusion: ${extra?.findingNote ?? row.reasonInternal}`;
      }
      return `Firm pool unexplained write-off: wallet ${extra?.walletNo ?? '(unknown)'} ${row.assetCode} difference ${majorAmount} ${outlet}; `
           + `case ${row.caseNo ?? '(unknown)'} has been overdue ${extra?.agedDays ?? '?'} days; investigation conclusion: ${extra?.findingNote ?? row.reasonInternal}`;
    }
    const dir = row.direction === 'REDUCE' ? 'decrease' : 'increase';
    const who = row.book === 'CLIENT' ? `customer ${row.ownerNo ?? '(unknown)'}` : 'the firm';
    const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
    // internalLabel 而不是 customerLabel——后者对公司侧两个成因刻意为 null，
    // 借用它会让审批页回落打印裸枚举「成因：BANK_CHARGE」（末站评审 Minor 1）。
    const label = row.reasonCode === 'OTHER'
      ? causeDisplayLabel('OTHER', extra?.otherCause)
      : (REASON_SPECS[row.reasonCode as ReasonCode]?.internalLabel ?? row.reasonCode);
    return `This adjustment will ${dir} ${who}'s balance by ${majorAmount} ${row.assetCode}; `
         + `cause: ${label}; reason: ${row.reasonInternal}`;
  }

  /**
   * Fix 3（末站整改，§4 边界线守卫）：relatedOrderNo 必须指向一张已存在的
   * 充值/提现/兑换单——有原单 = KYT 已对它跑过，改金额不算绕闸；无原单 = 凭空
   * 加钱。三张表各自查一次、命中就短路，不用 Promise.all 是为了单测里只需要
   * mock 命中的那张表，不必给全部三张表都摆一个 mock（同案例走查也只会命中
   * 其中一张）。
   */
  private async relatedOrderExists(orderNo: string): Promise<boolean> {
    const deposit = await this.prisma.depositTransaction.findUnique({
      where: { depositNo: orderNo }, select: { id: true },
    });
    if (deposit) return true;
    const withdraw = await this.prisma.withdrawTransaction.findUnique({
      where: { withdrawNo: orderNo }, select: { id: true },
    });
    if (withdraw) return true;
    const swap = await this.prisma.swapTransaction.findUnique({
      where: { swapNo: orderNo }, select: { id: true },
    });
    return !!swap;
  }

  /**
   * 公司池核销四前提（spec §3.2）——全部 400、人话文案：
   *   ① 案子已超期  ② 锚的那行已定性且出口 = 挂起·调查中、未挂单
   *   ③ 簿别 × 成因码配对  ④ 金额 ≤ 该币种小额线
   * 事故路（锚的定性行出口是 INCIDENT，或挂了事故号）分流到事故三重闸，改查事故侧的定损结论。
   * 返回命中的定性行（afterDraftCreated 据此挂单号锁定）。
   *
   * 戊波二 T7a：客户池认损不再是调账单（改走划转单「认损补缺」，InternalTransferWorkflowService.initiateShortfallTopup），
   * 两路守卫本体搬进 write-off-guards.ts，与认损补缺单共用一份；本服务只留公司池这一个调用方，
   * 簿别配对（assertReasonPairing）因而收窄为「只有公司池」。
   */
  private async assertWriteOffAllowed(dto: CreateAdjustmentDto, kase: any, book: Book): Promise<{ dispositionNo: string }> {
    const anchors = [
      dto.explainedFlowId ? { explainedFlowId: dto.explainedFlowId } : null,
      dto.explainedExternalLineId ? { explainedExternalLineId: dto.explainedExternalLineId } : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    if (anchors.length === 0) {
      throw new BadRequestException('Write-off must be anchored to a difference line already found as "Hold · Investigating"');
    }
    const held = await this.prisma.reconciliationDisposition.findFirst({ where: { caseNo: dto.caseNo, OR: anchors } });
    const guard = { kase, held, amountMinor: BigInt(dto.amount), assertPairing: () => this.assertReasonPairing(book) };
    const { dispositionNo } = writeOffPathOf(held) === 'INCIDENT'
      ? await assertIncidentWriteOffAllowed(this.prisma, guard)
      : await assertAgingWriteOffAllowed(this.prisma, guard);
    return { dispositionNo };
  }

  /**
   * ③ 簿别配对：核销（UNEXPLAINED_WRITE_OFF）只属于公司池。客户池托管里少了钱，不再开调账单把客户余额先减下去，
   * 而是「认损补缺」一张划转单、一次批——批准那一步记短缺、客户余额不动，再由公司补钱到客户钱包。
   */
  private assertReasonPairing(book: Book): void {
    if (book !== 'FIRM') {
      throw new BadRequestException('Client pool differences are recognized and topped up in one step ("Recognize loss & top up", a shortfall top-up) — an adjustment cannot write them off');
    }
  }

  /**
   * 写端翻转（Task 3）：createDraft 原子入口的处置映射——单码制下 dto.reasonCode 直接
   * 落 cause-registry.ts 的 CauseCode 同名码（adjustment-rules.ts 头注释），它的
   * family 与 DispositionKind 四个非核销/非改记值同名同值，直接当处置用。
   * WRITE_OFF/REATTRIBUTE 两族各自另有专门的前置分支（assertWriteOffAllowed /
   * createReattributionDraft），走不到这个原子路径——调用点在那两支分流之后。
   */
  private kindOfFamily(reasonCode: ReasonCode): DispositionKind {
    const family = REASON_SPECS[reasonCode]?.family;
    if (family === 'CORRECT' || family === 'REVERSE' || family === 'RECORD' || family === 'REATTRIBUTE') return family;
    throw new BadRequestException(`Reason ${reasonCode} has no matching disposition for the atomic finding path`);
  }

  async createDraft(dto: CreateAdjustmentDto, actor: ApprovalActorContext) {
    const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo: dto.caseNo } });
    if (!kase) throw new NotFoundException(`Reconciliation case not found: ${dto.caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('Adjustments can only be opened on open cases');

    const book: Book = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    const direction = dto.direction as Direction;

    // 第四族改记：不走 book×direction 语义（CUSTOMER_REATTRIBUTION 的 directions
    // 是空数组，assertReasonAllowed 对它任何方向都拒）——必须在那道闸之前分流出去。
    if (dto.reasonCode === 'CUSTOMER_REATTRIBUTION') {
      return this.createReattributionDraft(dto, kase, actor);
    }

    // 第五族核销（spec §3.2）：四道前提，少一道就是抹差异的后门。守卫顺序 = spec 表序。
    let heldDispositionNo: string | null = null;
    if (dto.reasonCode === 'UNEXPLAINED_WRITE_OFF') {
      heldDispositionNo = (await this.assertWriteOffAllowed(dto, kase, book)).dispositionNo;
    }

    // 写端翻转（Task 3）：行未定性（无 dispositionNo）+ dto 带 causeCode/findingNote →
    // 原子先 record 再开单，afterDraftCreated 收尾时复用既有 linkAdjustment 挂号
    // （两处审计各一条：RECON_DISPOSITION_RECORDED + RECON_ADJUSTMENT_DRAFTED）。
    // 核销路（heldDispositionNo 已锁定）与老调用方（已传 dispositionNo）都不重复走这条；
    // record() 自身的挂单锁（该锚已挂调账单）在这里原样生效——不重复判定。
    //
    // 评审修复（Important 1）：此前守卫是 `causeCode && findingNote`——只带其一时
    // 静默跳过定性、草稿照建，前端漏填一个字段就悄悄退化成"无定性开单"、财务毫无
    // 感知。改成显式配对校验：恰好只带其一 → 400；两个都不带才是既有的合法「无
    // 定性开单」路径，原样放行不动。
    let atomicDispositionNo: string | undefined;
    if (!heldDispositionNo && !dto.dispositionNo) {
      if (Boolean(dto.causeCode) !== Boolean(dto.findingNote)) {
        throw new BadRequestException('Recording a finding with the adjustment requires both causeCode and findingNote');
      }
      if (dto.causeCode && dto.findingNote) {
        // Task 8 评审修复：优先信 dto.disposition（前端随处置按钮原样带上）——
        // kindOfFamily(reasonCode) 只在旧调用方不传 disposition 时兜底。OTHER 码的
        // REASON_SPECS.OTHER.family 是占位 'CORRECT'（cause-registry.ts 顶部注释：
        // OTHER 不真的属于冲正族，只是留痕分组要有个桶放）——纯靠回落会把 OTHER 配
        // REVERSE/RECORD 处置时也判死成 CORRECT，定性出口写错。
        const family = dto.disposition ?? this.kindOfFamily(dto.reasonCode as ReasonCode);
        // 评审修复（Minor 3，单码制一致闸）：防审计里一件事记两个因。只对
        // CORRECT/REVERSE/RECORD 三族生效——REATTRIBUTE 族的 reasonCode 恒为
        // CUSTOMER_REATTRIBUTION，而 cause 是 MISATTRIBUTED_FROM/MISATTRIBUTED_TO，
        // 两者必然不同码（且该族其实走不到这里：createDraft 顶部已把它分流到
        // createReattributionDraft，这条按族判断只是不依赖那条分流也站得住）。
        if ((family === 'CORRECT' || family === 'REVERSE' || family === 'RECORD') && dto.causeCode !== dto.reasonCode) {
          throw new BadRequestException('Under the single-code regime the finding cause and the adjustment reason code must be the same code');
        }
        // 评审修复（Minor 6）：record() 的 matchType 是必填列——CreateAdjustmentDto 上它
        // 是可选字段，不能让 undefined 溜进 NOT NULL 列；进 record() 前显式拒绝，给一句
        // 人话 400，而不是靠 `any` 断言掩盖类型缺口、让数据库层报一个不可读的错误。
        if (!dto.matchType) {
          throw new BadRequestException('Recording a finding requires the row facts (matchType)');
        }
        const recorded = await this.dispositions.record({
          caseNo: dto.caseNo,
          explainedFlowId: dto.explainedFlowId,
          explainedExternalLineId: dto.explainedExternalLineId,
          matchType: dto.matchType,
          causeCode: dto.causeCode,
          disposition: family,
          findingNote: dto.findingNote,
          otherCause: dto.otherCause,
          deltaSign: dto.deltaSign,
          internalDirection: dto.internalDirection,
          internalSourceType: dto.internalSourceType,
          externalDirection: dto.externalDirection,
        }, actor);
        atomicDispositionNo = recorded.dispositionNo;
      }
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
        `Effective date ${dto.effectiveDate} is later than the case's business date ${kase.businessDate}——`
        + "an adjustment corrects the books for that business day; landing it in a later period means a rerun of reconciliation for that day will not see this entry, and the difference will never clear.",
      );
    }

    // 闸二：§4 边界线——客户账簿加钱必须指向一张已存在的原单。
    // Fix 3（末站整改）：此前只查非空，不查存在——任意非空字符串都放行，等于
    // 边界线守卫本身可以被一个假单号绕过（本分支自己的 e2e 场景 2 就传了个
    // 不存在的 'WDR-E2E-ADJ-C2-0001' 并成功过账，是这条缺口的现成实证）。
    if (requiresRelatedOrder(book, direction)) {
      const relatedOrderNo = dto.relatedOrderNo?.trim();
      if (!relatedOrderNo) {
        throw new BadRequestException(
          'Adding funds to a client-book account must reference an existing order — without one, this would credit the customer out of thin air and bypass KYT and compliance gates; '
          + 'for an unattributed inbound deposit, use deposit backfill instead.',
        );
      }
      if (!(await this.relatedOrderExists(relatedOrderNo))) {
        throw new BadRequestException(
          `Related order not found: ${relatedOrderNo}——it must reference an existing deposit, withdrawal, or swap order, `
          + 'otherwise it credits the customer out of thin air and bypasses KYT and compliance gates.',
        );
      }
    }

    // 落账时 resolveTbAccountId 要客户 UUID，case 上只有业务号，这里换一次。
    // Task 6 修复：Prisma 模型是 CustomerMain（customerMain 委托），不是 customer——
    // 原写法在真实 Prisma Client 上是 undefined.findUnique，单测用的 mock 按调用方
    // 写死了 customer 键所以没测出来，任何客户账簿（ownerNo 非空）案件一开单就 500。
    const owner = kase.ownerNo
      ? await this.prisma.customerMain.findUnique({ where: { customerNo: kase.ownerNo }, select: { id: true } })
      : null;

    if (kase.walletRef === null) {
      throw new BadRequestException(`Case ${dto.caseNo} has no wallet reference — adjustments can only be raised on wallet-anchored cases`);
    }

    const row = await this.prisma.reconciliationAdjustment.create({
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
    // 核销：优先挂守卫刚验过的那条定性；原子路径挂刚才 record() 建出的那条；都没有才信
    // 客户端传来的号（Task 7 评审 + Task 3 写端翻转，三者互斥，取值顺序即优先级）。
    await this.afterDraftCreated(row, { ...dto, dispositionNo: heldDispositionNo ?? atomicDispositionNo ?? dto.dispositionNo ?? undefined }, actor);
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
    if (!dto.toCaseNo) throw new BadRequestException('Reattribution must specify the rightful-owner case number (toCaseNo)');
    const toCase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo: dto.toCaseNo } });
    if (!toCase) throw new NotFoundException(`Rightful-owner case not found: ${dto.toCaseNo}`);
    if (toCase.status !== 'OPEN') throw new BadRequestException('The rightful-owner case is not open');
    if (fromCase.book === 'FIRM' || toCase.book === 'FIRM') throw new BadRequestException('Reattribution can only happen between client-book cases');
    if (fromCase.businessDate !== toCase.businessDate) {
      throw new BadRequestException(`The two cases have different business dates (${fromCase.businessDate} vs ${toCase.businessDate})——cross-day reattribution is not supported this round`);
    }
    if (fromCase.assetCode !== toCase.assetCode) throw new BadRequestException('The two cases have different assets — reattribution does not make sense');
    if (dto.effectiveDate > fromCase.businessDate) {
      throw new BadRequestException(`Effective date ${dto.effectiveDate} is later than the case's business date ${fromCase.businessDate}`);
    }
    const relatedOrderNo = dto.relatedOrderNo?.trim();
    if (!relatedOrderNo || !(await this.relatedOrderExists(relatedOrderNo))) {
      throw new BadRequestException('Reattribution must reference an existing order (the real deposit/withdrawal recorded under the misattributed owner) — it is only allowed once KYT has cleared that money');
    }
    const owner = fromCase.ownerNo
      ? await this.prisma.customerMain.findUnique({ where: { customerNo: fromCase.ownerNo }, select: { id: true } })
      : null;
    const row = await this.prisma.reconciliationAdjustment.create({
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
          { subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.adjustmentNo, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: row.caseNo, subjectRole: AuditSubjectRole.RELATED },
        ],
        reason: row.reasonInternal,
        requestId: `RECON_ADJUSTMENT_DRAFTED_${row.adjustmentNo}_${randomUUID()}`,
        // 成因 = OTHER 时带上财务给它起的名字（原子开单路径下 dto 手边就有），按单号查审计才看得到 Other 具体指什么。
        metadata: {
          reasonCode: row.reasonCode, direction: row.direction, amount: row.amount, book: row.book, toOwnerNo: row.toOwnerNo ?? null,
          ...(row.reasonCode === 'OTHER' && dto.otherCause ? { otherCause: dto.otherCause } : {}),
        },
        sourcePlatform: 'ADMIN',
      },
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );
    if (dto.dispositionNo) {
      const family = REASON_SPECS[row.reasonCode as ReasonCode]?.family as AdjustFamily | undefined;
      await this.dispositions.linkAdjustment(dto.dispositionNo, row.adjustmentNo, { family });
    }
  }

  async submit(adjustmentNo: string, actor: ApprovalActorContext) {
    const row = await this.prisma.reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`Adjustment not found: ${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.PENDING_APPROVAL);

    // 真实签名：createAndSubmit(createDto, submitDto, actor, client?, options?)
    //   CreateApprovalDto = { actionType, entityRef, objectSnapshot?, traceId? }
    //   SubmitApprovalDto = { reason?, traceId? }
    //   ApprovalActorContext = { actorType: 'ADMIN', userId, userNo?, role?, roleCodes }
    // Fix 1b：describeImpact 要按资产 decimals 把最小单位缩放成人看得懂的金额——
    // 查法照抄 getAdjustment()/getCase() 的资产查询（同一张 asset 表，同一个字段）。
    const assetRow = await this.prisma.asset.findUnique({
      where: { code: row.assetCode }, select: { decimals: true },
    });
    // 第五族核销：后果原话要带钱包号 / 超期天数 / 查证结论（spec §3.7），三样都不在单上，现查。
    // 平账三期 Task 10 评审 Fix 3：多查 outlet/incidentNo——锚中定性行出口是
    // 'INCIDENT' 时把事故单号递给 describeImpact，UNEXPLAINED_WRITE_OFF 分支据此
    // 分流出事故路文案（不带超期天数、不说查无果）。
    let extra: { walletNo?: string | null; agedDays?: number | null; findingNote?: string | null; incidentNo?: string | null; otherCause?: string | null } | undefined;
    if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF') {
      const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo: row.caseNo }, select: { slaDeadline: true } });
      const walletNo = await resolveWalletNo(this.prisma, row.walletRef);
      const held = await this.prisma.reconciliationDisposition.findFirst({
        where: { adjustmentNo }, select: { findingNote: true, outlet: true, incidentNo: true },
      });
      const agedDays = kase?.slaDeadline ? Math.max(1, Math.floor((Date.now() - new Date(kase.slaDeadline).getTime()) / 86_400_000)) : null;
      // C1 挂接链评审修复：判据从单看 outlet==='INCIDENT' 改成看 incidentNo 是否存在——
      // LARGE_UNEXPLAINED 升级路的定性行 outlet 一直留在 HOLD_INVESTIGATING，只有
      // incidentNo 会被 attachIncident 写上，纯 outlet 判据永远照不到那条路，审批页
      // 就读不到"金额锁定的依据 = 事故定损"。
      extra = {
        walletNo, agedDays, findingNote: held?.findingNote ?? null,
        incidentNo: held?.incidentNo ?? null,
      };
    }
    // 成因 = OTHER：审批句要带出财务给成因起的名字，它存在锚中定性行上（开单收尾已挂 adjustmentNo）。
    if (row.reasonCode === 'OTHER') {
      const linked = await this.prisma.reconciliationDisposition.findFirst({
        where: { adjustmentNo }, select: { otherCause: true },
      });
      extra = { ...extra, otherCause: linked?.otherCause ?? null };
    }
    const impact = this.describeImpact(row, assetRow?.decimals ?? 0, extra);
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
          // 客户话术只在客户池使用：公司池调账客户不可见，一律 null（'ANY' 码的话术不外露到公司池单上）。
          customerLabel: row.book === 'CLIENT' ? (REASON_SPECS[row.reasonCode as ReasonCode]?.customerLabel ?? null) : null,
          amount: row.amount, assetCode: row.assetCode, ownerNo: row.ownerNo, impact,
          // 第四族改记：审批页要看见正主是谁，否则审批人只看到"错记方少了一笔"，看不到钱去了哪。
          toOwnerNo: row.toOwnerNo ?? null,
        },
        traceId: row.traceId ?? undefined,
      },
      { reason: impact, traceId: row.traceId ?? undefined },
      actor,
    );

    await this.prisma.reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: {
        status: AdjustmentStatus.PENDING_APPROVAL,
        approvalCaseId: approval.id,
        approvalNo: approval.approvalNo,
      },
    });
  }

  /**
   * Task 4: 列表读模型（GET /admin/reconciliation/adjustments）。铁律⑥ 只投影业务键
   * 白名单字段（select 直接圈死，不走「查整行再摘」——摘漏一个就是漏个 UUID）；
   * decimals 按 assetCode 现查 asset 表（同 getAdjustment/submit 既有查法），供前端
   * 分→元 缩放显示。from/to 过滤的是 createdAt（开单落库时刻），不是 effectiveDate
   * （业务生效日）——见 Before You Begin 澄清。
   */
  async listAdjustments(q: { status?: string; from?: string; to?: string; skip?: number; take?: number }): Promise<{ items: AdjustmentListRow[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
      ...((q.from || q.to) && {
        createdAt: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: new Date(q.to) }),
        },
      }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      this.prisma.reconciliationAdjustment.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        select: {
          adjustmentNo: true, caseNo: true, ownerNo: true, assetCode: true,
          reasonCode: true, direction: true, amount: true, status: true,
          effectiveDate: true, createdAt: true,
        },
      }),
      this.prisma.reconciliationAdjustment.count({ where }),
    ]);
    const assetCodes = [...new Set(rows.map((r: any) => r.assetCode as string))];
    const assets = assetCodes.length
      ? await this.prisma.asset.findMany({ where: { code: { in: assetCodes } }, select: { code: true, decimals: true } })
      : [];
    const decimalsByCode = decimalsMapOf(assets);
    // 成因 = OTHER 的单：Reason 列要打成 `Other · <otherCause>`，名字存在锚中定性行上——
    // 只为本页里的 OTHER 行批量查一次（没有 OTHER 行就不发查询）。
    const otherNos = rows.filter((r: any) => r.reasonCode === 'OTHER').map((r: any) => r.adjustmentNo as string);
    const linked = otherNos.length
      ? await this.prisma.reconciliationDisposition.findMany({
          where: { adjustmentNo: { in: otherNos } }, select: { adjustmentNo: true, otherCause: true },
        })
      : [];
    const otherCauseByNo = new Map<string, string | null>(linked.map((d: any) => [d.adjustmentNo as string, d.otherCause ?? null]));
    return {
      items: rows.map((r: any): AdjustmentListRow => ({
        adjustmentNo: r.adjustmentNo,
        caseNo: r.caseNo,
        ownerNo: r.ownerNo ?? null,
        assetCode: r.assetCode,
        decimals: decimalsByCode.get(r.assetCode) ?? 0,
        reasonCode: r.reasonCode,
        otherCause: otherCauseByNo.get(r.adjustmentNo) ?? null,
        direction: r.direction,
        amount: r.amount,
        status: r.status,
        effectiveDate: r.effectiveDate,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * Task 6: 详情读模型（GET /admin/reconciliation/adjustments/:adjustmentNo）。
   * 铁律⑥ 对外用业务键——排除 id/ownerId/approvalCaseId/walletRef/toWalletRef 与
   * 两个解释锚（explainedFlowId / explainedExternalLineId 是 account_flows /
   * external_statement_lines 的内部 UUID，界面不得展示）；两个 walletRef 各换成
   * walletNo / toWalletNo（同 reconciliation-query.service.ts getCase 的 resolveWalletNo 查法）。
   *
   * ⚠ toWalletRef 是 T6 顺手收的口：Task 5 让它真正落库之后，排除清单还只剔
   * walletRef——改记单一被查询，正主方钱包的内部 UUID 就随返回体吐出去了。
   */
  async getAdjustment(adjustmentNo: string) {
    const row = await this.prisma.reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`Adjustment not found: ${adjustmentNo}`);

    // Task 7（admin 详情页）：decimals 供前端 分→元 缩放显示（T4 canon2 惯例，与
    // getCase 同款查法，前端不得自建 code→名字映射表——见
    // tb-account-codes.constant.ts:38）；分录预览的借/贷助记码由 (book, direction, reasonCode→处置家族)
    // 纯函数推导，不落库、不改行为，复用 onApproved 已经在用的同一对工具函数。
    const assetRow = await this.prisma.asset.findUnique({
      where: { code: row.assetCode }, select: { decimals: true },
    });
    // 第四族走第五种组合。落回 resolvePostingLegs 会把 REATTRIBUTE 当成非 REDUCE
    // 的「增加」，预览显示成「借客户现金 / 贷客户应付」——与真实落账的两腿正相反，
    // 详情页与账本各说各话。改记是四腿（应付对 + 现金对）：主栏位给应付对，现金对另走
    // cashDebitAccountCode / cashCreditAccountCode（详情页多画一行），见 postReattribution。
    const reattribution = row.direction === 'REATTRIBUTE' ? resolveReattributionLegs() : null;
    const legs = reattribution
      ? reattribution.payable
      : resolvePostingLegs(row.book as Book, row.direction as Direction, row.reasonCode as ReasonCode);
    // 凭证证据链接：TransferEvidence 以 32 位十六进制转账号为键，而调账单行上存的是十进制串，
    // 直接拿来拼链接是 404——读面统一换成证据页认的十六进制。现金对的转账号是确定性哈希，
    // 与落账时 executeTransfer 用的是同一个函数、同一组 (sourceType, sourceNo, eventCode)。
    const posted = row.status === AdjustmentStatus.POSTED;

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
    // 成因 = OTHER：详情页把成因打成 `Other · <otherCause>`，名字存在锚中定性行上，现查（只有 OTHER 才查）。
    const otherCause = row.reasonCode === 'OTHER'
      ? ((await this.prisma.reconciliationDisposition.findFirst({ where: { adjustmentNo }, select: { otherCause: true } }))?.otherCause ?? null)
      : null;
    return {
      ...rest,
      otherCause,
      walletNo: await resolveWalletNo(this.prisma, row.walletRef),
      toWalletNo: await resolveWalletNo(this.prisma, row.toWalletRef),
      decimals: assetRow?.decimals ?? 0,
      debitAccountCode: TB_CODE_TO_COA[legs.debitCode] ?? null,
      creditAccountCode: TB_CODE_TO_COA[legs.creditCode] ?? null,
      tbTransferId: row.tbTransferId ? bigintToHex(BigInt(row.tbTransferId)) : null,
      cashDebitAccountCode: reattribution ? (TB_CODE_TO_COA[reattribution.cash.debitCode] ?? null) : null,
      cashCreditAccountCode: reattribution ? (TB_CODE_TO_COA[reattribution.cash.creditCode] ?? null) : null,
      cashTbTransferId: reattribution && posted
        ? bigintToHex(deterministicTransferId(RECON_ADJUSTMENT_SOURCE_TYPE, row.adjustmentNo, RECON_ADJUSTMENT_CASH_EVENT_CODE, 0))
        : null,
    };
  }

  // deciderNo：事件里现成的业务号（handler 侧改取 decisionByUserNo 后新增，
  // 见 adjustment-approval.service.ts）。铁律⑥ 与 createdByUserId 同一惯例——
  // 优先业务号，落不到才退回 deciderId（EXPIRED 路径没有裁决人，deciderId
  // 本身就是 'SYSTEM' 兜底）。不收 deciderRole——本方法不写审计，没有落点，
  // 收了也是死参数。
  async onRejected(adjustmentNo: string, deciderId: string, deciderNo?: string | null) {
    const row = await this.prisma.reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`Adjustment not found: ${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.REJECTED);
    await this.prisma.reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: deciderNo ?? deciderId },
    });
    // 终审修复批 Item 1：驳回/取消/超时（三者都路由到这里，见
    // adjustment-approval.service.ts routeToRejected）清锁——镜像补单路
    // unlinkSupplement 的做法，把该单挂着的定性行 adjustmentNo 清空，行解锁、
    // 按钮组回来（前端已是数据驱动，无需改）。没挂号的调账单（如未走核销/
    // 事故认损挂号路）unlinkAdjustment 内部 no-op。
    await this.dispositions.unlinkAdjustment(adjustmentNo);
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
   * ADJUSTMENT_POST 是单步 CFO 策略（平账 A 批起），审计快照此前记的是一个与
   * 事实不符的角色。
   */
  async onApproved(adjustmentNo: string, deciderId: string, deciderNo?: string | null, deciderRole?: string | null): Promise<void> {
    const row = await this.prisma.reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`Adjustment not found: ${adjustmentNo}`);

    // 第四族改记（spec §6）：分录不由 book × direction 推导，两腿是同一个科目、
    // 不同 ownerUuid。分流在状态闸之前——改记路径自带同一道闸，不重复走。
    if (row.direction === 'REATTRIBUTE') {
      return this.postReattribution(row, deciderId, deciderNo, deciderRole);
    }

    this.assertTransition(row.status, AdjustmentStatus.POSTED);

    // 铁律⑥：对人可见的三个落点（evidence.actorId / decidedByUserId / 审计
    // actorNo·actorDisplayName）一律用它，不直接用 deciderId（JWT UUID）。
    const deciderDisplay = deciderNo ?? deciderId;

    const legs = resolvePostingLegs(row.book as Book, row.direction as Direction, row.reasonCode as ReasonCode);

    // ⚠ ledger 必须按资产的 **currency** 取，不是 assetCode。
    // `TB_LEDGERS` 的键是币种（AED / USDT），而 `reconciliation_cases.assetCode`
    // 存的是 `asset.code`——法币两者恰好同名（AED），加密币不同（code 'USDT-TRON'
    // vs currency 'USDT'）。早先直接拿 assetCode 索引，法币一路绿、**所有加密币
    // 案件必然 ledger=undefined**，resolveTbAccountId 抛 NotFoundException，
    // 而 handler 的异常本仓库现状不外传（PRODUCTION-NOTES 2026-08-28），
    // 于是调账单永远停在 PENDING_APPROVAL、无人被告知。走查时真踩到过。
    // 全仓惯例见 withdraw-workflow.service.ts:471/1158/1662，都是 asset.currency。
    const assetRow = await this.prisma.asset.findUnique({
      where: { code: row.assetCode }, select: { currency: true },
    });
    const ledger = TB_LEDGERS[assetRow?.currency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new NotFoundException(
        `Cannot resolve a ledger for asset ${row.assetCode} (currency=${assetRow?.currency ?? 'asset not found'})`,
      );
    }

    // 科目 → TbAccountRegistry 里的真实归属。客户负债类(CLIENT_PAYABLE/DEPOSIT_SUSPENSE)
    // 按客户 UUID 登记；现金类(CLIENT_CASH/FIRM_CASH)一钱包一户，**只经 resolveCashAccountId 取**
    // （案子钱包 row.walletRef 的现金户，不手拼四元组）；其余（公司权益、收入、开支）按币种
    // 一户、ownerType 'SYSTEM'——见 asset-provisioning.service.ts 与 seed.business.ts 的真实登记调用，
    // 'FIRM' 不是本仓库任何地方登记过的 ownerType，传了会导致 resolveTbAccountId
    // 查不到注册行而抛 NotFoundException（mock 测试若只断言 code 不断言
    // ownerType，这类问题不会被测出来——账户找错了，测试却是绿的）。
    const resolveAccount = (code: number): Promise<bigint> =>
      code === TB_ACCOUNT_CODES.CLIENT_CASH || code === TB_ACCOUNT_CODES.FIRM_CASH
        ? this.accounting.resolveCashAccountId(row.walletRef, ledger)
        : this.accounting.resolveTbAccountId(
          code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE
            ? { code, ledger, ownerType: 'CUSTOMER' as const, ownerUuid: row.ownerId ?? undefined }
            : { code, ledger, ownerType: 'SYSTEM' as const },
        );

    const debitAccountId = await resolveAccount(legs.debitCode);
    const creditAccountId = await resolveAccount(legs.creditCode);

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount: BigInt(row.amount),
      ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: RECON_ADJUSTMENT_SOURCE_TYPE,
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
        // 钱包归属不再靠证据参数传：现金腿的户本身就是案子钱包的现金户，delta 归零靠账户余额。
        // 调账行不出现在任何外部账单上：对账引擎按它记着的两个锚（explainedFlowId / explainedExternalLineId）在匹配器第 0 轮配对，两锚皆空的调账行只进余额、不进匹配，不再靠跨外部标记。
        effectiveDate: row.effectiveDate,
      },
    });

    await this.prisma.reconciliationAdjustment.update({
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
        ownerCustomerNo: row.ownerNo ?? undefined,
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
      },
      {
        actorType: 'ADMIN', actorNo: deciderDisplay, actorDisplayName: deciderDisplay,
        // 真实审批角色取代硬编码 ['ADMIN']——RECON_ADJUSTMENT_POST 是单步
        // CFO 策略（平账 A 批起），硬编码会让审计记下一个与事实不符的角色快照。
        // 兜底 'ADMIN' 只在旧签名两参调用（deciderRole 缺省）时触发，与此前
        // 行为等价，不影响既有单测。
        actorRolesAtTime: [deciderRole ?? 'ADMIN'],
      },
    );
  }

  /**
   * 第四族落账（spec §6 + 戊波一总纲 §4 岔口 6）：一张凭证、两笔码 80、四条腿。
   *   应付对：借 错记方应付 / 贷 正主方应付（同科目 CLIENT_PAYABLE、不同 ownerUuid——负债换主人）；
   *   现金对：借 现金·正主方钱包（row.toWalletRef）/ 贷 现金·错记方钱包（row.walletRef）
   *     （每客户一钱包，「记错人」就是「记错钱包」：钱实际在正主的钱包里，账却记在错记方的现金户上；
   *     只转应付不挪现金，两案永远不自愈，正主的应付还会比他的现金多）。
   * 两对落完，两个钱包的差额同时归零，重对账时两个案子一起自愈。
   *
   * 两笔转账的 TB 转账号由 (sourceType, sourceNo, eventCode) 决定——第二笔必须换 eventCode，
   * 否则两笔会撞同一个转账号（账户不同，TB 直接拒）。
   *
   * 落账路径上的坑与 onApproved 主路径同源（那边的行内注释逐条论证过成因与
   * 事故现场，这里不重复誊，只标出三个必须照办的点）：
   *   ① ledger 按 asset.**currency** 取，不是 assetCode（USDT-TRON vs USDT）；
   *   ② CLIENT_PAYABLE 在 TbAccountRegistry 里按客户 UUID 登记 → ownerType 必须
   *      是 'CUSTOMER' 并带 ownerUuid；现金户一钱包一户，只经 resolveCashAccountId 取；
   *   ③ evidence.assetCurrency 同样是 currency，传 code 会让加密币分录在按币种
   *      筛选时从列表里消失。
   */
  private async postReattribution(row: any, deciderId: string, deciderNo?: string | null, deciderRole?: string | null): Promise<void> {
    this.assertTransition(row.status, AdjustmentStatus.POSTED);
    const deciderDisplay = deciderNo ?? deciderId;

    const assetRow = await this.prisma.asset.findUnique({
      where: { code: row.assetCode }, select: { currency: true },
    });
    const ledger = TB_LEDGERS[assetRow?.currency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new NotFoundException(
        `Cannot resolve a ledger for asset ${row.assetCode} (currency=${assetRow?.currency ?? 'asset not found'})`,
      );
    }

    // 正主方单上只有业务号（铁律⑥ 落库口径），落账要 UUID 才定位得到它的负债户。
    const toOwner = row.toOwnerNo
      ? await this.prisma.customerMain.findUnique({ where: { customerNo: row.toOwnerNo }, select: { id: true } })
      : null;
    if (!row.ownerId || !toOwner?.id) {
      throw new NotFoundException(
        `Failed to resolve both sides of the reattribution (misattributed owner ownerId=${row.ownerId ?? 'empty'}, rightful owner toOwnerNo=${row.toOwnerNo ?? 'empty'})`,
      );
    }

    const legs = resolveReattributionLegs();
    const debitAccountId = await this.accounting.resolveTbAccountId({ code: legs.payable.debitCode, ledger, ownerType: 'CUSTOMER', ownerUuid: row.ownerId });
    const creditAccountId = await this.accounting.resolveTbAccountId({ code: legs.payable.creditCode, ledger, ownerType: 'CUSTOMER', ownerUuid: toOwner.id });
    const cashDebitAccountId = await this.accounting.resolveCashAccountId(row.toWalletRef, ledger);
    const cashCreditAccountId = await this.accounting.resolveCashAccountId(row.walletRef, ledger);

    const evidenceBase = {
      sourceType: RECON_ADJUSTMENT_SOURCE_TYPE,
      sourceNo: row.adjustmentNo,
      traceId: row.traceId || row.adjustmentNo,
      assetCurrency: assetRow?.currency ?? row.assetCode,
      actorType: 'ADMIN' as const,
      actorId: deciderDisplay,
      effectiveDate: row.effectiveDate,
    };

    // 应付对：错记方降、正主方升。
    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount: BigInt(row.amount),
      ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        ...evidenceBase,
        eventCode: 'RECON_ADJUSTMENT_POSTED',
        debitCode: TB_CODE_TO_COA[legs.payable.debitCode],
        creditCode: TB_CODE_TO_COA[legs.payable.creditCode],
        memo: row.reasonInternal,
      },
    });

    // 现金对：钱在正主的钱包里——正主钱包现金升、错记方钱包现金降，两钱包各自的差额才同时归零。
    await this.accounting.executeTransfer({
      debitAccountId: cashDebitAccountId,
      creditAccountId: cashCreditAccountId,
      amount: BigInt(row.amount),
      ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        ...evidenceBase,
        eventCode: RECON_ADJUSTMENT_CASH_EVENT_CODE,
        debitCode: TB_CODE_TO_COA[legs.cash.debitCode],
        creditCode: TB_CODE_TO_COA[legs.cash.creditCode],
        memo: `${row.reasonInternal} (cash reattribution)`,
      },
    });

    await this.prisma.reconciliationAdjustment.update({
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
      },
      {
        actorType: 'ADMIN', actorNo: deciderDisplay, actorDisplayName: deciderDisplay,
        actorRolesAtTime: [deciderRole ?? 'ADMIN'],
      },
    );
  }
}
