import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerAccessService, DisclosedRestrictionView } from './customer-access.service';

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
  constructor(private readonly access: CustomerAccessService) {}

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
    return access.disclosed;
  }
}
