import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WithdrawTransactionStatus } from './dto/withdraw-transaction.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { WithdrawApplicantActionsService } from './withdraw-applicant-actions.service';
import { SumsubClient } from '../../identity/onboarding/providers/sumsub/sumsub.client';

/**
 * 补料 action 走的验证等级。
 * ⚠️ 占位，与充值同款：见 deposit-verification-session.service.ts 头部同名
 * 常量注释——真接前必须改，已登记 BACKLOG。
 */
const SUMSUB_ACTION_LEVEL = process.env.SUMSUB_ACTION_LEVEL || 'wave3-level-1';

/**
 * 客户面能看到的全部内容。**只有这两个键。**
 * 不含 action id / manualReason——理由与 deposit-verification-session
 * .service.ts 的同名接口逐字相同（seq 定位，服务端自己查表换真 id 铸 token）。
 */
export interface VerificationSessionView {
  submitted: boolean;
  sdkToken: string | null;
}

/** 客户提交后重新计时的窗口，与 ACTION_SLA_DAYS 同为 7 天（换语义不换数字） */
const PROVIDER_REVIEW_SLA_DAYS = 7;

/**
 * 提现补料会话。mirrors DepositVerificationSessionService——**本服务是提现侧
 * "接口层不可区分规则"的唯一实现处**：响应体只由 `actionSubmittedAt` 决定，
 * 绝不由 status 决定（FROZEN 与 ACTION_PENDING 下同一条 action 必须逐字段
 * 全等，否则客户开 DevTools 就能问出自己那单是不是被冻了）。
 */
@Injectable()
export class WithdrawVerificationSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applicantActions: WithdrawApplicantActionsService,
    private readonly auditLogs: AuditLogsService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  /**
   * 提现无 BELOW_MIN 隐藏单——`WithdrawTransaction` 没有 `limitHoldReason`
   * 列，故 where 条件不带该项，这是与充值 mustFindOwn 唯一的差异点。
   * IDOR 与「单号不存在」共用同一句 404，不给新的探测面。
   */
  private async mustFindOwn(customerId: string, withdrawNo: string) {
    const row = await (this.prisma as any).withdrawTransaction.findFirst({
      where: { withdrawNo, ownerId: customerId },
      select: {
        id: true, withdrawNo: true, ownerType: true, ownerId: true,
        traceId: true, status: true, slaBreached: true,
        customer: { select: { sumsubApplicantId: true } },
      },
    });
    if (!row) throw new NotFoundException('Withdraw transaction not found');
    return row;
  }

  /**
   * 响应体只由**这一条 action** 的 submittedAt 决定，绝不由提现单 status 决定。
   * seq 不存在时抛与「单子不存在」完全相同的 404。
   */
  async getSession(
    customerId: string,
    withdrawNo: string,
    seq: number,
  ): Promise<VerificationSessionView> {
    const row = await this.mustFindOwn(customerId, withdrawNo);
    const action = await this.applicantActions.findBySeq(row.id, seq);
    if (!action) throw new NotFoundException('Withdraw transaction not found');

    if (action.submittedAt) return { submitted: true, sdkToken: null };

    // applicantId 必须是**客户的** sumsubApplicantId，不是提现单 id。
    const applicantId = row.customer?.sumsubApplicantId;
    if (!applicantId) return { submitted: false, sdkToken: null };

    const { token } = await this.sumsubClient.createActionSdkToken({
      applicantId,
      levelName: SUMSUB_ACTION_LEVEL,
      externalActionId: action.externalActionId,
    });
    return { submitted: false, sdkToken: token };
  }

  /** 幂等、恒 2xx、不碰状态机。冻结单上提交照收——返错误码等于告诉对方"你这单不一样了"。 */
  async submit(customerId: string, withdrawNo: string, seq: number): Promise<{ ok: true }> {
    const row = await this.mustFindOwn(customerId, withdrawNo);
    const action = await this.applicantActions.findBySeq(row.id, seq);
    if (!action) throw new NotFoundException('Withdraw transaction not found');

    const deadline = new Date(Date.now() + PROVIDER_REVIEW_SLA_DAYS * 24 * 60 * 60 * 1000);
    const resetSla =
      row.status === WithdrawTransactionStatus.ACTION_PENDING && !row.slaBreached;

    const { changed, allSubmitted } = await this.applicantActions.submitBySeq(
      row.id, seq, deadline, resetSla,
    );

    if (changed) {
      await this.auditLogs.recordByActor(
        {
          action: AuditActions.WITHDRAW_ACTION_SUBMITTED,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: row.id,
          entityNo: row.withdrawNo,
          entityOwnerType: row.ownerType,
          entityOwnerId: row.ownerId,
          traceId: row.traceId || undefined,
          workflowType: 'WITHDRAW',
          reason: allSubmitted
            ? 'Customer submitted the last outstanding applicant action; all materials received'
            : 'Customer submitted one applicant action; others still outstanding',
          metadata: {
            seq,
            // 审计是 operator 面，必须带真 id 否则对不上 Sumsub 后台。
            // 与客户面正好相反——别看混。
            actionId: action.applicantActionId,
            allSubmitted,
            ...(allSubmitted && resetSla && { slaDeadline: deadline }),
          },
          sourcePlatform: 'CUSTOMER_API',
        },
        { actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER' },
      );
    }
    return { ok: true };
  }
}
