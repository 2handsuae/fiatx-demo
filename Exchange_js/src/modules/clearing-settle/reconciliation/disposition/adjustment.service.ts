// 一期调账单（spec v2）。开单只落库；落账在审批通过后（Task 5）。
// 本期无订单层、无资金单、无真实转账——不许顺手给它建资金单。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateReferenceNo } from '../../../../common/utils/no-generator.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../../governance/approvals/approvals.service';
import { AccountingService } from '../../../accounting/tigerbeetle/accounting.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { ADJUSTMENT_TRANSITIONS, AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { CreateAdjustmentDto } from '../dto/adjustment.dto';
import {
  Book, Direction, ReasonCode, REASON_SPECS,
  assertReasonAllowed, requiresRelatedOrder,
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

  /** 审批页文案：把后果展开成一句人话。审批看不见后果就是橡皮图章。 */
  describeImpact(row: {
    book: string; ownerNo: string | null; amount: string; assetCode: string;
    direction: string; reasonCode: string; reasonInternal: string;
  }): string {
    const dir = row.direction === 'REDUCE' ? '减少' : '增加';
    const who = row.book === 'CLIENT' ? `客户 ${row.ownerNo ?? '(未知)'}` : '公司自有资金';
    return `本单将使${who}余额${dir} ${row.amount}（最小单位）${row.assetCode}；`
         + `成因：${row.reasonCode}；理由：${row.reasonInternal}`;
  }

  async createDraft(dto: CreateAdjustmentDto, operatorId: string) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${dto.caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('只能对打开中的案件开调账单');

    const book: Book = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    const direction = dto.direction as Direction;

    // 闸一：成因 × 账簿 × 方向 合法性
    assertReasonAllowed(dto.reasonCode as ReasonCode, book, direction);

    // 闸二：§4 边界线——客户账簿加钱必须指向一张已存在的原单
    if (requiresRelatedOrder(book, direction) && !dto.relatedOrderNo?.trim()) {
      throw new BadRequestException(
        '客户账簿加钱必须指明关联原单号——无原单即凭空给客户加钱，会绕过 KYT 与合规闸；'
        + '若为未归属入金，请走充值域补录入站信号。',
      );
    }

    // 落账时 resolveTbAccountId 要客户 UUID，case 上只有业务号，这里换一次。
    const owner = kase.ownerNo
      ? await (this.prisma as any).customer.findUnique({ where: { customerNo: kase.ownerNo }, select: { id: true } })
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
        createdByUserId: operatorId,
        status: AdjustmentStatus.DRAFT,
      },
    });
    return { adjustmentNo: row.adjustmentNo };
  }

  async submit(adjustmentNo: string, operatorId: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.PENDING_APPROVAL);

    // 真实签名：createAndSubmit(createDto, submitDto, actor, client?, options?)
    //   CreateApprovalDto = { actionType, entityRef, objectSnapshot?, traceId? }
    //   SubmitApprovalDto = { reason?, traceId? }
    //   ApprovalActorContext = { actorType: 'ADMIN', userId, userNo?, role?, roleCodes }
    const impact = this.describeImpact(row);
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
      { actorType: 'ADMIN', userId: operatorId, userNo: operatorId, roleCodes: ['ADMIN'] },
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

  async onRejected(adjustmentNo: string, deciderId: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.REJECTED);
    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: deciderId },
    });
  }

  // Task 5 落账；本任务只留桩——批准与落账之间不许加第二个人工环节，
  // 但落账逻辑本身（记账 + 状态迁移）不属于 Task 4 范围。
  async onApproved(adjustmentNo: string, deciderId: string): Promise<void> {
    throw new Error('Task 5 实现');
  }
}
