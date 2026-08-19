import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject,
  NotFoundException, Param, Post, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { MaterialRequestsService, type MaterialRequestRow } from './material-requests.service';
import { MaterialRequestIssuerService } from './material-request-issuer.service';
import {
  IssueMaterialRequestDto, materialLabel, type AdminMaterialRequestRow,
} from './dto/material-request.dto';
import type { MaterialRequestOrderDomain } from './constants/material-request.constant';
import type { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
// 修 2 复用三域已导出的终态集合（同一份 material-request-order-cancel.listener.ts
// 已在用的写法）判定"非终态"，不新开一份重复定义、也不给 MaterialRequestsModule
// 添 DepositTransactionsModule/WithdrawTransactionsModule/SwapTransactionsModule
// 三条新的循环依赖边——这三个模块的 Service 类不注入这里，只借用它们各自导出的
// 只读常量 + 本控制器已有的 PrismaService。
import { DEPOSIT_TERMINAL_STATUSES } from '../../trading/deposit-transactions/deposit-transactions.service';
import { WITHDRAW_TERMINAL_STATUSES } from '../../trading/withdraw-transactions/withdraw-transactions.service';
import { SWAP_TERMINAL_STATUSES } from '../../trading/swap-transactions/swap-transactions.service';

const ORDER_DOMAINS: MaterialRequestOrderDomain[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

@ApiTags('Admin - Material Requests')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class MaterialRequestsAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly issuer: MaterialRequestIssuerService,
  ) {}

  @Get('customers/:customerNo/material-requests')
  @ApiOperation({ summary: '列一个客户的全部材料请求（含终态 —— 后台要全集）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/material-requests'))
  async listByCustomer(@Req() req: any, @Param('customerNo') customerNo: string) {
    this.assertAdmin(req);
    const customerId = await this.resolveCustomerId(customerNo);
    // G6：后台客户详情页那一列全是「露」，没有例外 —— 用 listAll 不是 listLive
    const rows = await this.requests.listAllByCustomer(customerId);
    return rows.map((r) => this.toAdminRow(r));
  }

  @Get('material-requests/by-order/:orderDomain/:orderRef')
  @ApiOperation({ summary: '列一个单上还活着的材料请求' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/material-requests/by-order/:orderDomain/:orderRef'),
  )
  async listByOrder(
    @Req() req: any,
    @Param('orderDomain') orderDomain: string,
    @Param('orderRef') orderRef: string,
  ) {
    this.assertAdmin(req);
    if (!ORDER_DOMAINS.includes(orderDomain as MaterialRequestOrderDomain)) {
      throw new BadRequestException(`Unknown order domain: ${orderDomain}`);
    }
    const rows = await this.requests.listLiveByOrder(
      orderDomain as MaterialRequestOrderDomain,
      orderRef,
    );
    return rows.map((r) => this.toAdminRow(r));
  }

  @Post('customers/:customerNo/material-requests')
  @ApiOperation({ summary: '下发材料：建 Sumsub action + 落账，可选同时摁住' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/material-requests'))
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  async issue(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Body() dto: IssueMaterialRequestDto,
  ) {
    this.assertAdmin(req);

    // spec I3：两列同空同非空。
    // 用 `== null` 同时覆盖 undefined 与显式 null —— @IsOptional() 对 body 里显式传的
    // null 直接放行不剥，只判 undefined 的话 {orderDomain: null, orderRef: 'DP1'} 会从
    // 这一层漏过去，一路打到 issuer 白白调一次 Sumsub 建 action，才被 create() 兜底
    // 拦下回滚。落不了脏数据，但多一次外部副作用。
    if ((dto.orderDomain == null) !== (dto.orderRef == null)) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_HALF_BOUND',
        message: 'orderDomain and orderRef must be supplied together',
      });
    }

    const customerId = await this.resolveCustomerId(customerNo);

    // 终审 Important #2：orderRef 是运营手打的自由文本，没有服务端校验。
    // 绑到已终态单（终态事件早过去了，作废监听器永不再触发）、绑到别人的单、
    // 或者号打错不存在——三种都会造出客户端零入口的孤儿行。这里按
    // (customerId, orderDomain, orderRef) 反查该客户名下的非终态订单，查不到
    // 就 400。
    if (dto.orderDomain && dto.orderRef) {
      await this.assertOrderBindable(customerId, dto.orderDomain, dto.orderRef);
    }

    const actor = this.buildAdminActor(req);

    return this.issuer.issue({
      customerId,
      materialType: dto.materialType,
      orderDomain: dto.orderDomain ?? null,
      orderRef: dto.orderRef ?? null,
      restrict: dto.restrict,
      restrictScopes: dto.restrictScopes,
      // G4：cause 不接受入参。运营只决定「摁不摁」，摁的名义永远是 PENDING_DOCUMENT
      // —— 让运营选 cause 就等于把 SANCTION 摆上台面，那是 tipping-off 的入口。
      origin: 'OPERATOR_ISSUED',
      reason: dto.reason,
      issuedBy: actor.userNo ?? actor.userId,
      actor,
    });
  }

  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin only');
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  /**
   * 修 2：orderRef 是运营手打的自由文本，查不到该客户名下这个 domain 的
   * 非终态订单就拒——绑到终态单 / 别人的单 / 打错号，都会在这里被截住，
   * 而不是落一行客户端看不到、运营以为发了的孤儿。
   */
  private async assertOrderBindable(
    customerId: string,
    orderDomain: MaterialRequestOrderDomain,
    orderRef: string,
  ): Promise<void> {
    const found = await this.findNonTerminalOrder(customerId, orderDomain, orderRef);
    if (!found) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_ORDER_NOT_BINDABLE',
        message:
          `No non-terminal ${orderDomain} order "${orderRef}" found for customer — ` +
          'it may not exist, may not belong to this customer, or may already be terminal',
      });
    }
  }

  private async findNonTerminalOrder(
    customerId: string,
    orderDomain: MaterialRequestOrderDomain,
    orderRef: string,
  ): Promise<{ id: string } | null> {
    switch (orderDomain) {
      case 'DEPOSIT':
        return this.prisma.depositTransaction.findFirst({
          where: {
            depositNo: orderRef,
            ownerId: customerId,
            status: { notIn: [...DEPOSIT_TERMINAL_STATUSES] },
          },
          select: { id: true },
        });
      case 'WITHDRAW':
        return this.prisma.withdrawTransaction.findFirst({
          where: {
            withdrawNo: orderRef,
            ownerId: customerId,
            status: { notIn: [...WITHDRAW_TERMINAL_STATUSES] },
          },
          select: { id: true },
        });
      case 'SWAP':
        return this.prisma.swapTransaction.findFirst({
          where: {
            swapNo: orderRef,
            ownerId: customerId,
            status: { notIn: [...SWAP_TERMINAL_STATUSES] },
          },
          select: { id: true },
        });
      default:
        return null;
    }
  }

  /** 对外合同是 customerNo（CLAUDE.md 铁律 3），内部再换 id 喂 domain service */
  private async resolveCustomerId(customerNo: string): Promise<string> {
    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${customerNo} not found`);
    return customer.id;
  }

  /** 剥掉 customerId 与 externalActionId：前者是原始 ID，后者是铸 token 的钥匙，都不该出后台列表 */
  private toAdminRow(r: MaterialRequestRow): AdminMaterialRequestRow {
    return {
      requestNo: r.requestNo,
      materialType: r.materialType,
      materialLabel: materialLabel(r.materialType),
      levelName: r.levelName,
      applicantActionId: r.applicantActionId,
      orderDomain: r.orderDomain,
      orderRef: r.orderRef,
      restrictionNo: r.restrictionNo,
      origin: r.origin,
      status: r.status,
      reason: r.reason,
      issuedBy: r.issuedBy,
      issuedAt: r.issuedAt,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      reviewAnswer: r.reviewAnswer,
      reviewRejectType: r.reviewRejectType,
      cancelReason: r.cancelReason,
    };
  }
}
