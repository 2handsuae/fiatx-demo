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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditActorContext,
  AuditLogQueryDto,
  CreateAuditLogEventDto,
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

  private resolveRequestSourceIp(req: any): string | undefined {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]?.trim();
    }
    return req.ip;
  }

  @Post()
  @ApiOperation({ summary: 'Create one manual audit log record (admin)' })
  create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateAuditLogEventDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.auditLogsService.recordByActor(
      {
        ...body,
        requestId: body.requestId ?? req.id,
        sourceIp: body.sourceIp ?? this.resolveRequestSourceIp(req),
        sourcePlatform: body.sourcePlatform ?? 'ADMIN_API',
      },
      actor,
    );
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
