import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerAccessService, DisclosedRestrictionView } from './customer-access.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';

/**
 * 客户端读面。与 customer-pending-action.controller.ts 同前缀同守卫：
 * 客户端端点走 JwtAuthGuard，不加 AdminPermissionGuard、不进 RBAC catalog。
 *
 * 只吐 CustomerAccess.disclosed 一个字段。blocked / openCount 含 SILENT 的贡献，
 * 泄露即等于告诉被制裁客户"你被盯上了"（tipping-off），永远不出这个口子 ——
 * 这不是靠前端记得别渲染，是数据根本不发出去。
 */
@ApiTags('client/me')
@ApiBearerAuth()
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
export class CustomerRestrictionsClientController {
  constructor(
    private readonly access: CustomerAccessService,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  private extractCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }

  @Get('restrictions')
  @ApiOperation({ summary: '我的限制：仅 DISCLOSED，SILENT 一律不出现（含制裁客户恒空数组）' })
  async list(@Req() req: any): Promise<DisclosedRestrictionView[]> {
    const customerId = this.extractCustomer(req);
    const access = await this.access.resolve(customerId);

    // 回填「这张便签是否已被某条活着的材料请求认领」。同一件事出两条横幅
    // （一条「你被摁住了」+ 一条「去交材料」）是重复，客户面只留带入口的那条。
    // 判定在这儿做而不是在前端：横幅组件的既定约束是只渲染后端给的字段、
    // 不自己推导显示条件。也不在 resolve() 里做 —— 它同时服务执法侧，
    // 为一个展示决策依赖材料账会引入模块环。
    const live = await this.materialRequests.listLiveByCustomer(customerId);
    const claimedBy = new Map(
      live.filter((r) => r.restrictionNo).map((r) => [r.restrictionNo as string, { requestNo: r.requestNo, status: r.status }]),
    );
    return access.disclosed.map((row) => {
      const claim = claimedBy.get(row.restrictionNo);
      return {
        ...row,
        claimedByMaterialRequestNo: claim?.requestNo ?? null,
        claimedMaterialStatus: (claim?.status as 'PENDING_SUBMISSION' | 'SUBMITTED' | undefined) ?? null,
      };
    });
  }
}
