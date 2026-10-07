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
//
// 整备波 T3（spec §3）：批准落地（applyReplacement）之后，本 workflow 再横向调
// RegulatoryFilingService.openForRiChange 自动开一张 MATERIAL_CHANGE_NOTIFICATION（DRAFT、
// SYSTEM 源、无钟），合规官接手走 GENERAL 族六态原样。驳回/撤单/过期没换人，不开单。
// RI 行不回填 filingNo、不建外键（零 schema）——双向可查靠标题与审计 metadata 的
// riNo/approvalNo。
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext, ApprovalStatuses } from '../approvals/constants/approval.constants';
import { RegulatoryFilingService } from '../regulatory-filings/regulatory-filing.service';
import { ProposeReplacementDto, ResponsibleIndividualsService } from './responsible-individuals.service';

@Injectable()
export class RiReplacementWorkflowService {
  constructor(
    private readonly responsibleIndividuals: ResponsibleIndividualsService,
    private readonly approvalsService: ApprovalsService,
    private readonly filings: RegulatoryFilingService,
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
   * approvalNo）→ openForRiChange 开重大变更告知单；DECLINED/CANCELLED/EXPIRED →
   * clearReplacement（只清 pending，不换人、不开单）。
   *
   * ⚠️ 非原子（照实）：applyReplacement 已落库后若 openForRiChange 抛错，换人不回滚、
   * 也不补偿、不重试——本方法不 catch，异常原样抛出；但 @OnEvent 监听器的异常被
   * event-emitter 默认抑制（suppressErrors：只记一条 error 日志，不回到审批接口的 HTTP
   * 响应），批准接口仍返回 200，结果是「已换人、无告知单」。与制裁 CONFIRMED 出口
   * （CONFIRMED 便签已落库而 CNMR 开单失败）同形的半落地窗口，先例已登记
   * doc-final/PRODUCTION-NOTES.md 2026-09-26「onDecided 异常被 event-emitter 默认吞掉」条；
   * 演示范围内不修（CLAUDE.md §2：禁补偿/重试；§3：外部系统总是准时回调、单人顺序操作）。
   */
  @OnEvent(DOMAIN_EVENTS.RI_REPLACEMENT_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') {
      await this.responsibleIndividuals.clearReplacement(event.entityRef, event.approvalNo, event.decision);
      return;
    }

    const snapshot = await this.fetchApprovedSnapshot(event.approvalNo);
    // 旧任必须在 applyReplacement 之前读——落地后席位行已是新任，之后再读标题就成了
    // "新 → 新"。position 同此一并取（席位职位不随换人变化）。
    const seatBefore = await this.responsibleIndividuals.findByNo(event.entityRef);
    await this.responsibleIndividuals.applyReplacement(event.entityRef, event.approvalNo, {
      newIncumbentName: snapshot.newIncumbentName,
      effectiveFrom: snapshot.effectiveFrom,
      varaRef: snapshot.varaRef,
    });
    await this.filings.openForRiChange({
      riNo: event.entityRef,
      approvalNo: event.approvalNo,
      position: seatBefore.position,
      fromIncumbent: seatBefore.incumbentName,
      toIncumbent: snapshot.newIncumbentName,
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
