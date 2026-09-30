// 战役乙波三 T1 · 审慎地基：只读 status 端点，归既有桶 treasury.view_dashboard 的组
// FUNDING_DASHBOARD_VIEW（金库/CFO/高管/内审四职务本就持有，零权限扩张）。
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { PrudentialService } from './prudential.service';

@ApiTags('Admin - Prudential')
@ApiBearerAuth()
@Controller('admin/prudential')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PrudentialController {
  constructor(private readonly prudential: PrudentialService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get the current NLA prudential status (per-asset F_OPS balances converted to AED, floor, headroom)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/prudential/status'))
  status() {
    return this.prudential.computeStatus();
  }
}
