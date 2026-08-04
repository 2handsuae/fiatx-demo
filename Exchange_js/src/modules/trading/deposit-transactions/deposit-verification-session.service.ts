import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';

export type MaterialKind = 'SOURCE_OF_FUNDS' | 'SUPPORTING_DOCUMENTS';

export interface VerificationSessionView {
  submitted: boolean;
  embedUrl: string | null;
  materialKind: MaterialKind | null;
  actionId: string | null;
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
    private readonly deposits: DepositTransactionsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async mustFindOwn(customerId: string, depositNo: string) {
    const row = await (this.prisma as any).depositTransaction.findFirst({
      where: { depositNo, ownerId: customerId },
    });
    if (!row) throw new NotFoundException('Deposit not found');
    return row;
  }

  /**
   * manualReason → 中性材料类型。**manualReason 本身绝不下发**：它取值
   * EDD_PEP 时等同于告诉客户"你被判定为 PEP"。
   */
  private materialKindOf(manualReason: string | null): MaterialKind {
    return manualReason === 'EDD_PEP' ? 'SUPPORTING_DOCUMENTS' : 'SOURCE_OF_FUNDS';
  }

  async getSession(customerId: string, depositNo: string): Promise<VerificationSessionView> {
    const row = await this.mustFindOwn(customerId, depositNo);

    // 已提交：无论此刻是 ACTION_PENDING 还是已被冻，一律同一个响应体。
    if (row.actionSubmittedAt) {
      return { submitted: true, embedUrl: null, materialKind: null, actionId: null };
    }

    if (!row.sumsubActionId) {
      return { submitted: false, embedUrl: null, materialKind: null, actionId: null };
    }

    return {
      submitted: false,
      embedUrl: `/mock-verification?deposit=${encodeURIComponent(row.depositNo)}`,
      materialKind: this.materialKindOf(row.manualReason),
      actionId: row.sumsubActionId,
    };
  }

  /**
   * 客户提交。幂等、恒 200、不碰状态机。
   * 冻结单上提交照收——收下不做事，好过返错误码告诉对方"你这单不一样了"。
   *
   * 审计：CLAUDE.md 铁律 1「有持久状态、operator 可见操作 → 必须写
   * AuditLogsService」。本操作既改持久状态（actionSubmittedAt / slaDeadline），
   * 又对 operator 可见（admin 详情有 Customer submitted at 一行），故必须落审计。
   * 只在**真正落库那一次**记（`changed === true`），幂等的重复提交不刷屏。
   */
  async submit(customerId: string, depositNo: string): Promise<{ ok: true }> {
    const row = await this.mustFindOwn(customerId, depositNo);
    if (row.sumsubActionId) {
      const deadline = new Date(
        Date.now() + PROVIDER_REVIEW_SLA_DAYS * 24 * 60 * 60 * 1000,
      );
      const { changed } = await this.deposits.markActionSubmitted(row.id, deadline);
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
            reason:
              'Customer submitted applicant-action materials; SLA clock switched to provider re-review',
            metadata: {
              actionId: row.sumsubActionId,
              slaDeadline: deadline,
              waitingOn: 'PROVIDER',
            },
            sourcePlatform: 'CUSTOMER_API',
          },
          { actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER' },
        );
      }
    }
    return { ok: true };
  }
}
