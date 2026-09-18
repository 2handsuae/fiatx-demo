import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingWorkflowService } from './onboarding-workflow.service';

@ApiTags('Client - Onboarding')
@Controller('client/me/onboarding')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OnboardingClientController {
  constructor(private readonly workflow: OnboardingWorkflowService) {}

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }

  @Post('start')
  @ApiOperation({ summary: '开始认证（建/续用 Sumsub 申请人，进入认证中）' })
  start(@Req() req: any) { return this.workflow.startVerification(this.ensureCustomer(req)); }

  @Get('session')
  @ApiOperation({ summary: '取认证会话（模拟模式下 sdkToken 是 mock 值）' })
  session(@Req() req: any) { return this.workflow.getSession(this.ensureCustomer(req)); }

  @Post('submit')
  @ApiOperation({ summary: '提交认证资料（CDD 落基础信息；EDD 零存储）' })
  submit(@Req() req: any, @Body() dto: Record<string, string | undefined>) {
    return this.workflow.submit(this.ensureCustomer(req), dto ?? {});
  }

  @Post('withdraw')
  @ApiOperation({ summary: '撤回申请' })
  withdraw(@Req() req: any) { return this.workflow.withdrawApplication(this.ensureCustomer(req)); }

  @Post('reapply')
  @ApiOperation({ summary: '重新申请（终拒后被拒绝）' })
  reapply(@Req() req: any) { return this.workflow.reapply(this.ensureCustomer(req)); }
}
