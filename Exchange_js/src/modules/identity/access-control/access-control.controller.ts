import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessControlService } from './access-control.service';
import { AdminPermissionGuard } from './admin-permission.guard';
import { RequirePermissions } from './require-permissions.decorator';
import { buildPermissionCode } from './permission-code.util';
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';
import { RoleDefinitionModifyWorkflowService } from './role-definition-modify-workflow.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AccessControlController {
  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly roleDefinitionCreateWorkflow: RoleDefinitionCreateWorkflowService,
    private readonly roleDefinitionModifyWorkflowService: RoleDefinitionModifyWorkflowService,
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
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post('role-definitions')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/role-definitions'))
  @ApiOperation({ summary: 'Initiate role definition create approval' })
  createRoleDefinition(@Req() req: any, @Body() body: any) {
    this.ensureAdmin(req);
    return this.roleDefinitionCreateWorkflow.initiateCreate(body, this.buildAdminActor(req));
  }

  @Post('role-definitions/:roleId/modify')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/role-definitions/:roleId/modify'))
  @ApiOperation({ summary: 'Submit a role definition modify request' })
  async submitRoleDefinitionModify(
    @Param('roleId') roleId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    const actor = this.buildAdminActor(req);
    return this.roleDefinitionModifyWorkflowService.initiateModify(roleId, body, actor);
  }

  @Get('role-definition-modify-requests')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-definition-modify-requests'))
  @ApiOperation({ summary: 'List role definition modify requests' })
  async listRoleDefinitionModifyRequests(@Query() query: any, @Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.listRoleDefinitionModifyRequests(query);
  }

  @Get('role-definition-modify-requests/:id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-definition-modify-requests/:id'))
  @ApiOperation({ summary: 'Get role definition modify request detail' })
  async getRoleDefinitionModifyRequest(@Param('id') id: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.getRoleDefinitionModifyRequest(id);
  }

  @Get('role-definitions/permission-groups')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-definitions/permission-groups'))
  @ApiOperation({ summary: 'List available permission groups for role creation' })
  listPermissionGroups(@Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.listPermissionGroups();
  }

  @Get('action-buckets')
  @ApiOperation({ summary: 'List action bucket catalog with permission-code-to-group mapping' })
  getActionBucketCatalog() {
    return this.accessControlService.getActionBucketCatalog();
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
}
