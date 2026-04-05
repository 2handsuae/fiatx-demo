import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
  Req,
  ForbiddenException,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ChangeTicketsService } from '../../governance/change-tickets/change-tickets.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly changeTicketsService: ChangeTicketsService,
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
  @ApiOperation({ summary: 'Create admin member provisioning change ticket' })
  async create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.changeTicketsService.createAdminMemberProvisioningTicket(
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
  @ApiOperation({ summary: 'Resend admin invitation link for INACTIVE member' })
  async resendInvitation(@Req() req: any, @Param('id') id: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.usersService.resendAdminInvitation({
      userId: id,
      actor: {
        actorId: req.user.userId,
        actorRole: req.user.role || 'ADMIN',
        actorNo: req.user.userNo,
      },
    });
  }
}
