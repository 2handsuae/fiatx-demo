import {
  Controller,
  ForbiddenException,
  Get,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerPendingActionService } from './customer-pending-action.service';

/**
 * 客户端读面。镜像 trading-readiness.controller.ts 的 client/ 前缀 + AuthGuard('jwt')
 * 写法 —— 这里同样不加 AdminPermissionGuard：不需要 RBAC catalog 登记（客户端
 * 端点走 JwtAuthGuard，不进 admin RBAC catalog）。
 *
 * 只是个哑读口：tipping-off 判断已在写入侧（swap-workflow 的
 * handleRejectDisposition）做完一次，这里原样透传 CustomerPendingActionService.get()
 * 的结果，不再判断"要不要告诉客户"。
 */
@ApiTags('client/me')
@ApiBearerAuth()
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
export class CustomerPendingActionController {
  constructor(
    private readonly pendingActionService: CustomerPendingActionService,
  ) {}

  private extractCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }

  @Get('pending-action')
  @ApiOperation({
    summary:
      'KYT 拒绝后的待办事项。软线（有补料动作且非制裁）才非 null；硬线（含制裁命中）恒为 null。',
  })
  getPendingAction(@Request() req: any) {
    const customerId = this.extractCustomer(req);
    return this.pendingActionService.get(customerId);
  }
}
