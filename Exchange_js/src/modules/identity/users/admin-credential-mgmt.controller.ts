import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminCredentialMgmtController {
  constructor(private readonly adminMfaResetWorkflow: AdminMfaResetWorkflowService) {}

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

  @Post('users/:id/reset-mfa')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/users/:id/reset-mfa'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate admin MFA reset with approval (CISO / TECH_OFFICER)' })
  async resetMfa(
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.adminMfaResetWorkflow.initiateAdminMfaReset(userId, this.buildAdminActor(req));
  }
}
