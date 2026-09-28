// 战役乙波一 T3 · LP 档案审批 workflow（initiateCreate / proposeSettlementChange /
// suspend / reactivate + 裁决收口）。铁律③各管各的：本文件只调 LpProfileService 的公开
// 方法与 ApprovalsService 正门，不直写 LiquidityProvider 表；审计写入全收档案服务
// （Task 2 约定 + 控制者裁定 R6 补的 recordChangeProposed/recordChangeRejected），本文件
// 零审计写入。
import { ConflictException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext, ApprovalStatuses } from '../../governance/approvals/constants/approval.constants';
import { LpProfileService } from './lp-profile.service';
import {
  CreateLpProfileDto,
  LpProfileStatus,
  ProposeSettlementChangeDto,
  ReactivateLpProfileDto,
  SuspendLpProfileDto,
} from './dto/lp-profile.dto';

interface SettlementCoordinates extends Record<string, unknown> {
  fiatBankName: string;
  fiatIban: string;
  cryptoNetwork: string;
  cryptoAddress: string;
}

@Injectable()
export class LpProfileWorkflowService {
  constructor(
    private readonly profiles: LpProfileService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ── 建档（金库提，CFO 单步批）─────────────────────────────────────────

  async initiateCreate(dto: CreateLpProfileDto, actor: ApprovalActorContext) {
    const row = await this.profiles.create(actor, dto);
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
        entityRef: row.lpNo,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: { lpNo: row.lpNo, name: row.name, fiatIban: row.fiatIban, cryptoAddress: row.cryptoAddress, agreementRef: row.agreementRef },
      },
      { reason: dto.reason },
      actor,
    );
    await this.profiles.stampApprovalNo(row.lpNo, approval.approvalNo);
    return { lpNo: row.lpNo, approvalNo: approval.approvalNo as string, status: LpProfileStatus.PENDING_APPROVAL };
  }

  // ── 改结算坐标（金库提，ACTIVE 期间，CFO 单步批；一次只许一张在途）──────────

  async proposeSettlementChange(lpNo: string, dto: ProposeSettlementChangeDto, actor: ApprovalActorContext) {
    await this.profiles.assertActiveByNo(lpNo);
    const row = await this.profiles.findByNo(lpNo);

    // 一次只许一张在途变更审批（照 customer-restriction-workflow.service.ts「防重复开案」先例）。
    const blocking = await this.approvals.list({
      actionType: ApprovalActionTypes.LP_PROFILE_CHANGE,
      entityRef: lpNo,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (blocking.total > 0) {
      throw new ConflictException(`Liquidity provider ${lpNo} already has a pending settlement-change approval; resolve it before submitting another.`);
    }

    const before: SettlementCoordinates = {
      fiatBankName: row.fiatBankName, fiatIban: row.fiatIban, cryptoNetwork: row.cryptoNetwork, cryptoAddress: row.cryptoAddress,
    };
    const after: SettlementCoordinates = {
      fiatBankName: dto.fiatBankName ?? row.fiatBankName,
      fiatIban: dto.fiatIban ?? row.fiatIban,
      cryptoNetwork: dto.cryptoNetwork ?? row.cryptoNetwork,
      cryptoAddress: dto.cryptoAddress ?? row.cryptoAddress,
    };

    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.LP_PROFILE_CHANGE,
        entityRef: lpNo,
        // 铁律⑥：快照零 UUID——新旧坐标对照，审批页原样渲染
        objectSnapshot: { lpNo, before, after },
      },
      { reason: dto.reason },
      actor,
    );
    await this.profiles.recordChangeProposed(row, { before, after, reason: dto.reason }, actor, approval.approvalNo);
    return { lpNo, approvalNo: approval.approvalNo as string, status: row.status as string };
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

  // ── 审批裁决（两条审批类型共用 workflowType=LP_PROFILE，故共用同一 decided 事件，
  //     按 event.actionType 分岔）────────────────────────────────────────

  @OnEvent('workflow.lp-profile.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision === 'CANCELLED') return; // 撤回口自己收口（本任务未开撤回端点）
    if (event.actionType === ApprovalActionTypes.LP_PROFILE_APPROVAL) {
      await this.onProfileApprovalDecided(event);
      return;
    }
    if (event.actionType === ApprovalActionTypes.LP_PROFILE_CHANGE) {
      await this.onChangeDecided(event);
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

  /** 批准落地从审批单自带的 objectSnapshot 读值（甲波四判例：批的是什么就落的是什么，
   *  不在裁决时重新拼一份可能已经漂移的当前态）；驳回 / 超时坐标原样不动，只留痕。 */
  private async onChangeDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision === 'APPROVED') {
      const after = await this.fetchApprovedAfter(event.approvalNo);
      await this.profiles.applySettlementChange(event.entityRef, { ...after, approvalNo: event.approvalNo, causationId: event.approvalId });
      return;
    }
    const row = await this.profiles.findByNo(event.entityRef);
    const note = event.decision === 'EXPIRED' ? 'Settlement-change approval expired' : (event.decisionReason ?? 'Settlement change rejected by CFO');
    await this.profiles.recordChangeRejected(row, event.approvalNo, event.approvalId, note);
  }

  /** 按 approvalNo 精确查快照（照 RiReplacementWorkflowService.fetchApprovedSnapshot 先例）——
   *  不依赖"最新一条=本次"的时序假设。 */
  private async fetchApprovedAfter(approvalNo: string): Promise<SettlementCoordinates> {
    const { items } = await this.approvals.list({
      actionType: ApprovalActionTypes.LP_PROFILE_CHANGE,
      approvalNo,
      status: ApprovalStatuses.APPROVED,
    });
    const snapshot = items[0]?.objectSnapshot as { after?: SettlementCoordinates } | null | undefined;
    if (!snapshot?.after) {
      throw new Error(`LP profile change ${approvalNo}: no APPROVED LP_PROFILE_CHANGE case with an objectSnapshot found`);
    }
    return snapshot.after;
  }
}
