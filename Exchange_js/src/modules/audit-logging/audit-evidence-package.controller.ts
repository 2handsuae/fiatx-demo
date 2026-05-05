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
import { ApprovalActorContext } from '../governance/approvals/constants/approval.constants';
import { AuditEvidenceExportWorkflowService } from './audit-evidence-export-workflow.service';
import { AuditLogsService } from './audit-logs.service';
import { EvidencePackageQueryDto, ExportEvidencePackageDto } from './dto/audit-log.dto';

@ApiTags('Admin - Audit Evidence Packages')
@Controller('admin/audit/evidence-packages')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AuditEvidencePackageController {
  constructor(
    private readonly workflowService: AuditEvidenceExportWorkflowService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

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

  @Post()
  @ApiOperation({ summary: 'Request audit evidence package export (approval-gated)' })
  createExportRequest(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: ExportEvidencePackageDto,
  ) {
    return this.workflowService.createExportRequest(body, this.ensureApprovalAdmin(req));
  }

  @Get()
  @ApiOperation({ summary: 'List evidence packages' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: EvidencePackageQueryDto,
  ) {
    this.ensureApprovalAdmin(req);
    return this.auditLogsService.findEvidencePackages(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get evidence package detail' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureApprovalAdmin(req);
    return this.auditLogsService.findEvidencePackage(id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download evidence package content' })
  download(@Req() req: any, @Param('id') id: string) {
    return this.workflowService.downloadEvidencePackage(id, this.ensureApprovalAdmin(req));
  }
}
