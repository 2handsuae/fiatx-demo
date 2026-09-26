// 战役甲波三 T4 · 制裁定性三出口 workflow（spec §2 B 线、§4）。
//
// 铁律③各管各的：本 workflow 横向只调三个主体各自的服务方法——
//   - 限制便签：CustomerRestrictionsService.open()/release()/findOpenByCause()/findByNo()
//     （不走 CustomerRestrictionWorkflowService.initiateRelease/autoRelease——CLEARED 出口
//     是定性审批本身已经完成的 maker-checker，不该再叠一层解除审批；也不是"机制自动撕"，
//     releaseMode 必须落 MANUAL + releaseApprovalNo=定性单号。照 onReleaseDecided
//     [customer-restriction-workflow.service.ts:191-240] 的落地形状自写审计，同一套
//     "workflow 直调主体服务方法" 范式，只是这次由本 workflow 而非
//     CustomerRestrictionWorkflowService 来做）。
//   - 报送单：RegulatoryFilingService.openForSanction()（T3 交付，本任务不改）。
//   - 补料：MaterialRequestIssuerService.issue()（既有下发编排入口）。
// 不直写任何表。
//
// ⚠️ actor 口径（T3 评审白3 交接）：openForSanction 的门按
// hasPermission(userId, 'cap.filing.aml') 查——落地时 actor 必须用审批裁决人（MLRO）的
// 真实 userId（ApprovalDecidedEvent.decisionByUserId），不能用 userNo、不能用 SYSTEM，
// 否则 403 且发生在便签已翻之后留半落地。requestId 全链同值串起限制写入与开单写入。
import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditActorContext, AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { DOMAIN_EVENTS } from '../../../common/events/domain-events.constants';
import { RegulatoryFilingService } from '../../governance/regulatory-filings/regulatory-filing.service';
import { MaterialRequestIssuerService } from '../material-requests/material-request-issuer.service';
import { CustomerRestrictionsService, RestrictionRow } from './customer-restrictions.service';

export type SanctionDispositionOutcome = 'CLEARED' | 'PARTIAL' | 'CONFIRMED';

const OUTCOMES: readonly SanctionDispositionOutcome[] = ['CLEARED', 'PARTIAL', 'CONFIRMED'];

interface DispositionSnapshot {
  customerNo: string;
  restrictionNo: string;
  outcome: SanctionDispositionOutcome;
  summary: string;
  externalCaseRef: string;
}

/** PARTIAL 出口的中性补料——不点破制裁排查，照 material-request-issuer 既有用法：
 * 身份证件复核用于排除/坐实姓名部分命中，是唯一在场景上说得通、且已在物料策略里
 * 注册过的材料类型（config/material-refresh-policy.json）。 */
const PARTIAL_MATERIAL_TYPE = 'EMIRATES_ID';
const PARTIAL_MATERIAL_REASON =
  'Additional identity verification is required to complete an ongoing account review.';

@Injectable()
export class SanctionDispositionWorkflowService {
  private readonly logger = new Logger(SanctionDispositionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: CustomerRestrictionsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly filings: RegulatoryFilingService,
    private readonly materialRequestIssuer: MaterialRequestIssuerService,
  ) {}

