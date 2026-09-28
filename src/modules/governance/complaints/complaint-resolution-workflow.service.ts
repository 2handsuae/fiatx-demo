// 战役甲波五 T3 · 投诉裁决审批链（task-3-brief.md：波五：运营提、合规官批）。
//
// 铁律③各管各的：本 workflow 横向只调 ComplaintsService 各自的服务方法——
// proposeResolution（开单后落 pendingApprovalNo）/ applyResolution（批准落地）/
// rejectResolution（驳回/撤/过期回退）。三个落地动作各自的审计都已经在 ComplaintsService
// 内部写好（T2 交付），本 workflow 不重复写审计。
//
// 提单顺序（照 ri-replacement-workflow.service.ts 先例）：ApprovalsService 开单拿
// approvalNo → proposeResolution——审批单号在审批工单开出之后才存在，故投诉裁决提案也拆
// 两步（不能像多数 workflow 那样一次性把 approvalNo 塞进主表 create）。
//
// onDecided 批准分支从审批单自身携带的提案载荷（objectSnapshot）取值传给
// applyResolution（同一 approvalNo）——不是从别处重新拼一份，确保「批的是什么就落的是
// 什么」（照 SanctionDispositionWorkflowService.fetchApprovedSnapshot 先例，按 approvalNo
// 精确查，不依赖"最新一条=本次"的时序假设）。
//
// ⚠️ 词表撞名：ApprovalHandlerBase.ApprovalDecidedEvent 的 decision 词表是
// 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED'（approval-handler.base.ts），而 T2
// ComplaintsService.rejectResolution 的第三参用的是 'REJECTED' | 'CANCELLED' | 'EXPIRED'
// （task-2-brief.md 原文签名）——两处不是同一份词表。onDecided 内把 DECLINED 显式翻译成
// REJECTED 再往下传，CANCELLED/EXPIRED 原样透传，不假设两个词表恰好同名。
//
// ⚠️ 本文件只落 workflow 消费端。派生 COMPLAINT_RESOLUTION_DECIDED 事件的
// ApprovalHandlerBase 子类（ComplaintResolutionApprovalService，同 ri-replacement-approval
// .service.ts 形状）与 complaints.module.ts 的 provider 挂载不在本任务范围——module 尚不
// 存在（T4 创建），此刻建一个无处注册的 handler 会是孤儿 provider。onDecided 本身在本任务
// 只按 RI 先例做行为化单测（直接构造 ApprovalDecidedEvent 调用，不经真实事件总线）。
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext, ApprovalStatuses } from '../approvals/constants/approval.constants';
import { ResolutionDto } from './complaint.constants';
import { ComplaintsService } from './complaints.service';

@Injectable()
export class ComplaintResolutionWorkflowService {
  constructor(
    private readonly complaints: ComplaintsService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  /**
   * 提单：运营对一张投诉的裁决走 ApprovalsService 正门开单（铁律②门不可绕）。
   */
  async propose(actor: ApprovalActorContext, complaintNo: string, dto: ResolutionDto): Promise<{ approvalNo: string }> {
    const traceId = randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.COMPLAINT_RESOLUTION,
        entityRef: complaintNo,
        traceId,
        objectSnapshot: { complaintNo, outcome: dto.outcome, resolutionText: dto.resolutionText },
      },
      { reason: dto.resolutionText, traceId },
      actor,
    );

    await this.complaints.proposeResolution(actor, complaintNo, dto, approvalCase.approvalNo);
    return { approvalNo: approvalCase.approvalNo };
  }

  /**
   * 裁决落地。APPROVED → applyResolution（值来自审批单自带的提案载荷，同一
   * approvalNo）；DECLINED/CANCELLED/EXPIRED → rejectResolution（DECLINED 翻译成
   * REJECTED，见文件头注释）。
   */
  @OnEvent(DOMAIN_EVENTS.COMPLAINT_RESOLUTION_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') {
      const decision = event.decision === 'DECLINED' ? 'REJECTED' : event.decision;
      await this.complaints.rejectResolution(event.entityRef, event.approvalNo, decision);
      return;
    }

    const snapshot = await this.fetchApprovedSnapshot(event.approvalNo);
    await this.complaints.applyResolution(event.entityRef, event.approvalNo, {
      outcome: snapshot.outcome,
      resolutionText: snapshot.resolutionText,
    });
  }

  /** 按 approvalNo 精确查快照（同 RI/Sanction 先例）——不依赖"最新一条=本次"的时序假设。 */
  private async fetchApprovedSnapshot(approvalNo: string): Promise<ResolutionDto> {
    const { items } = await this.approvalsService.list({
      actionType: ApprovalActionTypes.COMPLAINT_RESOLUTION,
      approvalNo,
      status: ApprovalStatuses.APPROVED,
    } as any);
    const snapshot = items[0]?.objectSnapshot as ResolutionDto | null | undefined;
    if (!snapshot) {
      throw new Error(`Complaint resolution ${approvalNo}: no APPROVED COMPLAINT_RESOLUTION case with an objectSnapshot found`);
    }
    return snapshot;
  }
}
