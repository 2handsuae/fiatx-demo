/**
 * 战役丙波三 T2：AgreementsReadService——客户协议的"读 + 同意台账 + 生效翻转"。
 *
 * 只依赖 Prisma + AuditLogsService，**不依赖 ApprovalsService**：本服务会被 CustomersModule
 * （能力闸 hasAcceptedCurrent）与 auth 模块（注册落同意）引用，发布审批链
 * （AgreementPublishWorkflowService，T3）依赖 ApprovalsModule，两者分居才能零依赖环。
 *
 * 铁律①：生效翻转 recordSystem、客户表态 recordByActor，各带显式 requestId（审计
 * idempotencyKey 含 primarySubjectNo=versionKey，缺 requestId 则同一版本的第二条会被静默去重；
 * 且 reset 不清审计表，故随机后缀避免跨重铺撞键）。
 * 铁律④：版本状态只沿 PUBLISHED→EFFECTIVE→SUPERSEDED 的边走，本服务是 EFFECTIVE 翻转的唯一写点。
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { AGREEMENT_BODIES, AgreementSection } from './agreement-versions.constant';

export type AgreementConsentAction = 'ACCEPTED' | 'DECLINED';
export type AgreementConsentSource = 'REGISTER' | 'MODAL' | 'PAGE';

export interface AgreementVersionView {
  versionKey: string;
  status: string;
  summary: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  /** 在途审批单号（仅 PENDING_APPROVAL 版有值；管理台详情链到审批页）。客户端视图不取此键。 */
  pendingApprovalNo: string | null;
  sections: AgreementSection[];
}

export interface AgreementConsentState {
  /** 本人最近一次 ACCEPTED 的版本与时刻（跨版本取最近，管理台客户详情"已同意 vX"用）。 */
  acceptedVersionKey: string | null;
  acceptedAt: Date | null;
  /** 当前生效版是否存在 ACCEPTED 行（闸与弹窗的唯一判据）。 */
  acceptedCurrent: boolean;
  /** 在途 PUBLISHED 版是否已被提前同意；无在途版恒 false。 */
  acceptedPending: boolean;
  /** 对当前生效版"暂不同意"的最近时刻；仅当 acceptedCurrent=false 时有值（后来同意了即视为拒绝已被覆盖）。 */
  declinedCurrentAt: Date | null;
}

