import { Injectable } from '@nestjs/common';
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
   * 写入侧唯一入口。传 action 写入软线待办；传 null 清空（硬线 / 无动作可做，
   * 也用于覆盖客户此前可能留下的软线待办 —— 防止一次更严重的后续裁决被旧的
   * 软线入口盖不住）。本方法只管落库，不做任何是否暴露的判断；重复调用同一
   * customerId 只是覆盖写同一行的两个标量列，天然幂等，webhook 重投/人工重放
   * 安全。
   */
  async set(
    customerId: string,
    action: CustomerPendingAction | null,
  ): Promise<void> {
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        pendingActionExternalId: action?.externalActionId ?? null,
        pendingActionReason: action?.reason ?? null,
      },
    });
  }
}
