import { Injectable, Logger } from '@nestjs/common';
import { CustomerPendingActionService } from '../identity/customers/customer-pending-action.service';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
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
 * `CustomerRestrictionWorkflowService.autoRelease()` 至今零调用方 —— 本 handler 是它的
 * 第一个调用方。
 *
 * ⚠️ 硬线客户不得因完成某个 action 而解锁。Task 7 的
 * `hardLineDispositionedAt` sticky marker 一旦非空即制裁线 —— 哪怕这次
 * action 复核是 GREEN，也只清 pendingAction 指针（这次 action 本身走完了），
 * 绝不调用 restrictionWorkflowService.autoRelease()，并写一条专属审计说明为何限制被保留，
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
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<boolean> {
    // Finding 1（终审 Critical）：真实 Sumsub `applicantActionReviewed` webhook
    // 携带的字段是 `externalApplicantActionId`，不是 `externalActionId`——后者
    // 只是 createActionSdkToken() 那个铸 token 的 API 的请求参数名
    // （sumsub.client.ts），从未出现在 webhook 报文里。两个键都读、优先真实
    // 字段：生产 webhook 命中 `externalApplicantActionId`；我方 demo 生产者
    // （demo-scenario.service.ts）历史上一直写 `externalActionId`，保留它作
    // 兜底不破坏既有 demo/单测路径。⚠️ 不要"精简"掉这个 fallback——这正是
    // sumsub-ingestion.md 记录过的同一类事故（fixture 与 handler 就着错键
    // 互相印证、演示与单测全绿却在真实环境必炸）。
    const externalActionId = String(
      payload.externalApplicantActionId ?? payload.externalActionId ?? '',
    );
    if (!externalActionId) {
      // Finding 2（终审 Important）：空 id 绝不能拿去查库。该列在真实数据里
      // 能合法为空串（两个 txn client 都用 `String(a.externalActionId ?? '')`
      // 兜底、swap-workflow.service.ts 写 pendingActionExternalId 时也没有
      // 判空），若放行查询，会认领到那个 pendingActionExternalId 恰好是 ''
      // 的无关客户。
      this.logger.debug('applicantActionReviewed webhook missing external action id, ignoring');
      return false;
    }
    const customer = await this.pendingActionService.findByExternalActionId(externalActionId);
    if (!customer) {
      // Finding 4（终审 Minor）：swap 现在是这个 webhook 类型的第一棒（见
      // sumsub-ingestion.service.ts 的前置分流），认领不到多数时候只是"这个
      // action 属于材料重检等其它域"的正常情况，不是真孤儿——降级为 debug，
      // 与 deposit 侧对同类"查无归属，级联到下一棒"场景的降级一致
      // （deposit-kyt-verdict.handler.ts；sumsub-ingestion.md §3）。
      this.logger.debug(
        `no customer for applicantActionReviewed externalActionId=${externalActionId} — cascading to material-refresh (Clue 3)`,
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
        //
        // Finding 3（终审 Important）：审计先写、指针后清——`set(customer.id,
        // null, false)` 就是"消费认领"的那一步（它把 pendingActionExternalId
        // 置空，同一个 externalActionId 之后再也查不到这个客户）。
        // `AuditLogsService` 没有内部 try/catch，写库失败会往外抛、被
        // `dispatch()` 的 catch 接住并标 event FAILED 等重投；若先清指针再写
        // 审计，重投时指针已经是 null、`findByExternalActionId` 直接落空、
        // handler 原样返回 false——这条"GREEN 到过、被刻意不解锁"的审计记录
        // 就永久消失了，恰是本 handler 存在的意义要留给调查员看的那份证据。
        // 换成先审计：即便重投也只是多一行重复审计（远比记录彻底丢失安全）。
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
        await this.pendingActionService.set(customer.id, null, false);
        return true;
      }

      // 非硬线：先清限制、再写审计、最后才清 pendingAction 指针。
      // 顺序拆成两层考虑：
      // 1）清限制先于清指针——与 handleRejectDisposition 的 fail-safe 顺序
      //    哲学对称（先落成保守态，中途崩溃时留下的窗口更安全：万一崩在
      //    这之后，客户已经解限只是暂时还看得到入口，不会出现"入口已消失
      //    但仍被限制"这种更危险的状态）。
      // 2）审计先于清指针（Finding 3，同上一个分支的理由）——`set(...,
      //    null, ...)` 才是"消费认领"的那一步，审计必须抢在它前面落地，
      //    否则重投时指针已空、handler 直接落空返回 false，
      //    `SWAP_ACTION_CLEARED` 这条记录就永远不会存在。
      // Task 8：从 clear(capability[]) 换成按 cause 精确自动撕。
      // 只撕软线那张（KYT_REJECTED_SOFT）—— 客户身上若还挂着制裁/材料/升级
      // 等别的因，一律不动。caseRef 传 null：复核回调只知道 action id，
      // 不知道当初是哪一笔 swap 贴的，由 findOpenByCause 取该 cause 下最早一张。
      await this.restrictionWorkflowService.autoRelease(
        customer.id,
        'KYT_REJECTED_SOFT',
        null,
        'SYSTEM',
      );
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
        reason: 'GREEN applicant action review — KYT_REJECTED_SOFT restriction released',
        metadata: { externalActionId },
        sourcePlatform: 'SYSTEM',
      });
      await this.pendingActionService.set(customer.id, null, false);
      return true;
    }

    // RED（或任何非 GREEN 的复核结果）：限制原样保留，升级人工复核。
    // pendingAction 指针不清 —— 客户可能需要针对同一个 action 重新提交
    // （Sumsub RETRY 复审走同一 action id）。提交章清零（parity 2026-08-14）：
    // banner 从"审核中"退回"请认证"，客户能再次进认证页重交。
    await this.pendingActionService.resetSubmission(customer.id);
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
