import {
  Body,
  Controller,
  Get,
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
import { AdjustmentService } from './adjustment.service';
import { CreateAdjustmentDto } from '../dto/adjustment.dto';

/**
 * 平账·调账单处置端点（spec §6）。开单只落库（DRAFT）；提审接审批中心——
 * 落账发生在审批通过后的 @OnEvent handler 里（AdjustmentApprovalService →
 * AdjustmentService.onApproved，Task 4/5），本控制器不直接触碰账本。
 */
@ApiTags('Admin - Reconciliation Disposition (平账·调账单)')
@ApiBearerAuth()
@Controller('admin/reconciliation/adjustments')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AdjustmentController {
  constructor(private readonly adjustment: AdjustmentService) {}

  @Post()
  @ApiOperation({ summary: '开调账单草稿' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/adjustments'))
  create(@Body() dto: CreateAdjustmentDto, @Req() req: any) {
    const operatorId = req.user?.userNo || req.user?.sub;
    return this.adjustment.createDraft(dto, operatorId);
  }

  @Post(':adjustmentNo/submit')
  @ApiOperation({ summary: '提审调账单：进入审批中心' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/adjustments/:adjustmentNo/submit'))
  submit(@Param('adjustmentNo') adjustmentNo: string, @Req() req: any) {
    const operatorId = req.user?.userNo || req.user?.sub;
    return this.adjustment.submit(adjustmentNo, operatorId);
  }

  @Get(':adjustmentNo')
  @ApiOperation({ summary: '调账单详情' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/adjustments/:adjustmentNo'))
  getOne(@Param('adjustmentNo') adjustmentNo: string) {
    return this.adjustment.getAdjustment(adjustmentNo);
  }
}
