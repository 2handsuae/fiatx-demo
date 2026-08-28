// Task 4 —— 调账单接审批中心。批准/驳回后直接转调 AdjustmentService，
// 批准与落账之间不加第二个人工环节；onApproved 本任务只留桩（Task 5 落账）。
//
// 覆写基类同名钩子而不是走 workflow.*.decided 二级事件：这两个钩子在
// ApprovalHandlerBase 里本来就用 @OnEvent 直接监听审批中心的原始事件
// （见 approval-handler.base.ts:63-73），子类覆写后必须重新挂 @OnEvent——
// EventSubscribersLoader 是按 instance[methodKey] 取函数对象再查装饰器元数据
// （@nestjs/event-emitter 的 event-subscribers.loader.js），覆写生成的是全新
// 函数对象，不重新装饰就永远不会被真实事件触发，是个哑巴 handler。
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
    await this.adjustments.onApproved(event.entityRef, event.decisionByUserId ?? 'SYSTEM');
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    await this.adjustments.onRejected(event.entityRef, event.decisionByUserId ?? 'SYSTEM');
  }
}
