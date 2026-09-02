import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AdminMfaResetWorkflowService } from './admin-mfa-reset-workflow.service';
import { UsersDomainService } from './users.domain.service';

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminCredentialMgmtController {
  constructor(
    private readonly adminMfaResetWorkflow: AdminMfaResetWorkflowService,
    private readonly usersDomainService: UsersDomainService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: req.user.roleCodes || [req.user.role],
    };
  }

  /** 铁律⑥ 对外用业务键：同 users.controller.ts 的镜像约定——路由拿 userNo，
   *  换内部 id 再传给 workflow（工作流内部不动）。 */
  private async resolveUserId(userNo: string): Promise<string> {
    const user = await this.usersDomainService.findByUserNo(userNo);
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }

  @Post('users/:userNo/reset-mfa')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/users/:userNo/reset-mfa'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate admin MFA reset with approval (CISO / TECH_OFFICER)' })
  async resetMfa(
    @Param('userNo') userNo: string,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    const userId = await this.resolveUserId(userNo);
    return this.adminMfaResetWorkflow.initiateAdminMfaReset(userId, this.buildAdminActor(req));
  }
}
