import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
import { SanctionDispositionWorkflowService } from './sanction-disposition-workflow.service';
import { RESTRICTION_CAUSE_POLICY } from './constants/restriction-cause.constant';
import {
  OpenRestrictionDto,
  ReleaseRestrictionDto,
  SanctionDispositionDto,
} from './dto/customer-restriction.dto';

/**
 * 全局 ValidationPipe（main.ts:38）是 { transform, whitelist } —— 没有
 * forbidNonWhitelisted，多余键会被**静默剥掉**而不是报错。契约要求
 * visibility / releasePolicy 出现在 body 即 400（它们由 cause 派生，不许调用方指定），
 * 所以这两个 POST 单独挂一根更严的管子。
 */
const RESTRICTION_BODY_PIPE = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@ApiTags('Admin - Customer Restrictions')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustomerRestrictionsAdminController {
  constructor(
    private readonly restrictions: CustomerRestrictionsService,
    private readonly workflow: CustomerRestrictionWorkflowService,
    private readonly dispositionWorkflow: SanctionDispositionWorkflowService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ⚠️ 不可删。AdminPermissionGuard 对非 ADMIN token 是 fail-open ——
   * admin-permission.guard.ts:61 `if (user.type !== 'ADMIN') return true`，
   * 客户 JWT 打 admin 路由会被原样放行。仓库里有过四条 admin 路由漏这一句的事故，
   * 每个 handler 第一行就得 assertAdmin，且必须早于任何 DB 读。
   */
  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
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

  /** 对外合同是 customerNo（Rule 3），内部再换成 id 喂 domain service */
  private async resolveCustomerId(customerNo: string): Promise<string> {
    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerNo} not found`);
    }
    return customer.id;
  }

  @Get('customers/:customerNo/restrictions')
  @ApiOperation({ summary: '列一个客户的全部限制（含 SILENT、含已 RELEASED）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/restrictions'))
  async list(@Req() req: any, @Param('customerNo') customerNo: string) {
    this.assertAdmin(req);
    const customerId = await this.resolveCustomerId(customerNo);
    const rows = await this.restrictions.listAll(customerId);
    // 剥掉 customerId：调用方拿的就是 customerNo，回一个 UUID 只是把原始 ID 递到前端手上。
    return rows.map(({ customerId: _omit, ...rest }) => rest);
  }

  @Post('customers/:customerNo/restrictions')
  @ApiOperation({ summary: '贴便签：开一条客户限制，立即生效（不开审批）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/restrictions'))
  @UsePipes(RESTRICTION_BODY_PIPE)
  async open(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Body() dto: OpenRestrictionDto,
  ) {
    this.assertAdmin(req);

    if (dto.scopes !== undefined && !RESTRICTION_CAUSE_POLICY[dto.cause].scopeSelectable) {
      throw new BadRequestException({
        code: 'RESTRICTION_SCOPE_NOT_SELECTABLE',
        message: `Cause '${dto.cause}' has fixed scopes; 'scopes' must be omitted.`,
        details: {
          cause: dto.cause,
          defaultScopes: RESTRICTION_CAUSE_POLICY[dto.cause].defaultScopes,
        },
      });
    }

    const customerId = await this.resolveCustomerId(customerNo);
    const actor = this.buildAdminActor(req);
    return this.workflow.openRestriction(
      {
        customerId,
        cause: dto.cause,
        scopes: dto.scopes,
        reason: dto.reason,
        caseRef: dto.caseRef ?? null,
        // 存 userNo 不存 UUID：这一列直接进管理台限制表格的「谁贴的」，
        // 展示原始 ID 违反管理台约定（业务键优先）。
        openedBy: actor.userNo ?? actor.userId,
      },
      actor,
    );
  }

  @Post('customers/:customerNo/restrictions/:restrictionNo/release')
  @ApiOperation({
    summary: '发起人工解除：按 cause 的 releasePolicy 开 MLRO / OPS 审批案（此处不撕便签）',
  })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/customers/:customerNo/restrictions/:restrictionNo/release'),
  )
  @UsePipes(RESTRICTION_BODY_PIPE)
  async release(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Param('restrictionNo') restrictionNo: string,
    @Body() dto: ReleaseRestrictionDto,
  ) {
    this.assertAdmin(req);
    const customerId = await this.resolveCustomerId(customerNo);

    // 路径里的两个业务键必须自洽：别人的 restrictionNo 挂到本客户号下即 404
    const row = await this.restrictions.findByNo(restrictionNo);
    if (!row || row.customerId !== customerId) {
      throw new NotFoundException(
        `Restriction ${restrictionNo} not found for customer ${customerNo}`,
      );
    }

    return this.workflow.initiateRelease(restrictionNo, dto, this.buildAdminActor(req));
  }

  /**
   * 战役甲波三 T4：制裁定性提单——合规官对一张 OPEN 的 SANCTION 便签选定
   * CLEARED/PARTIAL/CONFIRMED 三出口之一，走 ApprovalsService 正门开 MLRO 单步审批
   * （铁律②门不可绕）。前置存在性校验（该客户须有 OPEN 的 SANCTION 便签）与三出口
   * 落地在 SanctionDispositionWorkflowService 里做，本端点只负责业务键换 id + 转发。
   */
  @Post('customers/:customerNo/sanction-disposition')
  @ApiOperation({
    summary: '提交制裁定性裁决（CLEARED/PARTIAL/CONFIRMED），走 MLRO 单步审批正门',
  })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/customers/:customerNo/sanction-disposition'),
  )
  @UsePipes(RESTRICTION_BODY_PIPE)
  async submitSanctionDisposition(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Body() dto: SanctionDispositionDto,
  ) {
    this.assertAdmin(req);
    return this.dispositionWorkflow.initiateDisposition(
      customerNo,
      dto.outcome,
      dto.summary,
      dto.externalCaseRef,
      this.buildAdminActor(req),
    );
  }
}
