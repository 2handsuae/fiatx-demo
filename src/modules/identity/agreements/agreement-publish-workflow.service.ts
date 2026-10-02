// 战役丙波三 T3 · 客户协议发布审批链（spec §1.4 / §2）。
//
// 骨架照 ri-replacement-workflow.service.ts：提单拆两步（开审批单拿 approvalNo → 版本行落
// PENDING_APPROVAL + pendingApprovalNo，审批单号在工单开出之后才存在）；裁决由
// AgreementPublishApprovalService 派生 `workflow.customer-agreement.decided`，本 workflow
// 一处接。铁律②门不可绕：发布只有 ApprovalsService.createAndSubmit 这一道正门。
//
// 版本状态机的本 workflow 负责三条边（PUBLISHED→EFFECTIVE→SUPERSEDED 归 AgreementsReadService
// 的懒翻，那是 EFFECTIVE 的唯一写点）：
//   DRAFT ──提交发布──► PENDING_APPROVAL
//   PENDING_APPROVAL ──批准且 30 天复核过──► PUBLISHED
//   PENDING_APPROVAL ──驳回/撤单/过期，或批准时复核不过──► DRAFT
// 铁律④：每条边都是 updateMany({ where: { versionKey, status: <出发态> } })，命中不是 1 行即
// 显式抛错——迁移表以出发态为 where 条件，非法跃迁自然 0 行；没有任何一处直 update 绕边。
//
// 铁律①：三条边各自留痕（SUBMITTED=操作者 / PUBLISHED、REJECTED=system），显式 requestId
// （审计 idempotencyKey 含 primarySubjectNo=versionKey，缺了同一版本的第二条会被静默去重；
// reset 不清审计表，故带随机后缀避免跨重铺撞键）。
//
// 30 天双锚（spec §0 岔口 B）：监管通知期的钟从"通知客户"起算，而本系统批准即通知，所以
// 两个锚——提交时预检 effectiveAt ≥ 提交时刻+30d（友好报错），批准落地时以批准时刻复核
// effectiveAt ≥ decidedAt+30d（防"提交后拖延数天才批"把通知期挤穿），复核不过则批准失败、
// 版本退 DRAFT。
//
// 批准落地漏斗（波一三原则）：版本行翻转（单条 updateMany 自成原子）→ 审计 → 全员发信。
// 持久物先于信号；横切写服务（通知）在翻转 resolve 之后才调；通知边界吞错——它是旁路
// 副作用，NotificationsService 自己只吞单客户粒度，其 findMany 之类的整体失败仍会外抛，
// 这里不让它拖垮已经落地的发布。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { AgreementsReadService } from './agreements-read.service';

/** 协议变更须提前 30 日通知客户——VARA Rulebook Market Conduct II.A.7 / II.B.1.e。 */
export const NOTICE_PERIOD_DAYS = 30;
const NOTICE_PERIOD_MS = NOTICE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/** 批准时 30 天复核不过的退回，记进 AGREEMENT_PUBLISH_REJECTED.decision（与审批裁决原值并列的第四种结局）。 */
const NOTICE_PERIOD_SHORTFALL = 'NOTICE_PERIOD_SHORTFALL';

/** 开单时冻结进审批单的提案载荷：批的是什么就落的是什么。 */
interface AgreementPublishSnapshot {
  versionKey: string;
  effectiveAt: string;
}

