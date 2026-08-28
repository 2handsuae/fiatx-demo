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
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
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

  /**
   * Fix 2（末站整改）：此前 create()/submit() 各自算一个 operatorId 字符串
   * （userNo||sub）就地传给 service，把 maker 的身份塌缩成一个值——checker 侧
   * （approvals.controller.ts ensureAdmin）用的是 JWT 的 userId（UUID）。两边
   * 不是同一口径，approvals.service.ts 的自审拦截（actor.userId ===
   * approval.createdByUserId）因此永远比不上。照 sibling maker
   * customer-restrictions.admin.controller.ts:62-70 的形状，把真实 actor
   * （UUID + userNo + roleCodes）整个建出来往下传，不再收窄成一个字符串。
   */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  @Post()
  @ApiOperation({ summary: '开调账单草稿' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/adjustments'))
  create(@Body() dto: CreateAdjustmentDto, @Req() req: any) {
    return this.adjustment.createDraft(dto, this.buildActor(req));
  }

  @Post(':adjustmentNo/submit')
  @ApiOperation({ summary: '提审调账单：进入审批中心' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/adjustments/:adjustmentNo/submit'))
  submit(@Param('adjustmentNo') adjustmentNo: string, @Req() req: any) {
    return this.adjustment.submit(adjustmentNo, this.buildActor(req));
  }

  @Get(':adjustmentNo')
  @ApiOperation({ summary: '调账单详情' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/adjustments/:adjustmentNo'))
  getOne(@Param('adjustmentNo') adjustmentNo: string) {
    return this.adjustment.getAdjustment(adjustmentNo);
  }
}
