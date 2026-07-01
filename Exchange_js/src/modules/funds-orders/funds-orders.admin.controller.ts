import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../identity/access-control/permission-code.util';
import { FundsOrderService } from './funds-order.service';
import { FundsOrdersAdminQueryDto } from './dto/funds-orders-admin-query.dto';

/**
 * Unified funds-orders admin read surface (C6).
 *
 * Replaces the three legacy admin surfaces (payins, payouts, internal-funds).
 * A funds_order carries whichever parent FK is set — deposit (payin),
 * withdraw (payout + fee leg), or swap (leg) — and the list is filtered by
 * that virtual `parent` bucket. Reads only; the deposit/withdraw/swap
 * workflows own state transitions.
 */
@ApiTags('Admin - Funds Orders')
@Controller('admin/funds-orders')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FundsOrdersAdminController {
  constructor(private readonly fundsOrders: FundsOrderService) {}

  @Get()
  @ApiOperation({ summary: 'List funds orders (deposit/withdraw/swap)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/funds-orders'))
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: FundsOrdersAdminQueryDto) {
    return this.fundsOrders.findAllForAdmin(query);
  }

  @Get(':fundsOrderNo')
  @ApiOperation({ summary: 'Get funds order detail' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/funds-orders/:fundsOrderNo'),
  )
  findOne(@Param('fundsOrderNo') fundsOrderNo: string) {
    return this.fundsOrders.findOneByNoForAdmin(fundsOrderNo);
  }
}
