/**
 * 战役丙波一 T2：NotificationsService——订单终态/投诉里程碑 → 客户站内信（模拟邮件）。
 * 铁律①操作必留痕：每条落库的通知都配一条 NOTIFICATION_SENT 系统审计（recordSystem +
 * 显式 requestId=通知行 id，抄 regulatory-filing-sweep.service.ts:61 现场形状）。
 * tipping-off 红线：模板键查无即沉默（notification-templates.constant.ts 头注释），
 * 本服务不为未登记的键加 default 分支、不拼兜底文案。
 */
import { Injectable } from '@nestjs/common';
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
   */
  async notifyOrderStatusChange(input: OrderNotifyInput): Promise<void> {
    if (input.collapsedFrom === input.collapsedTo) return;

    const owner = await this.resolveOwner(input.owner);
    this.gateway.emitCustomerUpdated(owner.customerId);

    const templateCode = `${input.domain}_${input.collapsedTo}`;
    const template = NOTIFICATION_TEMPLATES[templateCode];
    if (!template) return;

    await this.send({
      ownerCustomerNo: owner.customerNo,
      templateCode,
      template,
      params: { orderNo: input.orderNo, amount: input.amount, assetCode: input.assetCode },
      entityType: ORDER_ENTITY_TYPE[input.domain],
      relatedOrderType: input.domain,
      relatedOrderNo: input.orderNo,
    });
  }

  /**
   * to 命中登记表才动作；未命中（如 INVESTIGATING/RESOLUTION_PENDING 等中间态）静默跳过。
   * 评审 Important 修：命中即代表一次真实客户可见进展（方法签名不含 collapsedFrom，
   * "是否变化"已由调用方前置判断），同订单路径的"变了恒发"时机，补齐信号——下游铃铛
   * 未读数靠 customer.updated 刷新，不发信号=铃铛不亮。
   */
  async notifyComplaintStatus(input: { complaintNo: string; owner: NotifyOwnerRef; to: string }): Promise<void> {
    const templateCode = COMPLAINT_TEMPLATE_BY_TO[input.to];
    if (!templateCode) return;

    const owner = await this.resolveOwner(input.owner);
    this.gateway.emitCustomerUpdated(owner.customerId);

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
