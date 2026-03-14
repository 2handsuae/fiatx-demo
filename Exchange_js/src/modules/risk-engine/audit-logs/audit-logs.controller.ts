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
import { AuditEvidenceExportApprovalService } from '../../governance/approvals/audit-evidence-export-approval.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditActorContext,
  AuditLogQueryDto,
  CreateAuditLogEventDto,
  EvidencePackageQueryDto,
  ExportEvidencePackageDto,
} from './dto/audit-log.dto';

@ApiTags('Admin - Audit Logs')
@Controller('admin/audit-logs')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AuditLogsController {
  constructor(
    private readonly auditLogsService: AuditLogsService,
    private readonly auditEvidenceExportApprovalService: AuditEvidenceExportApprovalService,
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

  private ensureApprovalAdmin(req: any): ApprovalActorContext {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: 'ADMIN',
      userId: String(req.user.userId || ''),
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: Array.isArray(req.user.roleCodes) ? req.user.roleCodes : [],
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

  @Get('evidence-packages')
  @ApiOperation({ summary: 'List persisted evidence package exports' })
  findEvidencePackages(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: EvidencePackageQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.auditLogsService.findEvidencePackages(query);
  }

  @Get('evidence-packages/:id')
  @ApiOperation({ summary: 'Get persisted evidence package detail by id' })
  findEvidencePackage(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.auditLogsService.findEvidencePackage(id);
  }

  @Get('evidence-packages/:id/download')
  @ApiOperation({ summary: 'Download persisted evidence package content by id' })
  downloadEvidencePackage(@Req() req: any, @Param('id') id: string) {
    return this.auditEvidenceExportApprovalService.downloadEvidencePackage(
      id,
      this.ensureApprovalAdmin(req),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get audit log detail by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.auditLogsService.findOne(id);
  }

  @Post('export/evidence-package')
  @ApiOperation({ summary: 'Export audit evidence package with digest manifest' })
  exportEvidencePackage(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: ExportEvidencePackageDto,
  ) {
    return this.auditEvidenceExportApprovalService.createExportRequest(
      body,
      this.ensureApprovalAdmin(req),
    );
  }
}
