import { Injectable, Logger } from '@nestjs/common';
import { CustomerPendingActionService } from '../identity/customers/customer-pending-action.service';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../audit-logging/dto/audit-log.dto';

/**
 * Task 13（计划缺口补录，2026-08-13）：spec §6 承诺的豁免闭环 —— 客户完成
 * Sumsub 补料动作（source-of-funds / liveness 等）后，若复核 GREEN，应解除
 * Task 7 handleRejectDisposition 施加的 SWAP/WITHDRAW 限制。原 12 个任务都没
 * 建这个消费者：`applicantActionReviewed` 不在 KYT_VERDICT_TYPES 里，
 * ingestion 的通用分流只认 MaterialRefreshCycle 的 actionId（另一个域），
 * `CustomerRestrictionsService.clear()` 至今零调用方 —— 本 handler 是它的
 * 第一个调用方。
 *
 * ⚠️ 硬线客户不得因完成某个 action 而解锁。Task 7 的
 * `hardLineDispositionedAt` sticky marker 一旦非空即制裁线 —— 哪怕这次
 * action 复核是 GREEN，也只清 pendingAction 指针（这次 action 本身走完了），
 * 绝不调用 restrictionsService.clear()，并写一条专属审计说明为何限制被保留，
 * 供调查员核实"GREEN 到过，但被刻意没有解锁"。这是 sticky marker 存在的唯一
 * 意义，此处绝不能绕过（否则一个被制裁客户能靠完成一次普通认证动作自我解锁）。
 *
 * 认领方式：webhook 携带 externalActionId；Task 7 的 handleRejectDisposition
 * 已把它写在 CustomerMain.pendingActionExternalId 上。按该列反查客户
 * （CustomerPendingActionService.findByExternalActionId）；查不到就不是本域
 * 的 action（可能属于材料重检等其它域），返回 false 让 ingestion 级联继续找
 * 下一个域 —— 不抛错。
 */
@Injectable()
export class SwapApplicantActionHandler {
  private readonly logger = new Logger(SwapApplicantActionHandler.name);

  constructor(
    private readonly pendingActionService: CustomerPendingActionService,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<boolean> {
    const externalActionId = String(payload.externalActionId ?? '');
    const customer = await this.pendingActionService.findByExternalActionId(externalActionId);
    if (!customer) {
      this.logger.warn(
        `orphan applicantActionReviewed webhook, no customer for externalActionId=${externalActionId}`,
      );
      return false;
    }

    const reviewResult = (payload.reviewResult ?? null) as
      | { reviewAnswer?: 'GREEN' | 'RED' }
      | null;
    const reviewAnswer = reviewResult?.reviewAnswer;

    if (reviewAnswer === 'GREEN') {
      if (customer.hardLineDispositionedAt) {
        // 制裁 sticky marker 命中：这次 action 复核本身走完了（指针可以清），
        // 但绝不能因为客户完成了某个补料动作就解除制裁限制。
        await this.pendingActionService.set(customer.id, null, false);
        await this.auditLogsService.recordSystem({
          action: AuditActions.SWAP_ACTION_GREEN_HARDLINE_HELD,
          entityType: AuditEntityTypes.CUSTOMER,
          entityId: customer.id,
          entityNo: customer.customerNo || undefined,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: customer.id,
          entityOwnerNo: customer.customerNo || undefined,
          result: AuditResult.SUCCESS,
          reason:
            'GREEN applicant action review arrived for a hard-lined (sanctioned) customer — restrictions held, completing a verification action does not lift a sanctions hold',
          metadata: { externalActionId },
          sourcePlatform: 'SYSTEM',
        });
        return true;
      }

      // 非硬线：先清限制再清 pendingAction 指针 —— 与 handleRejectDisposition
      // 的 fail-safe 顺序哲学对称（先落成保守态，中途崩溃时留下的窗口更安全：
      // 万一崩在两次写入之间，客户已经解限只是暂时还看得到入口，不会出现
      // "入口已消失但仍被限制"这种更危险的状态）。
      await this.restrictionsService.clear(customer.id, ['SWAP', 'WITHDRAW'], 'system');
      await this.pendingActionService.set(customer.id, null, false);
      await this.auditLogsService.recordSystem({
        action: AuditActions.SWAP_ACTION_CLEARED,
        entityType: AuditEntityTypes.CUSTOMER,
        entityId: customer.id,
        entityNo: customer.customerNo || undefined,
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: customer.id,
        entityOwnerNo: customer.customerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'GREEN applicant action review — SWAP/WITHDRAW restrictions cleared',
        metadata: { externalActionId },
        sourcePlatform: 'SYSTEM',
      });
      return true;
    }

    // RED（或任何非 GREEN 的复核结果）：限制原样保留，升级人工复核。
    // pendingAction 指针不清 —— 客户可能需要针对同一个 action 重新提交。
    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_ACTION_ESCALATED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: customer.id,
      entityNo: customer.customerNo || undefined,
      workflowType: AuditWorkflowTypes.SWAP,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: customer.id,
      entityOwnerNo: customer.customerNo || undefined,
      result: AuditResult.SUCCESS,
      reason: `Applicant action review answer '${reviewAnswer ?? 'UNKNOWN'}' — restrictions held, escalated for manual review`,
      metadata: { externalActionId, reviewAnswer: reviewAnswer ?? null },
      sourcePlatform: 'SYSTEM',
    });
    return true;
  }
}
