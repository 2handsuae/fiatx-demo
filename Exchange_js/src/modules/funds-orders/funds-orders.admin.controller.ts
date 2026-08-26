import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../identity/access-control/permission-code.util';
import { FundsOrderAdvanceWorkflowService } from './funds-order-advance-workflow.service';
import { FundsOrderService } from './funds-order.service';
import { FundsOrdersAdminQueryDto } from './dto/funds-orders-admin-query.dto';
import { AdvanceFundsOrderDto } from './dto/advance-funds-order.dto';

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
  constructor(
    private readonly fundsOrders: FundsOrderService,
    private readonly advanceWorkflow: FundsOrderAdvanceWorkflowService,
  ) {}

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

  @Post(':fundsOrderNo/advance')
  @ApiOperation({ summary: 'Advance a funds order (simulation/ops)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/advance'),
  )
  @UsePipes(new ValidationPipe({ transform: true }))
  async advance(
    @Param('fundsOrderNo') fundsOrderNo: string,
    @Body() dto: AdvanceFundsOrderDto,
    @Req() req: any,
  ) {
    const actorNo = req.user?.userNo || req.user?.sub || 'ADMIN';
    return this.advanceWorkflow.advance(fundsOrderNo, dto.action, {
      actorType: 'ADMIN',
      actorNo,
      actorDisplayName: actorNo,
      actorRolesAtTime: ['ADMIN'],
    });
  }
}
