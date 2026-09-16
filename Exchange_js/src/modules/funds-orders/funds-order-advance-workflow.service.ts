import { randomUUID } from 'node:crypto';
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
 * 动作码 FUNDS_ORDER_ADVANCED 站7 收编入 V1 CONFIG 域（平台运营件——
 * ⚡模拟推进是演示工装不是交易域业务动作）；从/到落顶层列，主对象类型
 * 随表更名换 FUNDS_ORDER。
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
        actionDomain: 'CONFIG',
        primarySubjectType: AuditEntityTypes.FUNDS_ORDER,
        primarySubjectNo: fundsOrderNo,
        subjects: [
          { subjectType: AuditEntityTypes.FUNDS_ORDER, subjectNo: fundsOrderNo, subjectRole: 'PRIMARY' },
        ],
        fromStatus: before.status,
        toStatus: updated.status,
        requestId: `FUNDS_ORDER_ADVANCED_${fundsOrderNo}_${randomUUID()}`,
        reason: `Sim advance ${action}: ${before.status} → ${updated.status}`,
        metadata: {
          fundsOrderNo,
          action,
          fromStatus: before.status,
          toStatus: updated.status,
        },
        sourcePlatform: 'ADMIN',
      } as any,
      actor,
    );

    return updated;
  }
}
