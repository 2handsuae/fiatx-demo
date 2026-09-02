import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import {
  CreateRoleChangeRequestDto,
  RoleChangeRequestQueryDto,
} from './dto/create-role-change-request.dto';

@ApiTags('Admin - IAM - Role Change Requests')
@Controller('admin/iam/role-change-requests')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminRoleChangeRequestController {
  constructor(
    private readonly workflowService: AdminRoleBindingChangeWorkflowService,
  ) {}

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/role-change-requests'))
  @ApiOperation({ summary: 'Create admin role binding change request (C2)' })
  createRoleChangeRequest(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateRoleChangeRequestDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.createRoleChangeRequest(body, this.buildAdminActor(req));
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-change-requests'))
  @ApiOperation({ summary: 'List admin role binding change requests' })
  findRoleChangeRequests(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: RoleChangeRequestQueryDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.findRoleChangeRequests(query);
  }

  @Get(':requestNo')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-change-requests/:requestNo'))
  @ApiOperation({ summary: 'Get admin role binding change request detail' })
  findRoleChangeRequest(
    @Req() req: any,
    @Param('requestNo') requestNo: string,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.findRoleChangeRequest(requestNo);
  }
}
