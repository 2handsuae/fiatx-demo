// LP 两步准入 Task 4 · LP 打款地址 workflow：登记（先筛后批）/ 审批裁决落地 / 撤回 / 启停退 / ⚡筛查覆写。
// 照 lp-profile-workflow.service.ts 同构：铁律③各管各的——本文件只调 LpPayoutAddressService / LpProfileService 的公开
// 方法与 ApprovalsService 正门，不直写任何表；审计写入全收主体服务（域内惯例，见 lp-payout-address.service.ts 头注），
// 本文件零审计写入。铁律②门不可绕：非 RED 的登记一律经 LP_ADDRESS_APPROVAL（金库提、CFO 单步批）才生效。
import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import type { ScreeningAnswer } from '../../sumsub-shared/travel-rule/travel-rule-adapter.interface';
import {
  assertLpPayoutAddressTransition,
  LpPayoutAddressAction,
  LpPayoutAddressStatus,
} from './constants/lp-payout-address-transitions.constant';
import { LpPayoutAddressReasonDto, RegisterLpPayoutAddressDto, UpdateLpPayoutAddressLabelDto } from './dto/lp-payout-address.dto';
import { LpPayoutAddressService, LpPayoutAddressView } from './lp-payout-address.service';
import { LpProfileService } from './lp-profile.service';

/** 审批快照里给 CFO 看的坐标：法币 = IBAN（带开户行），链上 = 网络 + 地址。 */
function describeCoordinate(view: LpPayoutAddressView): string {
  if (view.iban) return view.bankName ? `${view.iban} (${view.bankName})` : view.iban;
  return `${view.network} ${view.address}`;
}

@Injectable()
export class LpPayoutAddressWorkflowService {
  constructor(
    private readonly addresses: LpPayoutAddressService,
    private readonly profiles: LpProfileService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ── 登记（金库提，先筛后批，CFO 单步批）─────────────────────────────────

  async registerAddress(lpNo: string, dto: RegisterLpPayoutAddressDto, actor: ApprovalActorContext) {
    // 登记即筛：归因 + 筛查在主体服务的落点计算里一次算完；RED 一票否决直落 REJECTED（含 REGISTERED / SCREENED /
    // REJECTED 三条留痕），连 CFO 审批队列都不进。
    const row = await this.addresses.create({ lpNo, ...dto }, actor);
    if (row.status === LpPayoutAddressStatus.REJECTED) {
      return { addressNo: row.addressNo, approvalNo: null, status: LpPayoutAddressStatus.REJECTED as string };
    }

    // GREEN / YELLOW 照常走 CFO 审批正门；快照带坐标 + 归因 + 筛查结论（CFO 批的不是盲盒）。
    const [profile, view] = await Promise.all([this.profiles.findByNo(lpNo), this.addresses.getView(row.addressNo)]);
    const coordinate = describeCoordinate(view);
    const custody = view.declaredHosting
      ? (view.hostingMismatch
        ? `hosting mismatch flagged: declared ${view.declaredHosting}, attributed ${view.addressType}`
        : `${view.addressType} custody, matches the declaration`)
      : 'bank account';
    const impact = `Register ${view.assetCode} payout address ${coordinate} for ${profile.name} (${custody}; screening ${view.screeningAnswer}; evidence ${view.evidenceRef}). `
      + 'Once approved it can be selected as the payout destination of LP exchange orders';

    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.LP_ADDRESS_APPROVAL,
        entityRef: row.addressNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          addressNo: row.addressNo, lpNo: row.lpNo, lpName: profile.name, assetCode: view.assetCode,
          coordinate, declaredHosting: view.declaredHosting, addressType: view.addressType,
          screeningAnswer: view.screeningAnswer, evidenceRef: view.evidenceRef, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await this.addresses.stampApprovalNo(row.addressNo, approval.approvalNo);
    return { addressNo: row.addressNo, approvalNo: approval.approvalNo as string, status: LpPayoutAddressStatus.PENDING_APPROVAL as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.lp-address.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision === 'CANCELLED') return; // 撤回口 cancel() 自己收口（它先撤审批单再翻状态）
    if (event.decision === 'APPROVED') await this.onApproved(event);
    else await this.onRejected(event);
  }

  async onApproved(event: ApprovalDecidedEvent): Promise<void> {
    if (!(await this.isStillPending(event.entityRef))) return;
    await this.addresses.transition(
      event.entityRef, LpPayoutAddressAction.APPROVE, {},
      { approvalNo: event.approvalNo, causationId: event.approvalId },
    );
  }

  /** DECLINED（CFO 驳回）与 EXPIRED（48h 超时）都落 REJECTED，拒因取 CFO 的 decisionReason / 固定超时文案。 */
  async onRejected(event: ApprovalDecidedEvent): Promise<void> {
    if (!(await this.isStillPending(event.entityRef))) return;
    const note = event.decision === 'EXPIRED' ? 'Approval expired' : (event.decisionReason ?? 'Rejected by CFO');
    await this.addresses.transition(
      event.entityRef, LpPayoutAddressAction.REJECT, {},
      { approvalNo: event.approvalNo, causationId: event.approvalId, reason: note },
    );
  }

  /** 照 lp-exchange-workflow.onDecided 的过期裁决守卫：地址已离开待批（被 ⚡喂 RED 拒了、被撤了）后才到的裁决事件
   *  一律忽略——迁移表里 REJECTED / CANCELLED 零出边，硬迁只会在事件处理器里抛 409。找不到地址同理静默。 */
  private async isStillPending(addressNo: string): Promise<boolean> {
    const row = await this.addresses.findByNo(addressNo);
    return row?.status === LpPayoutAddressStatus.PENDING_APPROVAL;
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(addressNo: string, dto: LpPayoutAddressReasonDto, actor: ApprovalActorContext) {
    const row = await this.addresses.getView(addressNo);
    // 先验这条边合法（只有待批能撤），再去碰审批引擎——已批地址不该撞出「Only DRAFT or PENDING approvals can be cancelled」。
    assertLpPayoutAddressTransition(row.status, LpPayoutAddressAction.CANCEL);
    // 先撤审批单后翻状态（照 lp-exchange cancel 纪律）；审批引擎要求撤回人是提单人或超管。
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason }, actor);
    return this.direct(addressNo, LpPayoutAddressAction.CANCEL, dto, actor);
  }

