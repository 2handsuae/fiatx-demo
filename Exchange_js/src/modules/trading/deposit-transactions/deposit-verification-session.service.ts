import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositTransactionStatus } from './dto/deposit-transaction.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { SumsubClient } from '../../identity/onboarding/providers/sumsub/sumsub.client';

/** 补料 action 走的验证等级。真接 Sumsub 时按租户配置调整。 */
const SUMSUB_ACTION_LEVEL = 'basic-kyc-level';

/**
 * 客户面能看到的全部内容。**只有这两个键。**
 *
 * **不含 action id（上一轮的 Critical，勿加回来）**：demo fixture 的
 * `applicantActionId` 本身携带信息——PEP 场景是 `aa-edd-0002`、非 PEP 是
 * `aa-sof-0001`。客户开 DevTools 看 `edd`（enhanced due diligence）就能
 * 反推 PEP 判定。前端不需要它：定位一条 action 用 `seq`，服务端自己查表
 * 换真 id 去铸 token。
 *
 * **不含 materialKind**：`manualReason` 值域只有两个值，映射成两个
 * materialKind 是双射，"是不是 PEP" 这 1 比特被无损保留，等于没脱敏。
 * 客户要交什么由验证组件自己告诉他。
 */
export interface VerificationSessionView {
  submitted: boolean;
  sdkToken: string | null;
}

/** 客户提交后重新计时的窗口，与 ACTION_SLA_DAYS 同为 7 天（换语义不换数字） */
const PROVIDER_REVIEW_SLA_DAYS = 7;

/**
 * 充值补料会话。**本服务是"接口层不可区分规则"的唯一实现处。**
 *
 * 渲染层已经把 FROZEN/SEIZING/SEIZED/MANUAL_CHECKING 收敛成与正常处理
 * 逐字段一致（见 client-web/src/utils/depositStatusView.ts）。但新增端点
 * 本身是一个新的可观测面：若它对 ACTION_PENDING 返 200、对 FROZEN 返 404，
 * 客户开 DevTools 就能直接问出自己那单是不是被冻了，渲染层防线归零。
 *
 * 故：响应体只由 `actionSubmittedAt` 决定，**绝不由 status 决定**。
 */
@Injectable()
export class DepositVerificationSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applicantActions: DepositApplicantActionsService,
    private readonly auditLogs: AuditLogsService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  /**
   * `limitHoldReason: null`（评审 Important 1）：客户面既有的两条口子
   * （`findAll` 的 customerScope、`findOneForCustomer`）都把 BELOW_MIN
   * 隐藏单当作不存在处理，这里必须对齐——否则本端点对隐藏单返 200、对真
   * 不存在的单返 404，客户能借此探出"我有一笔列表里看不到的单"，而
   * 单号 `DEP+YYMMDD+4位随机` 一天空间只有 1 万、又没有限流，枚举成本很低。
   *
   * `select`（评审 Minor）：只取两个业务方法真正用到的列，不把
   * `statusHistory` 之外的 investigation-only 字段整行带进内存。`manualReason`
   * 同理不选——本 service 从此完全不读它（见 `VerificationSessionView` 头部
   * 注释：materialKind 已删，manualReason 没有别的用途）。
   */
  private async mustFindOwn(customerId: string, depositNo: string) {
    const row = await (this.prisma as any).depositTransaction.findFirst({
      where: { depositNo, ownerId: customerId, limitHoldReason: null },
      select: {
        id: true, depositNo: true, ownerType: true, ownerId: true,
        traceId: true, status: true, slaBreached: true,
        customer: { select: { sumsubApplicantId: true } },
      },
    });
    if (!row) throw new NotFoundException('Deposit not found');
    return row;
  }

  /**
   * 响应体只由**这一条 action** 的 submittedAt 决定，绝不由充值单 status 决定。
   * seq 不存在时抛与「单子不存在」完全相同的 404——不给新的探测面。
   */
  async getSession(
    customerId: string,
    depositNo: string,
    seq: number,
  ): Promise<VerificationSessionView> {
    const row = await this.mustFindOwn(customerId, depositNo);
    const action = await this.applicantActions.findBySeq(row.id, seq);
    if (!action) throw new NotFoundException('Deposit not found');

    if (action.submittedAt) return { submitted: true, sdkToken: null };

    // applicantId 必须是**客户的** sumsubApplicantId，不是充值单 id。
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
  async submit(customerId: string, depositNo: string, seq: number): Promise<{ ok: true }> {
    const row = await this.mustFindOwn(customerId, depositNo);
    const action = await this.applicantActions.findBySeq(row.id, seq);
    if (!action) throw new NotFoundException('Deposit not found');

    const deadline = new Date(Date.now() + PROVIDER_REVIEW_SLA_DAYS * 24 * 60 * 60 * 1000);
    const resetSla =
      row.status === DepositTransactionStatus.ACTION_PENDING && !row.slaBreached;

    const { changed, allSubmitted } = await this.applicantActions.submitBySeq(
      row.id, seq, deadline, resetSla,
    );

    if (changed) {
      await this.auditLogs.recordByActor(
        {
          action: AuditActions.DEPOSIT_ACTION_SUBMITTED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: row.id,
          entityNo: row.depositNo,
          entityOwnerType: row.ownerType,
          entityOwnerId: row.ownerId,
          traceId: row.traceId || undefined,
          workflowType: 'DEPOSIT',
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
