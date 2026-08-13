import { Injectable } from '@nestjs/common';
import { CustomerMain } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface CustomerPendingAction {
  externalActionId: string;
  reason: string;
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
  constructor(private readonly prisma: PrismaService) {}

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
    };
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
        ...hardLineDispositionPatch,
      },
    });
  }
}