@Injectable()
export class AgreementsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * 懒翻生效：发现 PUBLISHED 且 effectiveAt<=now 的版本即翻 EFFECTIVE，同事务把旧 EFFECTIVE
   * 退位 SUPERSEDED；事务 resolve 后才写 AGREEMENT_EFFECTIVE（actor=system）。公开——⚡快进
   * 把 effectiveAt 改写为当前时刻后直调本方法立即翻转；各读口开头也自调。
   */
  async tickEffective(): Promise<void> {
    const due = await this.prisma.customerAgreementVersion.findFirst({
      where: { status: 'PUBLISHED', effectiveAt: { lte: new Date() } },
    });
    if (!due) return;

    const previous = await this.prisma.customerAgreementVersion.findFirst({ where: { status: 'EFFECTIVE' } });

    // 数组形态事务按序执行：先退位旧版，再翻新版。
    await this.prisma.$transaction([
      this.prisma.customerAgreementVersion.updateMany({
        where: { status: 'EFFECTIVE' },
        data: { status: 'SUPERSEDED' },
      }),
      this.prisma.customerAgreementVersion.update({
        where: { id: due.id },
        data: { status: 'EFFECTIVE' },
      }),
    ]);

    await this.auditLogs.recordSystem({
      action: AuditActions.AGREEMENT_EFFECTIVE,
      actionDomain: 'GOVERNANCE',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.AGREEMENT_VERSION,
      primarySubjectNo: due.versionKey,
      subjects: [
        { subjectType: AuditEntityTypes.AGREEMENT_VERSION, subjectNo: due.versionKey, subjectRole: AuditSubjectRole.PRIMARY },
      ],
      reason: previous
        ? `Customer agreement ${due.versionKey} took effect, superseding ${previous.versionKey}`
        : `Customer agreement ${due.versionKey} took effect`,
      // requiredFields=['versionKey']（AGREEMENT_EFFECTIVE 词表声明）——assertActionSpec 只查
      // input 顶层，故顶层展开；metadata 另镜像一份供查询（照 NOTIFICATION_SENT 先例）。
      versionKey: due.versionKey,
      metadata: {
        versionKey: due.versionKey,
        supersededVersionKey: previous?.versionKey ?? null,
        effectiveAt: due.effectiveAt,
      },
      requestId: `${AuditActions.AGREEMENT_EFFECTIVE}_${due.versionKey}_${randomUUID()}`,
      sourcePlatform: 'SYSTEM',
    } as any);
  }

  async getCurrentEffective(): Promise<AgreementVersionView> {
    return this.toView(await this.findEffectiveRow());
  }

  /** 通知期在途版：PUBLISHED 且未到点（到点的已在 tick 里翻走）；无则 null。 */
  async getPendingPublished(): Promise<AgreementVersionView | null> {
    await this.tickEffective();
    const row = await this.prisma.customerAgreementVersion.findFirst({ where: { status: 'PUBLISHED' } });
    return row ? this.toView(row) : null;
  }

  /** 管理台版本列表：全部版本（含 DRAFT / 在途），按 versionKey 升序；读口惯例先懒翻。 */
  async listVersions(): Promise<AgreementVersionView[]> {
    await this.tickEffective();
    const rows = await this.prisma.customerAgreementVersion.findMany({ orderBy: { versionKey: 'asc' } });
    return rows.map((row) => this.toView(row));
  }

  /** 按版本取视图（管理台版本详情 / 阅读页对照用）；查无即 404。 */
  async getVersionView(versionKey: string): Promise<AgreementVersionView> {
    await this.tickEffective();
    const row = await this.prisma.customerAgreementVersion.findUnique({ where: { versionKey } });
    if (!row) throw new NotFoundException(`Customer agreement version ${versionKey} not found`);
    return this.toView(row);
  }

  /** 能力闸判据：当前生效版是否存在该客户的 ACCEPTED 行（DECLINED 行不算，先拒后同意算）。 */
  async hasAcceptedCurrent(customerId: string): Promise<boolean> {
    const current = await this.findEffectiveRow();
    const accepted = await this.prisma.customerAgreementConsent.findFirst({
      where: { customerId, versionKey: current.versionKey, action: 'ACCEPTED' },
    });
    return !!accepted;
  }

  /**
   * 落一行同意台账（append-only）+ 客户审计。versionKey 须属 {当前生效版, 在途 PUBLISHED 版}；
   * 在途版只收 ACCEPTED（通知期没有"拒绝"语义，生效前不表态即是）。
   */
  async recordConsent(
    customer: { customerId: string; customerNo: string },
    versionKey: string,
    action: AgreementConsentAction,
    source: AgreementConsentSource,
  ): Promise<void> {
    const current = await this.getCurrentEffective();
    const pending = await this.getPendingPublished();

    const isCurrent = versionKey === current.versionKey;
    const isPending = !!pending && versionKey === pending.versionKey;
    if (!isCurrent && !isPending) {
      throw new BadRequestException(`Agreement version ${versionKey} is not open for consent`);
    }
    if (action === 'DECLINED' && !isCurrent) {
      throw new BadRequestException('A version still in its notice period cannot be declined');
    }

    await this.prisma.customerAgreementConsent.create({
      data: {
        customerId: customer.customerId,
        customerNo: customer.customerNo,
        versionKey,
        action,
      },
    });

    const auditAction = action === 'ACCEPTED' ? AuditActions.AGREEMENT_ACCEPTED : AuditActions.AGREEMENT_DECLINED;
    await this.auditLogs.recordByActor(
      {
        action: auditAction,
        actionDomain: 'CUSTOMER',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.AGREEMENT_VERSION,
        primarySubjectNo: versionKey,
        ownerCustomerNo: customer.customerNo,
        subjects: [
          { subjectType: AuditEntityTypes.AGREEMENT_VERSION, subjectNo: versionKey, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customer.customerNo, subjectRole: AuditSubjectRole.OWNER },
        ],
        reason: `Customer ${customer.customerNo} ${action === 'ACCEPTED' ? 'accepted' : 'declined'} agreement ${versionKey} (${source})`,
        // requiredFields=['versionKey','source']——顶层展开 + metadata 镜像（同上）。
        versionKey,
        source,
        metadata: { versionKey, source },
        requestId: `${auditAction}_${customer.customerNo}_${versionKey}_${randomUUID()}`,
        sourcePlatform: 'CLIENT_API',
      } as any,
      {
        actorType: 'CUSTOMER',
        actorNo: customer.customerNo,
        actorDisplayName: customer.customerNo,
        actorRolesAtTime: ['CUSTOMER'],
      },
    );
  }

  /** 客户详情 / 弹窗横幅判据：五键一次取齐（全部从同意台账 + 当前/在途版本推出）。 */
  async consentStateFor(customerId: string): Promise<AgreementConsentState> {
    const current = await this.getCurrentEffective();
    const pending = await this.getPendingPublished();
    // 最近的在前：find 命中的第一行就是"最近一次"。
    const rows = await this.prisma.customerAgreementConsent.findMany({
      where: { customerId },
      orderBy: { actedAt: 'desc' },
    });

    const latestAccepted = rows.find((r) => r.action === 'ACCEPTED');
    const acceptedCurrent = rows.some((r) => r.action === 'ACCEPTED' && r.versionKey === current.versionKey);
    const acceptedPending = !!pending && rows.some((r) => r.action === 'ACCEPTED' && r.versionKey === pending.versionKey);
    const latestDeclinedCurrent = rows.find((r) => r.action === 'DECLINED' && r.versionKey === current.versionKey);

    return {
      acceptedVersionKey: latestAccepted?.versionKey ?? null,
      acceptedAt: latestAccepted?.actedAt ?? null,
      acceptedCurrent,
      acceptedPending,
      declinedCurrentAt: acceptedCurrent ? null : (latestDeclinedCurrent?.actedAt ?? null),
    };
  }

  /** 先懒翻再取当前生效行（hasAcceptedCurrent 只要 versionKey，不必拼正文）。 */
  private async findEffectiveRow() {
    await this.tickEffective();
    const row = await this.prisma.customerAgreementVersion.findFirst({ where: { status: 'EFFECTIVE' } });
    if (!row) throw new NotFoundException('No effective customer agreement version');
    return row;
  }

  private toView(row: {
    versionKey: string;
    status: string;
    summary: string;
    effectiveAt: Date | null;
    publishedAt: Date | null;
    pendingApprovalNo: string | null;
  }): AgreementVersionView {
    return {
      versionKey: row.versionKey,
      status: row.status,
      summary: row.summary,
      effectiveAt: row.effectiveAt,
      publishedAt: row.publishedAt,
      pendingApprovalNo: row.pendingApprovalNo,
      sections: AGREEMENT_BODIES[row.versionKey],
    };
  }
}
