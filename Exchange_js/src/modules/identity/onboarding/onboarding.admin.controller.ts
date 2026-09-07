import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { OnboardingWorkflowService } from './onboarding-workflow.service';

@ApiTags('Admin - Onboarding')
@Controller('admin/customers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class OnboardingAdminController {
  constructor(private readonly workflow: OnboardingWorkflowService) {}

  @Post(':customerNo/onboarding-acceptance')
  @ApiOperation({ summary: '提请高风险客户准入核准（运营 maker → 高管 checker）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/onboarding-acceptance'))
  submit(@Req() req: any, @Param('customerNo') customerNo: string, @Body() body: { reason: string }) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin token required');
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.submitAcceptance(customerNo, body?.reason ?? '', actor);
  }

  @Get(':customerNo/onboarding-acceptance')
  @ApiOperation({ summary: '查关联准入核准单状态（单子提了没，从审批单推导）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/onboarding-acceptance'))
  getAcceptance(@Param('customerNo') customerNo: string) {
    return this.workflow.getAcceptanceCase(customerNo);
  }
}
