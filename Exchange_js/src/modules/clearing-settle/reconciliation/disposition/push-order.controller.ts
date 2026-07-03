import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { PushOrderService } from './push-order.service';
import { ManualPushDto } from '../dto/push-order.dto';

/**
 * 平账·推单处置端点（spec §1/§2）。同步腿查唯一外部回执自动推进；人工腿凭证据三件套强推。
 * 两端点都不直写账本——委托 PushOrderService 循环调 advance()，记账由事件链穿透（T2）。
 */
@ApiTags('Admin - Reconciliation Disposition (平账·推单)')
@ApiBearerAuth()
@Controller('admin/funds-orders')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PushOrderController {
  constructor(private readonly pushOrder: PushOrderService) {}

  @Post(':fundsOrderNo/push/sync')
  @ApiOperation({ summary: '推单·同步状态：查唯一外部回执并推进至终态（幂等安全）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/push/sync'))
  sync(@Param('fundsOrderNo') no: string, @Req() req: any) {
    const operatorId = req.user?.userNo || req.user?.sub || 'ADMIN';
    return this.pushOrder.syncPush(no, operatorId);
  }

  @Post(':fundsOrderNo/push/manual')
  @ApiOperation({ summary: '推单·人工确认：证据三件套强推至终态（审计人工标记）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/push/manual'))
  manual(@Param('fundsOrderNo') no: string, @Body() dto: ManualPushDto, @Req() req: any) {
    const operatorId = req.user?.userNo || req.user?.sub || 'ADMIN';
    return this.pushOrder.manualPush(no, operatorId, dto);
  }
}
