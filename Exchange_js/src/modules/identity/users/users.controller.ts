import {
  Body,
  Controller,
  Get,
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

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/users'))
  @ApiOperation({ summary: 'Create admin member and bind roles' })
  async create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.usersService.createAdminUser({
      email: body.email,
      roleCodes: body.roleCodes,
      actor: {
        actorId: req.user.userId,
        actorRole: req.user.role || 'ADMIN',
        actorNo: req.user.userNo,
      },
    });
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
}
