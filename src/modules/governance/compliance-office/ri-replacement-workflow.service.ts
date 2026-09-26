// 战役甲波四 T5 · RI 换人审批链（spec §4.2）。
//
// 铁律③各管各的：本 workflow 横向只调 ResponsibleIndividualsService 各自的服务方法——
// assertNoPendingReplacement（在途查重）/ recordProposal（开单后落 pendingApprovalNo）/
// applyReplacement（批准落地）/ clearReplacement（驳回/撤/过期只清 pending）。不直写表。
// 三个落地动作各自的审计（RI_REPLACEMENT_PROPOSED/APPLIED/REJECTED）都已经在
// ResponsibleIndividualsService 内部写好（T4 交付），本 workflow 不重复写审计。
//
// 提单顺序（控制器裁定 R1）：assertNoPendingReplacement → ApprovalsService 开单拿
// approvalNo → recordProposal——审批单号在审批工单开出之后才存在，故 RI 提案拆两步
// （不能像多数 workflow 那样一次性把 approvalNo 塞进主表 create）。
//
// onDecided 批准分支从审批单自身携带的提案载荷（objectSnapshot）取值传给
// applyReplacement（同一 approvalNo）——不是从别处重新拼一份，确保「批的是什么就落的是
// 什么」（照 SanctionDispositionWorkflowService.fetchApprovedSnapshot 先例，按 approvalNo
// 精确查，不依赖"最新一条=本次"的时序假设——白9 判例，一席一在途场景本身不会有并发的
// 第二张提案，但按 approvalNo 查仍是更稳的写法，成本为零）。驳回/撤单/过期只清 pending，
// 不换人。
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext, ApprovalStatuses } from '../approvals/constants/approval.constants';
import { ProposeReplacementDto, ResponsibleIndividualsService } from './responsible-individuals.service';

@Injectable()
export class RiReplacementWorkflowService {
  constructor(
    private readonly responsibleIndividuals: ResponsibleIndividualsService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  /**
   * 提单：合规官对一个 RI 席位提换人申请，走 ApprovalsService 正门开单（铁律②门不可绕）。
   * 前置：该席位不能已有在途换人——assertNoPendingReplacement 在开单前先查重（若已有在途，
   * recordProposal 内部也会再查一次，但那时审批单已经开出去了，白开一张单不如提前拦）。
   */
  async initiateReplacement(
    riNo: string,
    dto: ProposeReplacementDto,
    actor: ApprovalActorContext,
  ): Promise<{ approvalNo: string }> {
    await this.responsibleIndividuals.assertNoPendingReplacement(riNo);

    const traceId = randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.RI_REPLACEMENT,
        entityRef: riNo,
        traceId,
        objectSnapshot: dto as unknown as Record<string, unknown>,
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.responsibleIndividuals.recordProposal(actor, riNo, approvalCase.approvalNo, dto);
    return { approvalNo: approvalCase.approvalNo };
  }

  /**
   * 裁决落地。APPROVED → applyReplacement（值来自审批单自带的提案载荷，同一
   * approvalNo）；DECLINED/CANCELLED/EXPIRED → clearReplacement（只清 pending，不换人）。
   */
  @OnEvent(DOMAIN_EVENTS.RI_REPLACEMENT_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') {
      await this.responsibleIndividuals.clearReplacement(event.entityRef, event.approvalNo, event.decision);
      return;
    }

    const snapshot = await this.fetchApprovedSnapshot(event.approvalNo);
    await this.responsibleIndividuals.applyReplacement(event.entityRef, event.approvalNo, {
      newIncumbentName: snapshot.newIncumbentName,
      effectiveFrom: snapshot.effectiveFrom,
      varaRef: snapshot.varaRef,
    });
  }

  /** 按 approvalNo 精确查快照（同 SanctionDispositionWorkflowService.fetchApprovedSnapshot
   *  先例）——不依赖"最新一条=本次"的时序假设。 */
  private async fetchApprovedSnapshot(approvalNo: string): Promise<ProposeReplacementDto> {
    const { items } = await this.approvalsService.list({
      actionType: ApprovalActionTypes.RI_REPLACEMENT,
      approvalNo,
      status: ApprovalStatuses.APPROVED,
    } as any);
    const snapshot = items[0]?.objectSnapshot as ProposeReplacementDto | null | undefined;
    if (!snapshot) {
      throw new Error(`RI replacement ${approvalNo}: no APPROVED RI_REPLACEMENT case with an objectSnapshot found`);
    }
    return snapshot;
  }
}
