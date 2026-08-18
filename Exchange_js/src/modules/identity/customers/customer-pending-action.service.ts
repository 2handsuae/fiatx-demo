import { Injectable } from '@nestjs/common';
import { CustomerMain } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';

export interface CustomerPendingAction {
  externalActionId: string;
  reason: string;
  /** 客户提交补料材料的时刻；null = 尚未提交（banner 三态用） */
  submittedAt: Date | null;
}

/**
 * 补料 action 走的验证等级。⚠️ 占位，与充值/提现同款常量注释——真接前必须改，
 * 已登记 BACKLOG（deposit-verification-session.service.ts 同名常量）。
 */
const SUMSUB_ACTION_LEVEL = process.env.SUMSUB_ACTION_LEVEL || 'wave3-level-1';

/**
 * 客户面能看到的全部内容。**只有这两个键。** 与充值/提现的
 * VerificationSessionView 逐字同形——不含 action id / reason，服务端凭 JWT
 * 自己查表换真 id 铸 token，客户端从头到尾拿不到 Sumsub 侧标识。
 */
export interface VerificationSessionView {
  submitted: boolean;
  sdkToken: string | null;
}

/**
 * 客户「待办事项」读写唯一入口 —— 承接 Sumsub KYT 拒绝后的 tipping-off 判断。
 *
 * 写入侧（swap-workflow 的 handleRejectDisposition）已经做完软硬线判断：只有
 * 客户确实有补料动作可做、且不涉及制裁调查时，才会调用 set() 写入非 null 值；
 * 制裁命中或无动作可做则写 null。
 *
 * get() 只把 CustomerMain 的两个字段原样拼成对象返回或 null —— **不重新判断
 * 「要不要告诉客户」**。这条判断只能活在写入侧一处：读侧一旦也长出条件分支，
 * 两处判断迟早会分叉，而分叉的失败模式是客户被告知了制裁调查（tipping-off，
 * 多数 AML 法域下是刑事犯罪）。
 */