  /**
   * 提单：合规官对一张 OPEN 的 SANCTION 便签定性，走 ApprovalsService 正门开单
   * （铁律②门不可绕）。前置：该客户必须有 OPEN 的 SANCTION 便签（命中待裁）——
   * SANCTION 是 customerLevel 因由，caseRef 已在 open() 时归一成 customerNo，
   * 故按 (customerId, 'SANCTION', caseRef=null 即不限) 查最早一张即可（spec §4）。
   * 支持二次定性：PARTIAL 出口维持该便签 OPEN，同一张便签可以再次被定性提单
   * （据 EOCN 指令定 CLEARED 或 CONFIRMED）。
   */
  async initiateDisposition(
    customerNo: string,
    outcome: SanctionDispositionOutcome,
    summary: string,
    externalCaseRef: string,
    actor: ApprovalActorContext,
  ): Promise<{ approvalNo: string; restrictionNo: string }> {
    if (!OUTCOMES.includes(outcome)) {
      throw new BadRequestException(`Unknown sanction disposition outcome: ${outcome}`);
    }
    if (!summary?.trim()) throw new BadRequestException('Disposition summary is required');
    if (!externalCaseRef?.trim()) throw new BadRequestException('Disposition externalCaseRef is required');

    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerNo}`);

    const restriction = await this.restrictions.findOpenByCause(customer.id, 'SANCTION', null);
    if (!restriction) {
      throw new BadRequestException(
        `Customer ${customerNo} has no OPEN SANCTION restriction to dispose of`,
      );
    }

    const traceId = restriction.traceId || randomUUID();
    const snapshot: DispositionSnapshot = {
      customerNo,
      restrictionNo: restriction.restrictionNo,
      outcome,
      summary,
      externalCaseRef,
    };
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.SANCTION_DISPOSITION,
        entityRef: customerNo,
        traceId,
        objectSnapshot: snapshot as unknown as Record<string, unknown>,
      },
      { reason: summary, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SANCTION_DISPOSITION_REQUESTED,
        actionDomain: 'CUSTOMER',
        primarySubjectType: AuditEntityTypes.CUSTOMER,
        primarySubjectNo: customerNo,
        ownerCustomerNo: customerNo,
        subjects: [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: 'PRIMARY' as any }],
        traceId,
        outcome: AuditOutcome.SUCCESS,
        reason: summary,
        approvalNo: approvalCase.approvalNo,
        metadata: {
          outcome,
          restrictionNo: restriction.restrictionNo,
          externalCaseRef,
        },
        requestId: `SANCTION_DISPOSITION_REQUESTED_${approvalCase.approvalNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { approvalNo: approvalCase.approvalNo, restrictionNo: restriction.restrictionNo };
  }

