// 战役乙波一 T3 · LP 档案审批 workflow（initiateCreate / suspend / reactivate + 裁决收口）。
// 铁律③各管各的：本文件只调 LpProfileService 的公开方法与 ApprovalsService 正门，不直写
// LiquidityProvider 表；审计写入全收档案服务（Task 2 约定），本文件零审计写入。
// （LP 两步准入 Task 9：改结算坐标那条链——提案方法与变更审批裁决——整体退役。）
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { LpProfileService } from './lp-profile.service';
import { screenLpEntityName } from './lp-entity-screening.mock';
import {
  CreateLpProfileDto,
  LpProfileStatus,
  ReactivateLpProfileDto,
  SuspendLpProfileDto,
} from './dto/lp-profile.dto';

@Injectable()
export class LpProfileWorkflowService {
  constructor(
    private readonly profiles: LpProfileService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ── 建档（金库提，CFO 单步批）─────────────────────────────────────────

  async initiateCreate(dto: CreateLpProfileDto, actor: ApprovalActorContext) {
    // 建档提交瞬间同步跑实体背调（mock）；RED 一票否决——档案服务按落点计算直接落 REJECTED
    // （含 CREATED/SCREENED/REJECTED 三条留痕），连 CFO 审批队列都不进。
    const row = await this.profiles.create(actor, dto, { answer: screenLpEntityName(dto.name), screenedAt: new Date() });
    if (row.status === LpProfileStatus.REJECTED) {
      return { lpNo: row.lpNo, approvalNo: null, status: LpProfileStatus.REJECTED };
    }
    // GREEN / YELLOW 照常走 CFO 审批正门；快照带背调结论与尽调引用（CFO 批的不是盲盒）
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
        entityRef: row.lpNo,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          lpNo: row.lpNo, name: row.name, agreementRef: row.agreementRef,
          screeningAnswer: row.screeningAnswer, dueDiligenceRef: row.dueDiligenceRef,
        },
      },
      { reason: dto.reason },
      actor,
    );
    await this.profiles.stampApprovalNo(row.lpNo, approval.approvalNo);
    return { lpNo: row.lpNo, approvalNo: approval.approvalNo as string, status: LpProfileStatus.PENDING_APPROVAL };
  }

  // ── 启停（金库提，直接迁移 + 审计，不建审批）───────────────────────────

  async suspend(lpNo: string, dto: SuspendLpProfileDto, actor: ApprovalActorContext) {
    const updated = await this.profiles.transition(lpNo, LpProfileStatus.SUSPENDED, {}, { actor, reason: dto.reason });
    return { lpNo, status: updated.status as string };
  }

  async reactivate(lpNo: string, dto: ReactivateLpProfileDto, actor: ApprovalActorContext) {
    const updated = await this.profiles.transition(lpNo, LpProfileStatus.ACTIVE, {}, { actor, reason: dto.reason });
    return { lpNo, status: updated.status as string };
  }

  // ── 审批裁决（workflowType=LP_PROFILE 的 decided 事件）────────────────────────

  @OnEvent('workflow.lp-profile.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision === 'CANCELLED') return; // 撤回口自己收口（本任务未开撤回端点）
    if (event.actionType === ApprovalActionTypes.LP_PROFILE_APPROVAL) {
      await this.onProfileApprovalDecided(event);
    }
  }

  private async onProfileApprovalDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision === 'APPROVED') {
      await this.profiles.transition(event.entityRef, LpProfileStatus.ACTIVE, {}, { approvalNo: event.approvalNo, causationId: event.approvalId });
      return;
    }
    const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
    await this.profiles.transition(event.entityRef, LpProfileStatus.REJECTED, {}, { approvalNo: event.approvalNo, causationId: event.approvalId, reason: note });
  }
}
