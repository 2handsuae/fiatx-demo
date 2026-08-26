import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions, AuditEntityTypes, AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../audit-logging/dto/audit-log.dto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CustomersService } from '../identity/customers/customers.service';
import { MaterialRequestsService } from '../identity/material-requests/material-requests.service';

/**
 * 兑换域对 applicantActionReviewed 的**唯一剩余职责**：
 * 记录「这个客户的补料 GREEN 过，但因为他被硬线处置过，限制被刻意保留」。
 *
 * 2026-08-17 材料请求账之前，本 handler 还负责清 pendingAction 指针、
 * resetSubmission、决定撕不撕限制 —— 那些现在统一在
 * MaterialRequestReviewService（Task 4）里做，三个域一套逻辑。
 * 留在这里的只有这条审计：调查员需要能查到「GREEN 到过、被刻意没解锁」，
 * 而那个判断依据（hardLineDispositionedAt）是兑换域独有的。
 */
@Injectable()
export class SwapApplicantActionHandler {
  private readonly logger = new Logger(SwapApplicantActionHandler.name);

  constructor(
    // 与 MaterialRequestsService / MaterialRequestIssuerService 同款坑：交叉类型
    // `PrismaService & Record<string, any>` 在 emitDecoratorMetadata 下会被擦成
    // 裸 `Object`，Nest 靠隐式反射解析不出注入令牌，运行时
    // UnknownDependenciesException（单测走 `new Service(...)` 直接构造，绕过 DI
    // 容器，测不出这个坑）。显式 @Inject(PrismaService) 兜底。
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly customersService: CustomersService,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  /** 由 MaterialRequestReviewService 在 GREEN 落地后回调；非兑换域的行直接返回。 */
  async noteHardLineHeld(requestNo: string): Promise<void> {
    const row = await this.materialRequests.findByNo(requestNo);
    if (!row || row.orderDomain !== 'SWAP') return;

    const hardLined = await this.customersService.hasHardLineDisposition(row.customerId);
    if (!hardLined) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: row.customerId },
      select: { customerNo: true },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_ACTION_GREEN_HARDLINE_HELD,
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: customer?.customerNo || undefined,
      outcome: AuditOutcome.SUCCESS,
      reason:
        `Material request ${requestNo} reviewed GREEN, but this customer carries a sticky ` +
        'hard-line disposition — restrictions deliberately held. Recorded so an investigator ' +
        'can verify the GREEN was seen and consciously not acted on.',
      metadata: { requestNo, orderRef: row.orderRef },
      sourcePlatform: 'SYSTEM',
    });
  }
}
