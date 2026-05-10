import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditActorContext,
  AuditLogQueryDto,
} from './dto/audit-log.dto';

@ApiTags('Admin - Audit Logs')
@Controller('admin/audit-logs')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AuditLogsController {
  constructor(
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private ensureAdmin(req: any): AuditActorContext {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: req.user.type,
      actorId: req.user.userId,
      actorNo: req.user.userNo,
      actorRole: req.user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List audit logs with filters' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: AuditLogQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.auditLogsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get audit log detail by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.auditLogsService.findOne(id);
  }
}