@Injectable()
export class AgreementPublishWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogs: AuditLogsService,
    private readonly agreementsRead: AgreementsReadService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 提交发布：合规官为一个 DRAFT 版本填生效日，走 ApprovalsService 正门开高管单步审批
   * （铁律②）。前置全在开单前拦下（白开一张单不如提前拦）：版本须为 DRAFT、同一时刻至多一版
   * 在途（PENDING_APPROVAL/PUBLISHED）、生效日 ≥ 今天+30d。
   */
  async submitPublish(versionKey: string, effectiveAtIso: string, actor: ApprovalActorContext): Promise<{ approvalNo: string }> {
    // PUBLISHED 到点的翻转是懒翻：先翻一次，免得"已经生效却还停在 PUBLISHED"的旧版挡住新提交。
    await this.agreementsRead.tickEffective();

    const row = await this.prisma.customerAgreementVersion.findUnique({ where: { versionKey } });
    if (!row) throw new NotFoundException(`Customer agreement version ${versionKey} not found`);
    if (row.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT agreement versions can be submitted for publication (${versionKey} is ${row.status}).`,
      );
    }

    const inFlight = await this.prisma.customerAgreementVersion.findFirst({
      where: { status: { in: ['PENDING_APPROVAL', 'PUBLISHED'] } },
    });
    if (inFlight) {
      throw new BadRequestException(
        `Agreement version ${inFlight.versionKey} is already in flight (${inFlight.status}); ` +
          'only one version may be pending approval or in its notice period at a time.',
      );
    }

    // 锚一：提交预检。写成 !(>=) 而不是 (<)，无法解析的日期（NaN）同样落进拒绝分支。
    const effectiveAt = new Date(effectiveAtIso);
    const earliest = new Date(Date.now() + NOTICE_PERIOD_MS);
    if (!(effectiveAt.getTime() >= earliest.getTime())) {
      throw new BadRequestException(
        `Effective date must be at least ${NOTICE_PERIOD_DAYS} days from now ` +
          `(VARA Market Conduct II.A.7 notice period); earliest allowed is ${earliest.toISOString()}.`,
      );
    }

    const traceId = randomUUID();
    const snapshot: AgreementPublishSnapshot = { versionKey, effectiveAt: effectiveAt.toISOString() };
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.AGREEMENT_PUBLISH,
        entityRef: versionKey,
        traceId,
        objectSnapshot: { ...snapshot },
      },
      { reason: `Publish customer agreement ${versionKey}, effective ${snapshot.effectiveAt}`, traceId },
      actor,
    );

    await this.transition(versionKey, 'DRAFT', 'PENDING_APPROVAL', {
      effectiveAt,
      pendingApprovalNo: approvalCase.approvalNo,
    });

    const display = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        ...this.buildAuditInput(
          AuditActions.AGREEMENT_PUBLISH_SUBMITTED,
          versionKey,
          `Submitted customer agreement ${versionKey} for publication, effective ${snapshot.effectiveAt}`,
          { effectiveAt: snapshot.effectiveAt, approvalNo: approvalCase.approvalNo },
        ),
        sourcePlatform: 'ADMIN',
      },
      { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: actor.roleCodes ?? [] },
    );

    return { approvalNo: approvalCase.approvalNo };
  }

  /**
   * 裁决落地。APPROVED → 批准时刻复核 30 天，过则翻 PUBLISHED 并发信，不过则退 DRAFT；
   * DECLINED/CANCELLED/EXPIRED → 退 DRAFT。退回的版本回到可再次提交的起点。
   */
  @OnEvent(DOMAIN_EVENTS.AGREEMENT_PUBLISH_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    const versionKey = event.entityRef;

    if (event.decision !== 'APPROVED') {
      await this.revertToDraft(versionKey, event.approvalNo, event.decision);
      return;
    }

    const snapshot = await this.fetchApprovedSnapshot(event.approvalNo);
    const effectiveAt = new Date(snapshot.effectiveAt);
    const decidedAt = event.decidedAt ? new Date(event.decidedAt) : new Date();

    // 锚二：批准复核，以批准时刻为起点。
    if (!(effectiveAt.getTime() >= decidedAt.getTime() + NOTICE_PERIOD_MS)) {
      await this.revertToDraft(versionKey, event.approvalNo, NOTICE_PERIOD_SHORTFALL, {
        effectiveAt: effectiveAt.toISOString(),
        decidedAt: decidedAt.toISOString(),
      });
      return;
    }

    await this.transition(versionKey, 'PENDING_APPROVAL', 'PUBLISHED', {
      effectiveAt,
      publishedAt: decidedAt,
      pendingApprovalNo: null,
    });

    await this.auditLogs.recordSystem({
      ...this.buildAuditInput(
        AuditActions.AGREEMENT_PUBLISHED,
        versionKey,
        `Customer agreement ${versionKey} approved and published, effective ${effectiveAt.toISOString()}`,
        { effectiveAt: effectiveAt.toISOString(), approvalNo: event.approvalNo },
      ),
      sourcePlatform: 'SYSTEM',
    });

    // 发信放在版本行翻转 + 审计都落定之后，且吞错：发布已经成立，通知失败不回滚它。
    try {
      await this.notifications.notifyAgreementPublished(versionKey, effectiveAt);
    } catch (err) {
      console.error(`[AgreementPublishWorkflowService] notifyAgreementPublished failed for ${versionKey}:`, err);
    }
  }

  /** PENDING_APPROVAL → DRAFT：清 pending、生效日置空（下次提交重填），留痕 REJECTED（actor=system）。 */
  private async revertToDraft(
    versionKey: string,
    approvalNo: string,
    decision: string,
    metadataExtra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.transition(versionKey, 'PENDING_APPROVAL', 'DRAFT', { effectiveAt: null, pendingApprovalNo: null });

    await this.auditLogs.recordSystem({
      ...this.buildAuditInput(
        AuditActions.AGREEMENT_PUBLISH_REJECTED,
        versionKey,
        `Customer agreement ${versionKey} publication returned to DRAFT (${decision})`,
        { decision, approvalNo },
        metadataExtra,
      ),
      sourcePlatform: 'SYSTEM',
    });
  }

  /** 版本状态边：出发态进 where，命中不是 1 行即显式抛错（非法跃迁，铁律④）。 */
  private async transition(
    versionKey: string,
    from: string,
    to: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { count } = await this.prisma.customerAgreementVersion.updateMany({
      where: { versionKey, status: from },
      data: { status: to, ...data },
    });
    if (count !== 1) {
      throw new BadRequestException(
        `Agreement version ${versionKey} is not ${from}: ${from} → ${to} is not a legal transition.`,
      );
    }
  }

  /**
   * 三码共用信封：primarySubject 恒为 AGREEMENT_VERSION/versionKey。必填字段顶层展开
   * （assertActionSpec 只查 input 顶层）+ metadata 镜像（照 T2 AGREEMENT_EFFECTIVE 先例）。
   */
  private buildAuditInput(
    action: string,
    versionKey: string,
    reason: string,
    fields: Record<string, unknown>,
    metadataExtra: Record<string, unknown> = {},
  ) {
    return {
      action,
      actionDomain: 'GOVERNANCE',
      category: AuditCategory.GOVERNANCE,
      workflowType: AuditBusinessWorkflowTypes.CUSTOMER_AGREEMENT,
      primarySubjectType: AuditEntityTypes.AGREEMENT_VERSION,
      primarySubjectNo: versionKey,
      subjects: [
        { subjectType: AuditEntityTypes.AGREEMENT_VERSION, subjectNo: versionKey, subjectRole: AuditSubjectRole.PRIMARY },
      ],
      reason,
      versionKey,
      ...fields,
      metadata: { versionKey, ...fields, ...metadataExtra },
      requestId: `${action}_${versionKey}_${randomUUID()}`,
    };
  }

  /** 按 approvalNo 精确查快照（同 RiReplacementWorkflowService / SanctionDispositionWorkflowService
   *  先例，白 9 判例）——不依赖"最新一条=本次"的时序假设。 */
  private async fetchApprovedSnapshot(approvalNo: string): Promise<AgreementPublishSnapshot> {
    const { items } = await this.approvalsService.list({
      actionType: ApprovalActionTypes.AGREEMENT_PUBLISH,
      approvalNo,
      status: ApprovalStatuses.APPROVED,
    });
    const snapshot = items[0]?.objectSnapshot as AgreementPublishSnapshot | null | undefined;
    if (!snapshot) {
      throw new Error(`Agreement publish ${approvalNo}: no APPROVED AGREEMENT_PUBLISH case with an objectSnapshot found`);
    }
    return snapshot;
  }
}
