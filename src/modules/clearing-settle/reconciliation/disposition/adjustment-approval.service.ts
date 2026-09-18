// Task 4 —— 调账单接审批中心。批准/驳回后直接转调 AdjustmentService，
// 批准与落账之间不加第二个人工环节；onApproved 本任务只留桩（Task 5 落账）。
//
// 覆写基类同名钩子而不是走 workflow.*.decided 二级事件：这几个钩子在
// ApprovalHandlerBase 里本来就用 @OnEvent 直接监听审批中心的原始事件
// （见 approval-handler.base.ts:63-85），子类覆写后必须重新挂 @OnEvent——
// EventSubscribersLoader 是按 instance[methodKey] 取函数对象再查装饰器元数据
// （@nestjs/event-emitter 的 event-subscribers.loader.js），覆写生成的是全新
// 函数对象，不重新装饰就永远不会被真实事件触发，是个哑巴 handler。
//
// 四个钩子全覆盖，不止 APPROVED/REJECTED：基类默认把 CANCELLED/EXPIRED
// 发到 workflow.recon.decided，全仓没有任何地方监听这个频道——若不接管，
// 运营在审批页点取消、或审批 48 小时超时，事件会掉进虚空，调账单卡在
// PENDING_APPROVAL 出不来（该状态的出边只有 POSTED/REJECTED，没有回 DRAFT
// 的边）。对调账单而言，驳回/取消/超时业务上是同一个结局——这张单不会落账，
// 复用既有的 REJECTED 终态边，不新开边、不改 4 态设计。
import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalDecisionEvent,
  ApprovalEvents,
} from '../../../governance/approvals/constants/approval.constants';
import { AdjustmentService } from './adjustment.service';

@Injectable()
export class AdjustmentApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.RECON_ADJUSTMENT_POST;
  readonly workflowType = 'RECON';

  constructor(
    private readonly adjustments: AdjustmentService,
    eventEmitter: EventEmitter2,
  ) {
    super(eventEmitter);
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    // 铁律⑥ 回归修复：此前只取 decisionByUserId（JWT payload.sub，管理员表
    // UUID），把同一个事件里现成的 decisionByUserNo / decisionByRole 丢在原地
    // 没用——详情页 "Decided By"、审计 actorNo/actorDisplayName 于是显示裸 UUID，
    // 与同屏 "Created By"（走 actor.userNo ?? actor.userId）并排对不上。
    await this.adjustments.onApproved(
      event.entityRef,
      event.decisionByUserId ?? 'SYSTEM',
      event.decisionByUserNo ?? null,
      event.decisionByRole ?? null,
    );
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    await this.routeToRejected(event);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    await this.routeToRejected(event);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    // 超时没有裁决人——decisionByUserId 缺省时的 'SYSTEM' 兜底在这条路径上是常态，不是异常。
    await this.routeToRejected(event);
  }

  private async routeToRejected(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    await this.adjustments.onRejected(
      event.entityRef,
      event.decisionByUserId ?? 'SYSTEM',
      event.decisionByUserNo ?? null,
    );
  }
}