  /**
   * 裁决落地。拒绝（DECLINED/CANCELLED/EXPIRED）= 维持待裁，只留审计，SANCTION 便签
   * 原样 OPEN——不撤票不改任何状态。APPROVED 才按 objectSnapshot 记的 outcome 三选一落地。
   */
  @OnEvent(DOMAIN_EVENTS.SANCTION_DISPOSITION_DECIDED.name, { async: true })
  async onDecided(event: ApprovalDecidedEvent): Promise<void> {
    const decisionActor = this.decisionAuditActor(event);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SANCTION_DISPOSITION_DECIDED,
        actionDomain: 'CUSTOMER',
        primarySubjectType: AuditEntityTypes.CUSTOMER,
        primarySubjectNo: event.entityRef,
        ownerCustomerNo: event.entityRef,
        subjects: [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: event.entityRef, subjectRole: 'PRIMARY' as any }],
        traceId: event.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason: event.decisionReason ?? event.decision,
        approvalNo: event.approvalNo,
        metadata: { decision: event.decision },
        requestId: `SANCTION_DISPOSITION_DECIDED_${event.approvalNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      decisionActor,
    );

    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Sanction disposition for ${event.entityRef} ${event.decision} (case ${event.approvalNo}) ` +
          '— SANCTION restriction stays OPEN, nothing landed.',
      );
      return;
    }

    const snapshot = await this.fetchApprovedSnapshot(event.entityRef);
    const restrictionRow = await this.restrictions.findByNo(snapshot.restrictionNo);
    if (!restrictionRow) {
      throw new Error(
        `Sanction disposition ${event.entityRef}: approved case references missing restriction ${snapshot.restrictionNo}`,
      );
    }

    // ⚠️ 真实 MLRO userId（不是 userNo、不是 SYSTEM）——openForSanction 的族门按
    // hasPermission(userId, 'cap.filing.aml') 查，见文件头注释。
    const landingActor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: event.decisionByUserId || '',
      userNo: event.decisionByUserNo || undefined,
      role: event.decisionByRole || undefined,
      roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
    };
    const requestId = `SANCTION_DISPOSITION_LANDED_${event.approvalNo}_${randomUUID()}`;

    let landedMeta: Record<string, unknown>;
    switch (snapshot.outcome) {
      case 'CLEARED':
        landedMeta = await this.landCleared(snapshot, event.approvalNo, decisionActor, requestId);
        break;
      case 'PARTIAL':
        landedMeta = await this.landPartial(snapshot, restrictionRow, requestId, landingActor);
        break;
      case 'CONFIRMED':
        landedMeta = await this.landConfirmed(
          snapshot,
          restrictionRow,
          event.approvalNo,
          decisionActor,
          requestId,
          landingActor,
        );
        break;
      default:
        throw new Error(
          `Sanction disposition ${event.entityRef}: unknown outcome "${snapshot.outcome}" in objectSnapshot`,
        );
    }

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SANCTION_DISPOSITION_LANDED,
        actionDomain: 'CUSTOMER',
        primarySubjectType: AuditEntityTypes.CUSTOMER,
        primarySubjectNo: event.entityRef,
        ownerCustomerNo: event.entityRef,
        subjects: [{ subjectType: AuditEntityTypes.CUSTOMER, subjectNo: event.entityRef, subjectRole: 'PRIMARY' as any }],
        traceId: event.traceId,
        outcome: AuditOutcome.SUCCESS,
        reason: `Sanction disposition ${snapshot.outcome} landed`,
        approvalNo: event.approvalNo,
        metadata: { outcome: snapshot.outcome, ...landedMeta },
        requestId,
        sourcePlatform: 'ADMIN_API',
      },
      decisionActor,
    );
  }

  /**
   * CLEARED：直调限制解除执行——releaseMode=MANUAL、releaseApprovalNo=定性审批单号
   * （"哪张定性单解的冻"可反查，铁律①）。不走 initiateRelease 手工链（其政府解除令
   * 必填闸只适用手工路径），也不用 SYSTEM-actor autoRelease（这是一次真实的、有名有姓
   * 的裁决落地，不是机制自动触发）。
   */
  private async landCleared(
    snapshot: DispositionSnapshot,
    approvalNo: string,
    decisionActor: AuditActorContext,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    await this.restrictions.release(snapshot.restrictionNo, {
      releasedBy: decisionActor.actorNo,
      releaseMode: 'MANUAL',
      releaseApprovalNo: approvalNo,
    });

    // 照 onReleaseDecided [customer-restriction-workflow.service.ts:228-239, 313-340]
    // 的落地形状自写审计——CustomerRestrictionsService.release() 内部已经写了一条
    // SYSTEM 通道的机械审计，这里额外补一条真实裁决人（MLRO）通道的审计，
    // 把"谁批的、哪张定性单批的"钉死在 CUSTOMER_RESTRICTION_CLEARED/CUSTOMER_UNFROZEN
    // 两条码上（同一套码，两个通道，各自留痕，非重复）。
    const subjects = [
      { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: snapshot.customerNo, subjectRole: 'PRIMARY' as any },
    ];
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.CUSTOMER_RESTRICTION_CLEARED,
        actionDomain: 'CUSTOMER',
        primarySubjectType: AuditEntityTypes.CUSTOMER,
        primarySubjectNo: snapshot.customerNo,
        ownerCustomerNo: snapshot.customerNo,
        subjects,
        outcome: AuditOutcome.SUCCESS,
        reason: `SANCTION restriction ${snapshot.restrictionNo} released via sanction disposition CLEARED (approval ${approvalNo})`,
        approvalNo,
        metadata: { restrictionNo: snapshot.restrictionNo, releaseMode: 'MANUAL' },
        requestId,
        sourcePlatform: 'ADMIN_API',
      },
      decisionActor,
    );
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.CUSTOMER_UNFROZEN,
        actionDomain: 'CUSTOMER',
        primarySubjectType: AuditEntityTypes.CUSTOMER,
        primarySubjectNo: snapshot.customerNo,
        ownerCustomerNo: snapshot.customerNo,
        subjects,
        outcome: AuditOutcome.SUCCESS,
        reason: `Customer unfrozen — SANCTION restriction ${snapshot.restrictionNo} released via sanction disposition CLEARED (approval ${approvalNo})`,
        approvalNo,
        metadata: { restrictionNo: snapshot.restrictionNo, releaseMode: 'MANUAL' },
        requestId: `${requestId}_UNFROZEN`,
        sourcePlatform: 'ADMIN_API',
      },
      decisionActor,
    );

    return { restrictionNo: snapshot.restrictionNo, releaseApprovalNo: approvalNo };
  }

  /**
   * PARTIAL：维持 SILENT 便签（原样 OPEN，不碰）＋开 PNMR（锚＝SANCTION 便签
   * openedAt，官方口径"自暂停起算"）＋经 material-request-issuer 自动发中性补料。
   */
  private async landPartial(
    snapshot: DispositionSnapshot,
    restrictionRow: RestrictionRow,
    requestId: string,
    landingActor: ApprovalActorContext,
  ): Promise<Record<string, unknown>> {
    const { filingNo } = await this.filings.openForSanction(
      'PNMR',
      snapshot.customerNo,
      snapshot.externalCaseRef,
      restrictionRow.openedAt,
      requestId,
      landingActor,
    );

    const { requestNo } = await this.materialRequestIssuer.issue({
      customerId: restrictionRow.customerId,
      materialType: PARTIAL_MATERIAL_TYPE,
      orderDomain: null,
      orderRef: null,
      // SILENT SANCTION 便签已经卡住全部能力（scope=ALL），补料不重复摁一张——
      // 与 CustomerRestrictionsAdminController 里"cause 不接受入参"的口径一致，
      // 这里更进一步：连便签都不开，纯粹只是发一份中性话术的补料请求。
      restrict: false,
      origin: 'OPERATOR_ISSUED',
      reason: PARTIAL_MATERIAL_REASON,
      issuedBy: landingActor.userNo ?? landingActor.userId,
      actor: landingActor,
    });

    return { restrictionNo: snapshot.restrictionNo, filingNo, materialRequestNo: requestNo };
  }

  /**
   * CONFIRMED：SILENT SANCTION 便签解列＋开 SANCTION_CONFIRMED 便签（同一 workflow
   * 原子落地——两张便签同一事务）＋开 CNMR（锚同上，官方口径"自冻结起算"）。
   */
  private async landConfirmed(
    snapshot: DispositionSnapshot,
    restrictionRow: RestrictionRow,
    approvalNo: string,
    decisionActor: AuditActorContext,
    requestId: string,
    landingActor: ApprovalActorContext,
  ): Promise<Record<string, unknown>> {
    const releasedBy = decisionActor.actorNo;
    let newRestrictionNo = '';
    await this.prisma.$transaction(async (tx: Record<string, any>) => {
      await this.restrictions.release(
        snapshot.restrictionNo,
        { releasedBy, releaseMode: 'MANUAL', releaseApprovalNo: approvalNo },
        tx,
      );
      const opened = await this.restrictions.open(
        {
          customerId: restrictionRow.customerId,
          cause: 'SANCTION_CONFIRMED',
          reason: `Sanction confirmed via disposition ${approvalNo}`,
          caseRef: null,
          openedBy: releasedBy,
        },
        tx,
      );
      newRestrictionNo = opened.restrictionNo;
    });

    const { filingNo } = await this.filings.openForSanction(
      'CNMR',
      snapshot.customerNo,
      snapshot.externalCaseRef,
      restrictionRow.openedAt,
      requestId,
      landingActor,
    );

    return {
      previousRestrictionNo: snapshot.restrictionNo,
      restrictionNo: newRestrictionNo,
      filingNo,
    };
  }

  private async fetchApprovedSnapshot(customerNo: string): Promise<DispositionSnapshot> {
    const { items } = await this.approvalsService.list({
      actionType: ApprovalActionTypes.SANCTION_DISPOSITION,
      entityRef: customerNo,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    } as any);
    const snapshot = items[0]?.objectSnapshot as DispositionSnapshot | null | undefined;
    if (!snapshot) {
      throw new Error(
        `Sanction disposition ${customerNo}: no APPROVED SANCTION_DISPOSITION case with an objectSnapshot found`,
      );
    }
    return snapshot;
  }

  /** 与 deposit/withdraw/restriction workflow 逐字同款的 actor 投影。 */
  private toAuditActor(actor: ApprovalActorContext): AuditActorContext {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || actor.userId,
      actorDisplayName: actor.userNo || actor.userId,
      actorRolesAtTime: actor.roleCodes?.length ? actor.roleCodes : [actor.role || 'UNKNOWN'],
    };
  }

  /** ApprovalDecidedEvent 的裁决人投影——同 CustomerRestrictionWorkflowService
   * .onReleaseDecided 的写法一致（decisionByUserNo 优先，取不到落 decisionByUserId）。 */
  private decisionAuditActor(event: ApprovalDecidedEvent): AuditActorContext {
    const display = event.decisionByUserNo || event.decisionByUserId || 'UNKNOWN';
    return {
      actorType: 'ADMIN',
      actorNo: display,
      actorDisplayName: display,
      actorRolesAtTime: [event.decisionByRole || 'MLRO'],
    };
  }
}