  // ── 启停退（金库，直接迁移 + 审计，不建审批；收紧动作免门，同档案先例）──────────

  suspend(addressNo: string, dto: LpPayoutAddressReasonDto, actor: ApprovalActorContext) {
    return this.direct(addressNo, LpPayoutAddressAction.SUSPEND, dto, actor);
  }

  reactivate(addressNo: string, dto: LpPayoutAddressReasonDto, actor: ApprovalActorContext) {
    return this.direct(addressNo, LpPayoutAddressAction.REACTIVATE, dto, actor);
  }

  deactivate(addressNo: string, dto: LpPayoutAddressReasonDto, actor: ApprovalActorContext) {
    return this.direct(addressNo, LpPayoutAddressAction.DEACTIVATE, dto, actor);
  }

  private async direct(addressNo: string, action: LpPayoutAddressAction, dto: LpPayoutAddressReasonDto, actor: ApprovalActorContext) {
    const updated = await this.addresses.transition(addressNo, action, {}, { actor, reason: dto.reason });
    return { addressNo, status: updated.status as string };
  }

  // ── 改标签（坐标与申报登记后冻结，改只改 label）──────────────────────────

  async updateLabel(addressNo: string, dto: UpdateLpPayoutAddressLabelDto, actor: ApprovalActorContext) {
    await this.addresses.updateLabel(addressNo, dto.label, actor);
    return this.addresses.getView(addressNo);
  }

  // ── ⚡筛查覆写（合规官 DEMO_VERDICT_WRITE，站在 Sumsub 一侧改判；照客户地址簿 feedScreening 同款）────────

  /**
   * 仅 PENDING_APPROVAL：GREEN / YELLOW 只覆写筛查结论（不迁移，记 LP_ADDRESS_SCREENED）；RED 走 REJECT 边 → REJECTED
   * （终态，记 LP_ADDRESS_REJECTED，操作员亲手写）。非待批态一律 409、不写审计——⚡不是绕迁移表的直写通道。
   *
   * 在途审批单的处置（照 lp-exchange 的过期裁决守卫，不撤单）：⚡RED 把地址拒掉后，那张 LP_ADDRESS_APPROVAL
   * 仍留在 CFO 队列里直到被裁决或 48h 超时——此后到的裁决事件由 onDecided 的 isStillPending 守卫吞掉，地址不会被复活。
   * 不在这里 approvals.cancel：审批引擎只允许提单人或超管撤单，而本后门的持有者是合规官（非提单人），
   * 硬撤会让 ⚡RED 对它自己的目标用户 403。审计里用 metadata.openApprovalNo 如实记下被晾下的那张单。
   */
  async feedScreening(addressNo: string, answer: ScreeningAnswer, reason: string, actor: ApprovalActorContext) {
    if (!reason?.trim()) throw new BadRequestException('reason is required');
    if (answer === 'RED') {
      const row = await this.addresses.getView(addressNo);
      await this.addresses.transition(
        addressNo, LpPayoutAddressAction.REJECT, { screeningAnswer: 'RED', screenedAt: new Date() },
        { actor, reason, metadata: { screeningFedBy: actor.userNo ?? actor.userId, screeningAnswer: 'RED', openApprovalNo: row.approvalNo } },
      );
    } else {
      await this.addresses.recordScreening(addressNo, answer, reason, actor);
    }
    return this.addresses.getView(addressNo);
  }
}
