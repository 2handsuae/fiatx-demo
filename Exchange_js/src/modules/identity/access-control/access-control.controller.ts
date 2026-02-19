import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessControlService } from './access-control.service';
import { AdminPermissionGuard } from './admin-permission.guard';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { RequirePermissions } from './require-permissions.decorator';
import { buildPermissionCode } from './permission-code.util';

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AccessControlController {
  constructor(private readonly accessControlService: AccessControlService) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Get('roles')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/roles'))
  @ApiOperation({ summary: 'List fixed role catalog with bound permissions' })
  listRoles(@Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.listRoles();
  }

  @Get('permissions')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/permissions'))
  @ApiOperation({ summary: 'List fixed permission catalog' })
  listPermissions(@Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.listPermissions();
  }

  @Get('users/:id/roles')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/users/:id/roles'))
  @ApiOperation({ summary: 'Get one user role bindings' })
  async getUserRoles(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    this.ensureAdmin(req);
    const roles = await this.accessControlService.getUserRoles(id);
    return {
      userId: id,
      roles,
    };
  }

  @Put('users/:id/roles')
  @RequirePermissions(buildPermissionCode('PUT', '/admin/iam/users/:id/roles'))
  @ApiOperation({ summary: 'Replace one user role bindings (full replace)' })
  replaceUserRoles(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateUserRolesDto,
  ) {
    this.ensureAdmin(req);
    return this.accessControlService.replaceUserRoles(id, body.roleCodes || [], {
      actorId: req.user.userId,
      actorRole: req.user.role || 'ADMIN',
      actorNo: req.user.userNo,
    });
  }
}
