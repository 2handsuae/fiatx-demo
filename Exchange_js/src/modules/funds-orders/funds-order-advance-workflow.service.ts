import { Injectable } from '@nestjs/common';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditActorContext } from '../audit-logging/dto/audit-log.dto';
import { FundsOrderAction } from './dto/funds-order.dto';
import { FundsOrderService } from './funds-order.service';

/**
 * 资金单模拟推进的编排层。
 *
 * 建这一层的唯一理由是「审计写入不落在 controller」：原先
 * `funds-orders.admin.controller.ts` 直接调 recordByActor，是本仓库
 * 唯一一处 controller 直写审计的违规（AUDIT_LOG_QUERIED 是仅有的许可例外）。
 * 读前态 → 推进 → 记审计 三步在这里成为一个整体，controller 退回纯入口。
 *
 * 动作码 FUNDS_ORDER_ADVANCED 属交易域老码，不在第一批 V1 词表内 ——
 * 本次只搬位置，码与字段语义逐字保持原样（业主 2026-08-25 裁定：
 * 交易域记录内容留给各域自己的任务）。
 */
@Injectable()
export class FundsOrderAdvanceWorkflowService {
  constructor(
    private readonly fundsOrders: FundsOrderService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async advance(
    fundsOrderNo: string,
    action: FundsOrderAction,
    actor: AuditActorContext,
  ) {
    const before = await this.fundsOrders.findOneByNoForAdmin(fundsOrderNo);
    const updated = await this.fundsOrders.advanceByNo(
      fundsOrderNo,
      action,
      actor.actorNo,
    );

    await this.auditLogs.recordByActor(
      {
        action: AuditActions.FUNDS_ORDER_ADVANCED,
        primarySubjectType: AuditEntityTypes.INTERNAL_FUND,
        primarySubjectNo: fundsOrderNo,
        reason: `Sim advance ${action}: ${before.status} → ${updated.status}`,
        metadata: {
          fundsOrderNo,
          action,
          fromStatus: before.status,
          toStatus: updated.status,
        },
        sourcePlatform: 'ADMIN',
      },
      actor,
    );

    return updated;
  }
}
