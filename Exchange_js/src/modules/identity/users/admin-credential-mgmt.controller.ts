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
import { AdminMfaResetService, MfaResetActor } from './admin-mfa-reset.service';

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminCredentialMgmtController {
  constructor(private readonly adminMfaResetService: AdminMfaResetService) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post('users/:id/reset-mfa')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/users/:id/reset-mfa'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset admin MFA binding (CISO / TECH_OFFICER)' })
  async resetMfa(
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    const actor: MfaResetActor = {
      actorType: 'ADMIN',
      actorId: req.user.userId,
      actorNo: req.user.userNo,
      actorRole: req.user.role,
    };
    return this.adminMfaResetService.executeMfaReset(userId, actor);
  }
}
