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
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
import { UsersService } from './users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { SuspendAdminUserDto } from './dto/suspend-admin-user.dto';
import { ReactivateAdminUserDto } from './dto/reactivate-admin-user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class UsersController {
  constructor(
    private readonly adminInviteWorkflow: AdminInviteWorkflowService,
    private readonly adminSuspensionWorkflow: AdminSuspensionWorkflowService,
    private readonly adminReactivationWorkflow: AdminReactivationWorkflowService,
    private readonly usersService: UsersService,
    private readonly adminPasswordResetWorkflow: AdminPasswordResetWorkflowService,
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
  @RequirePermissions(buildPermissionCode('POST', '/users'))
  @ApiOperation({ summary: 'Initiate admin invite approval (C1)' })
  async create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminInviteWorkflow.initiateInvite(
      {
        email: body.email,
        roleCodes: body.roleCodes,
        changeReason: body.changeReason,
      },
      this.buildAdminActor(req),
    );
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/users'))
  @ApiOperation({ summary: 'List all users' })
  async findAll(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    const users = await this.usersService.findAll({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : 20,
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user: any) => ({
      id: user.id,
      userNo: user.userNo,
      email: user.email,
      role: user.role,
      status: user.status,
      firstLoginStatus: user.firstLoginStatus ?? null,
      mfaEnabledAt: user.mfaEnabledAt ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      roles: (user.userRoles || [])
        .map((item: any) => item.role?.code)
        .filter(Boolean),
    }));
  }

  @Get(':id')
  @RequirePermissions(buildPermissionCode('GET', '/users'))
  @ApiOperation({ summary: 'Get one user detail with invitation summary' })
  async findOne(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.usersService.getMemberDetail(id);
  }

  @Post(':id/invitations/resend')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/invitations/resend'))
  @ApiOperation({ summary: 'Resend admin invitation link for INACTIVE/INVITE_SENT member' })
  async resendInvitation(@Req() req: any, @Param('id') id: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminInviteWorkflow.resendInvitation(id, this.buildAdminActor(req));
  }

  @Post(':id/suspend')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/suspend'))
  @ApiOperation({ summary: 'Initiate admin account suspension approval (C4)' })
  async suspendUser(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true })) body: SuspendAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminSuspensionWorkflow.initiateSuspension(
      { targetUserId: id, reason: body.reason },
      this.buildAdminActor(req),
    );
  }

  @Post(':id/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/reactivate'))
  @ApiOperation({ summary: 'Initiate admin account reactivation approval (C4b)' })
  async reactivateUser(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true })) body: ReactivateAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminReactivationWorkflow.initiateReactivation(
      { targetUserId: id, reason: body.reason },
      this.buildAdminActor(req),
    );
  }

  @Post(':id/reset-password')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/reset-password'))
  @ApiOperation({ summary: 'Initiate CISO password reset for admin user (C5)' })
  async resetPassword(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminPasswordResetWorkflow.initiateAdminReset(
      id,
      this.buildAdminActor(req),
    );
  }
}
