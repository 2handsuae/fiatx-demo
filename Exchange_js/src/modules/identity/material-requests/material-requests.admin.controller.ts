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

    // spec I3：两列同空同非空
    if ((dto.orderDomain === undefined) !== (dto.orderRef === undefined)) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_HALF_BOUND',
        message: 'orderDomain and orderRef must be supplied together',
      });
    }

    const customerId = await this.resolveCustomerId(customerNo);
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
