import { Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TierUpgradeWorkflowService } from './tier-upgrade-workflow.service';

@ApiTags('Client - Tier Upgrade')
@Controller('client/me/tier-upgrade')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class TierUpgradeClientController {
  constructor(private readonly workflow: TierUpgradeWorkflowService) {}

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }

  @Post('apply')
  @ApiOperation({ summary: '申请档位升级（建单 + applicant 换 PREMIUM 档）' })
  apply(@Req() req: any) { return this.workflow.apply(this.ensureCustomer(req)); }

  @Get()
  @ApiOperation({ summary: 'Profile 档位卡片（两档限额并排 + 在途单派生 stage）' })
  overview(@Req() req: any) { return this.workflow.getOverview(this.ensureCustomer(req)); }

  @Get('session')
  @ApiOperation({ summary: '取补料会话（模拟模式下 sdkToken 是 mock 值）' })
  session(@Req() req: any) { return this.workflow.getSession(this.ensureCustomer(req)); }

  @Post('submit')
  @ApiOperation({ summary: '提交补料（零存储：只落 materialsSubmittedAt）' })
  submit(@Req() req: any) { return this.workflow.submitMaterials(this.ensureCustomer(req)); }
}