@Injectable()
export class CustomerPendingActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  async get(customerId: string): Promise<CustomerPendingAction | null> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer?.pendingActionExternalId || !customer?.pendingActionReason) {
      return null;
    }
    return {
      externalActionId: customer.pendingActionExternalId,
      reason: customer.pendingActionReason,
      submittedAt: (customer as any).pendingActionSubmittedAt ?? null,
    };
  }

  /**
   * 客户级补料会话（parity 2026-08-14）—— mirror of
   * WithdrawVerificationSessionService.getSession，锚点从「订单+seq」换成
   * 「客户单槽 pendingActionExternalId」。
   *
   * **接口层不可区分规则**（与充值/提现逐字同源）：无待办 / 无 applicantId /
   * 已提交 三种情况响应逐字节一致 `{submitted:true, sdkToken:null}`——
   * 客户端（乃至开 DevTools 的客户）无法据此区分自己处于哪种状态，
   * 不给冻结/判定任何新的探测面。
   */
  async getVerificationSession(customerId: string): Promise<VerificationSessionView> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    const externalActionId = customer?.pendingActionExternalId ?? null;
    const applicantId = customer?.sumsubApplicantId ?? null;
    const submittedAt = (customer as any)?.pendingActionSubmittedAt ?? null;
    if (!externalActionId || !applicantId || submittedAt) {
      return { submitted: true, sdkToken: null };
    }
    const { token } = await this.sumsubClient.createActionSdkToken({
      applicantId,
      levelName: SUMSUB_ACTION_LEVEL,
      externalActionId,
    });
    return { submitted: false, sdkToken: token };
  }

  /**
   * 客户提交回执（parity 2026-08-14）。幂等恒成功：write-once 条件更新
   * （仅 submittedAt 仍为 null 时落章），重复提交/无待办时静默通过——
   * 与充值/提现 submit 端点同款"恒 2xx、不吐状态机信息"姿态。
   * 审计只随首个真实提交写一条（SWAP_ACTION_SUBMITTED）。
   */
  async submitVerification(
    customerId: string,
    actor: { actorId: string; actorNo?: string },
  ): Promise<void> {
    const res = await this.prisma.customerMain.updateMany({
      where: { id: customerId, pendingActionSubmittedAt: null, pendingActionExternalId: { not: null } } as any,
      data: { pendingActionSubmittedAt: new Date() } as any,
    });
    if (res.count > 0) {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: customerId },
        select: { customerNo: true } as any,
      });
      await this.auditLogs.recordByActor(
        {
          action: AuditActions.SWAP_ACTION_SUBMITTED,
          entityType: AuditEntityTypes.CUSTOMER,
          entityId: customerId,
          entityNo: (customer as any)?.customerNo || undefined,
          result: AuditResult.SUCCESS,
          reason: 'Customer submitted pending verification action',
        },
        {
          actorType: 'CUSTOMER',
          actorId: actor.actorId,
          actorNo: actor.actorNo,
          actorRole: 'CUSTOMER',
        },
      );
    }
  }

  /**
   * RED 复审失败后的重试口（Task 13 handler 消费）：清掉提交章、保留指针——
   * Sumsub 的 RETRY 复审走同一个 action id，客户可再次进入认证页重交。
   */
  async resetSubmission(customerId: string): Promise<void> {
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { pendingActionSubmittedAt: null } as any,
    });
  }

  /**
   * Review Fix 2（终审）：sticky 硬线标记的读侧 —— 一旦客户被任意一笔 swap
   * 硬线处置过（含制裁），这里恒为 true，且没有清除入口。写入侧
   * （swap-workflow 的 handleRejectDisposition）在决定要不要暴露
   * pendingAction 之前必须先查这个，防止同一客户名下另一笔 swap 的软线裁决
   * 把已经沉默掉的入口重新打开。跟 get() 一样是哑读——不做判断，只报告事实。
   */
  async hasHardLineDisposition(customerId: string): Promise<boolean> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    return !!customer?.hardLineDispositionedAt;
  }

  /**
   * 2026-08-17 材料请求账（Task 10）：从 set(customerId, action, markHardLine)
   * 抽出的独立方法——兑换域不再写 pendingAction* 三列，但 sticky 硬线章仍然要
   * 盖，且逻辑原样保留（write-once：已经盖过章的客户不再重新盖）。
   *
   * 盖 sticky 硬线章。一旦盖上，这个客户后续任何软线裁决都不再暴露补料入口。
   * 只在命中制裁时盖 —— 「无 action 的硬线」不该造成永久沉默（终审 Finding 3）。
   */
  async markHardLineDisposition(customerId: string): Promise<void> {
    const existing = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    if (existing?.hardLineDispositionedAt) return;
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { hardLineDispositionedAt: new Date() },
    });
  }

  /**
   * Task 13：applicantActionReviewed webhook 认领入口。webhook 携带
   * externalActionId；按 pendingActionExternalId 反查客户，是 set() 写入侧的
   * 反向查询。查不到返回 null——调用方（SwapApplicantActionHandler）据此判断
   * 这个 action 不属于 swap 域，把级联交还给下一个域，而不是当错误处理。
   *
   * 不做唯一性假设：该列只建了 @@index，没有 @@unique（理论上两个客户的软线
   * 待办不该撞同一个 externalActionId，但没有 DB 约束兜底）——findFirst 而非
   * findUnique，与 SwapTransactionsService.findBySumsubTxnId 同款写法。
   */
  async findByExternalActionId(externalActionId: string): Promise<CustomerMain | null> {
    return this.prisma.customerMain.findFirst({
      where: { pendingActionExternalId: externalActionId },
    });
  }

  /**
   * 写入侧唯一入口。传 action 写入软线待办；传 null 清空（硬线 / 无动作可做，
   * 也用于覆盖客户此前可能留下的软线待办 —— 防止一次更严重的后续裁决被旧的
   * 软线入口盖不住）。本方法只管落库，不做任何是否暴露的判断；重复调用同一
   * customerId 只是覆盖写同一行的两个标量列，天然幂等，webhook 重投/人工重放
   * 安全。
   *
   * markHardLine（Review Fix 2）：调用方告知"这次裁决本身是硬线"时才为
   * true，本方法据此额外盖章 hardLineDispositionedAt——同样只是记录调用方
   * 已经做完的判断，不在这里重新推导。sticky：只会被置真，本方法不提供清除
   * 入口。
   *
   * Finding 4（Minor，终审）：write-once —— 这个时间戳要记的是"客户第一次被
   * 硬线沉默"的时刻，不是"最近一次硬线裁决"。webhook 重投或同一客户后续又
   * 命中一次硬线，都不能把它推后：markHardLine 为真时先查一次现状，只有从未
   * 盖过章才写当次时间；已经盖过的直接跳过（不写、不覆盖）。
   */
  async set(
    customerId: string,
    action: CustomerPendingAction | null,
    markHardLine = false,
  ): Promise<void> {
    let hardLineDispositionPatch: { hardLineDispositionedAt?: Date } = {};
    if (markHardLine) {
      const existing = await this.prisma.customerMain.findUnique({
        where: { id: customerId },
        select: { hardLineDispositionedAt: true },
      });
      if (!existing?.hardLineDispositionedAt) {
        hardLineDispositionPatch = { hardLineDispositionedAt: new Date() };
      }
    }
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        pendingActionExternalId: action?.externalActionId ?? null,
        pendingActionReason: action?.reason ?? null,
        // 指针换代/清空时提交章一并归零：新待办=尚未提交；清空=无事可提交。
        pendingActionSubmittedAt: null,
        ...hardLineDispositionPatch,
      } as any,
    });
  }
}
