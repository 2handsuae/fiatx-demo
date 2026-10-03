/**
 * 战役丙波一 T2：NotificationsService——订单终态/投诉里程碑 → 客户站内信（模拟邮件）。
 * 铁律①操作必留痕：每条落库的通知都配一条 NOTIFICATION_SENT 系统审计（recordSystem +
 * 显式 requestId=通知行 id，抄 regulatory-filing-sweep.service.ts:61 现场形状）。
 * tipping-off 红线：模板键查无即沉默（notification-templates.constant.ts 头注释），
 * 本服务不为未登记的键加 default 分支、不拼兜底文案。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../../modules/audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../modules/audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../modules/audit-logging/dto/audit-log.dto';
import { NotificationsGateway } from './notifications.gateway';
import { NOTIFICATION_TEMPLATES, NotificationTemplate, NotificationTemplateParams } from './notification-templates.constant';

export interface NotifyOwnerRef {
  customerId?: string;
  customerNo?: string;
}

/** T4 客户面出口形状（T8 前端按此调，见 task-4-brief 接口契约）。 */
export interface ClientNotificationItem {
  id: string;
  templateCode: string;
  title: string;
  body: string;
  channels: string[];
  relatedOrderType: string;
  relatedOrderNo: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface OrderNotifyInput {
  domain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
  orderNo: string;
  owner: NotifyOwnerRef;
  collapsedFrom: string;
  collapsedTo: string;
  amount?: string;
  assetCode?: string;
}

/** 订单域 → 审计主对象类型（AuditEntityTypes 现役三码，均已在词表登记）。 */
const ORDER_ENTITY_TYPE: Record<OrderNotifyInput['domain'], string> = {
  DEPOSIT: AuditEntityTypes.DEPOSIT_TRANSACTION,
  WITHDRAW: AuditEntityTypes.WITHDRAW_TRANSACTION,
  SWAP: AuditEntityTypes.SWAP_TRANSACTION,
};

/** 投诉 to 状态 → 模板码。键查无即沉默——同模板登记处纪律，禁止加 default 分支。 */
const COMPLAINT_TEMPLATE_BY_TO: Record<string, string> = {
  ACKNOWLEDGED: 'COMPLAINT_ACKNOWLEDGED',
  INVESTIGATING_EXTENDED: 'COMPLAINT_EXTENDED',
  RESOLVED: 'COMPLAINT_RESOLVED',
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /**
   * collapse 不变 → 不动作。collapse 变化 → 客户端信号恒发（哪怕没有具体消息，前端也要
   * 知道该刷新了）；命中模板才渲染落库 + 审计。
   *
   * 评审 Important（控制器裁定）：通知是交易主流程的旁路副作用，不得因为自己
   * 抛错拖垮调用方——调用方（如 approveDeposit）在这句之后还有落账/审计要做，
   * 通知层内部失败（resolveOwner 查无客户、prisma.create 挂等）不能让那些
   * 后置动作丢失。修在边界：整方法 try/catch，失败只 console.error，不再抛。
   * `notifyComplaintStatus` 同款处理，见下方——一处修护四域（充值/提现/兑换/
   * 投诉），不在每个调用点各包一层。
   *
   * T8 走查逮到的 Important（fix round 2）：耐久性次序——消息（customerNotification
   * 行 + NOTIFICATION_SENT 审计）是持久物，信号（socket 推送）只是尽力而为，前者不能
   * 死在后者手里。demo-lib 的 createApplicationContext() 脚本环境没有 `.listen()`，
   * `gateway.server` 为 null，emit 同步抛错；若信号排在落库前面，外层 try/catch 会把
   * "本该落库"的这条也一并吞掉——落库/审计必须先于信号完成，信号单独兜一层
   * try/catch（见 emitSignal），确保信号失败时已经写完的行与审计不受影响。
   */
  async notifyOrderStatusChange(input: OrderNotifyInput): Promise<void> {
    try {
      if (input.collapsedFrom === input.collapsedTo) return;

      const owner = await this.resolveOwner(input.owner);

      const templateCode = `${input.domain}_${input.collapsedTo}`;
      const template = NOTIFICATION_TEMPLATES[templateCode];
      if (!template) {
        this.emitSignal(owner.customerId, `notifyOrderStatusChange(no-template) ${input.domain} ${input.orderNo}`);
        return;
      }

      await this.send({
        ownerCustomerNo: owner.customerNo,
        templateCode,
        template,
        params: { orderNo: input.orderNo, amount: input.amount, assetCode: input.assetCode },
        entityType: ORDER_ENTITY_TYPE[input.domain],
        relatedOrderType: input.domain,
        relatedOrderNo: input.orderNo,
      });

      this.emitSignal(owner.customerId, `notifyOrderStatusChange ${input.domain} ${input.orderNo}`);
    } catch (err) {
      console.error(`[NotificationsService] notifyOrderStatusChange failed for ${input.domain} ${input.orderNo}:`, err);
    }
  }

  /**
   * to 命中登记表才动作；未命中（如 INVESTIGATING/RESOLUTION_PENDING 等中间态）静默跳过。
   * 评审 Important 修：命中即代表一次真实客户可见进展（方法签名不含 collapsedFrom，
   * "是否变化"已由调用方前置判断），同订单路径的"变了恒发"时机，补齐信号——下游铃铛
   * 未读数靠 customer.updated 刷新，不发信号=铃铛不亮。
   * fix round 2：信号次序同订单路径改到落库+审计之后，emitSignal 内部兜错。
   */
  async notifyComplaintStatus(input: { complaintNo: string; owner: NotifyOwnerRef; to: string }): Promise<void> {
    try {
      const templateCode = COMPLAINT_TEMPLATE_BY_TO[input.to];
      if (!templateCode) return;

      const owner = await this.resolveOwner(input.owner);
      const template = NOTIFICATION_TEMPLATES[templateCode];

      await this.send({
        ownerCustomerNo: owner.customerNo,
        templateCode,
        template,
        params: { orderNo: input.complaintNo },
        entityType: AuditEntityTypes.COMPLAINT,
        relatedOrderType: 'COMPLAINT',
        relatedOrderNo: input.complaintNo,
      });

      this.emitSignal(owner.customerId, `notifyComplaintStatus ${input.complaintNo}`);
    } catch (err) {
      console.error(`[NotificationsService] notifyComplaintStatus failed for ${input.complaintNo}:`, err);
    }
  }

  /**
   * 战役丙波三 T4：协议版本发布 → 全员 fanout。协议当事人是全体客户，不分 lifecycle，
   * 故 findMany 不带 where。边界吞错粒度 = 单客户（demo 尽力而为）：一个客户落库失败只
   * console.error，其余客户照发，方法不外抛——调用方（发布审批 workflow）在通知之后
   * 还有后置动作。落库+审计（send）先于信号，同上方耐久性次序约定。
   * 模板键查无即沉默（登记处头注释既有约定），不加 default 分支、不拼兜底文案。
   */
  async notifyAgreementPublished(versionKey: string, effectiveAt: Date): Promise<void> {
    const templateCode = 'AGREEMENT_PUBLISHED';
    const template = NOTIFICATION_TEMPLATES[templateCode];
    if (!template) return;

    const customers = await this.prisma.customerMain.findMany({ select: { id: true, customerNo: true } });

    for (const c of customers) {
      try {
        await this.send({
          ownerCustomerNo: c.customerNo,
          templateCode,
          template,
          // 本地日 YYYY-MM-DD（en-CA 恰产此格式）：页面 / 管理台显示的是本地日，UTC 日在时区
          // 偏移窗口内会差一天（UTC+4 下本地 11-03 00:00 = UTC 11-02 20:00）。
          params: { orderNo: versionKey, effectiveDate: new Intl.DateTimeFormat('en-CA').format(effectiveAt) },
          entityType: AuditEntityTypes.AGREEMENT_VERSION,
          relatedOrderType: 'AGREEMENT',
          relatedOrderNo: versionKey,
        });

        this.emitSignal(c.id, `notifyAgreementPublished ${versionKey}`);
      } catch (err) {
        console.error(`[NotificationsService] notifyAgreementPublished failed for ${versionKey} → ${c.customerNo}:`, err);
      }
    }
  }

  /**
   * 战役丙波四 T2：月结单发出 → 单客户站内信（模拟邮件）。方法整体 try/catch 吞错，
   * 调用方（月结单生成 sweep）在通知之后还有后置动作，通知失败不得拖垮它；
   * 落库+审计（send）先于信号，同 notifyOrderStatusChange 的耐久性次序约定。
   * 模板键查无即沉默（登记处头注释既有约定），不加 default 分支。
   */
  async notifyStatementIssued(input: { customerId: string; statementNo: string; periodMonth: string }): Promise<void> {
    try {
      const templateCode = 'STATEMENT_ISSUED';
      const template = NOTIFICATION_TEMPLATES[templateCode];
      if (!template) return;

      const owner = await this.resolveOwner({ customerId: input.customerId });

      await this.send({
        ownerCustomerNo: owner.customerNo,
        templateCode,
        template,
        params: { orderNo: input.statementNo, periodMonth: input.periodMonth },
        entityType: AuditEntityTypes.MONTHLY_STATEMENT,
        relatedOrderType: 'STATEMENT',
        relatedOrderNo: input.statementNo,
      });

      this.emitSignal(owner.customerId, `notifyStatementIssued ${input.statementNo}`);
    } catch (err) {
      console.error(`[NotificationsService] notifyStatementIssued failed for ${input.statementNo}:`, err);
    }
  }

  /** 战役丙波四 T2：资料请求办结 → 单客户站内信（模拟邮件）。形态同 notifyStatementIssued。 */
  async notifyDsrResolved(input: { customerId: string; requestNo: string }): Promise<void> {
    try {
      const templateCode = 'DSR_RESOLVED';
      const template = NOTIFICATION_TEMPLATES[templateCode];
      if (!template) return;

      const owner = await this.resolveOwner({ customerId: input.customerId });

      await this.send({
        ownerCustomerNo: owner.customerNo,
        templateCode,
        template,
        params: { orderNo: input.requestNo },
        entityType: AuditEntityTypes.DSR_REQUEST,
        relatedOrderType: 'DSR',
        relatedOrderNo: input.requestNo,
      });

      this.emitSignal(owner.customerId, `notifyDsrResolved ${input.requestNo}`);
    } catch (err) {
      console.error(`[NotificationsService] notifyDsrResolved failed for ${input.requestNo}:`, err);
    }
  }

  /**
   * 信号是尽力而为，单独兜错——绝不能让 emit 失败（如脚本环境无 `.listen()`，
   * `gateway.server` 为 null）连累调用方已经写完的持久行/审计。
   */
  private emitSignal(customerId: string, context: string): void {
    try {
      this.gateway.emitCustomerUpdated(customerId);
    } catch (err) {
      console.error(`[NotificationsService] emitCustomerUpdated failed (${context}):`, err);
    }
  }

  /**
   * 战役丙波一 T4：客户面三读写方法。customerId 一律是 JWT payload.sub（内部 UUID），
   * 借 resolveOwner({customerId}) 查出 customerNo 再 where ownerCustomerNo——同一条查法，
   * 不在这三个方法里另起一份 customerMain.findUnique。
   */
  async listForCustomer(customerId: string, skip: number, take: number): Promise<{ items: ClientNotificationItem[]; total: number }> {
    const { customerNo } = await this.resolveOwner({ customerId });

    const [rows, total] = await Promise.all([
      this.prisma.customerNotification.findMany({
        where: { ownerCustomerNo: customerNo },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.customerNotification.count({ where: { ownerCustomerNo: customerNo } }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        templateCode: row.templateCode,
        title: row.title,
        body: row.body,
        channels: JSON.parse(row.channels),
        relatedOrderType: row.relatedOrderType,
        relatedOrderNo: row.relatedOrderNo,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  async unreadCountForCustomer(customerId: string): Promise<number> {
    const { customerNo } = await this.resolveOwner({ customerId });
    return this.prisma.customerNotification.count({ where: { ownerCustomerNo: customerNo, readAt: null } });
  }

  /**
   * 只许标自己的行；别人的号 / 不存在的号统一 404（不另建哨兵值，见 complaints 先例），
   * 404 路径在落库前就 throw，走不到下面的 emitSignal。
   *
   * T8 评审 Important 修：此前只写 readAt 不发信号——Bell 与 Messages 无共享态，
   * `CustomerDashboardLayout` 不随 Outlet 重挂，连续使用中铃铛恒偏高，要整页刷新
   * 才纠正。复用既有的 emitSignal 信号通道（同 notifyOrderStatusChange/
   * notifyComplaintStatus，尽力而为、内部自己兜错，不拖累已经写完的 readAt）。
   * 标已读仍不审计（控制器裁定不变，见 notifications.client.controller.ts 头注）。
   */
  async markReadForCustomer(customerId: string, notificationId: string): Promise<void> {
    const { customerNo } = await this.resolveOwner({ customerId });
    const row = await this.prisma.customerNotification.findFirst({
      where: { id: notificationId, ownerCustomerNo: customerNo },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Notification not found');

    await this.prisma.customerNotification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    this.emitSignal(customerId, `markReadForCustomer ${notificationId}`);
  }

  /** owner 至少给一半，查另一半补齐——customerId 用于 socket room，customerNo 是通知行的业务键。 */
  private async resolveOwner(owner: NotifyOwnerRef): Promise<{ customerId: string; customerNo: string }> {
    if (owner.customerId && owner.customerNo) {
      return { customerId: owner.customerId, customerNo: owner.customerNo };
    }
    if (owner.customerId) {
      const row = await this.prisma.customerMain.findUnique({
        where: { id: owner.customerId },
        select: { customerNo: true },
      });
      return { customerId: owner.customerId, customerNo: row!.customerNo };
    }
    const row = await this.prisma.customerMain.findUnique({
      where: { customerNo: owner.customerNo },
      select: { id: true },
    });
    return { customerId: row!.id, customerNo: owner.customerNo! };
  }

  /** 渲染定格落库（body 存串，改模板常量不回写已落库行）+ NOTIFICATION_SENT 系统审计。 */
  private async send(args: {
    ownerCustomerNo: string;
    templateCode: string;
    template: NotificationTemplate;
    params: NotificationTemplateParams;
    entityType: string;
    relatedOrderType: string;
    relatedOrderNo: string;
  }): Promise<void> {
    const channels = args.template.simulateEmail ? ['IN_APP', 'EMAIL_SIMULATED'] : ['IN_APP'];

    const created = await this.prisma.customerNotification.create({
      data: {
        ownerCustomerNo: args.ownerCustomerNo,
        templateCode: args.templateCode,
        title: args.template.title,
        body: args.template.body(args.params),
        channels: JSON.stringify(channels),
        relatedOrderType: args.relatedOrderType,
        relatedOrderNo: args.relatedOrderNo,
      },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.NOTIFICATION_SENT,
      actionDomain: 'CUSTOMER',
      category: AuditCategory.BUSINESS,
      primarySubjectType: args.entityType,
      primarySubjectNo: args.relatedOrderNo,
      ownerCustomerNo: args.ownerCustomerNo,
      subjects: [
        { subjectType: args.entityType, subjectNo: args.relatedOrderNo, subjectRole: AuditSubjectRole.PRIMARY },
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: args.ownerCustomerNo, subjectRole: AuditSubjectRole.OWNER },
      ],
      reason: `Notification ${args.templateCode} sent to customer ${args.ownerCustomerNo}`,
      // requiredFields=['templateCode','channels']（NOTIFICATION_SENT 词表声明）——assertActionSpec
      // 只查 input 顶层，故与 deadlineAt/causeCode 等先例一样顶层展开；metadata 另镜像一份供查询。
      templateCode: args.templateCode,
      channels,
      metadata: { templateCode: args.templateCode, channels },
      requestId: created.id,
      sourcePlatform: 'SYSTEM',
    } as any);
  }
}
