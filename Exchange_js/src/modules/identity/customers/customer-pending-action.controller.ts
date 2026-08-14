import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
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

  /**
   * 客户级补料会话（parity 2026-08-14）。mirror 充值/提现的
   * verification-session 端点（锚点从订单+seq 换成客户单槽）。响应只有
   * {submitted, sdkToken} 两键；无待办/无 applicantId/已提交 三种情况响应
   * 逐字节一致 —— 不可区分规则见 service 注释。
   */
  @Get('pending-action/verification-session')
  @ApiOperation({ summary: '补料认证会话：铸 WebSDK token（无待办/已提交时 submitted:true）' })
  getVerificationSession(@Request() req: any) {
    const customerId = this.extractCustomer(req);
    return this.pendingActionService.getVerificationSession(customerId);
  }

  /**
   * 客户提交回执。幂等恒 2xx（write-once 落章 + 首个提交才审计），
   * 不因待办不存在/已提交而返回错误 —— 不给探测面。
   */
  @Post('pending-action/verification-session/submit')
  @HttpCode(200)
  @ApiOperation({ summary: '补料材料已提交回执（幂等恒 200）' })
  async submitVerification(@Request() req: any) {
    const customerId = this.extractCustomer(req);
    await this.pendingActionService.submitVerification(customerId, {
      actorId: customerId,
    });
    return { ok: true };
  }
}
