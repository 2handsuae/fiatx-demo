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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { ComplianceCaseEvidencePackagesService } from './compliance-case-evidence-packages.service';
import {
  ComplianceCaseEvidencePackageQueryDto,
  ExportComplianceCaseEvidencePackageDto,
} from './dto/compliance-case-evidence-package.dto';

@ApiTags('Admin - Compliance Case Evidence Packages')
@Controller('admin/compliance/cases')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ComplianceCaseEvidencePackagesController {
  constructor(
    private readonly complianceCaseEvidencePackagesService: ComplianceCaseEvidencePackagesService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: 'ADMIN' as const,
      userId: String(req.user.userId || ''),
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: Array.isArray(req.user.roleCodes) ? req.user.roleCodes : [],
    };
  }

  @Post('export/evidence-package')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/cases/export/evidence-package'))
  @ApiOperation({ summary: 'Create case evidence export request with approval gate' })
  createExportRequest(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: ExportComplianceCaseEvidencePackageDto,
  ) {
    return this.complianceCaseEvidencePackagesService.createExportRequest(
      body,
      this.ensureAdmin(req),
    );
  }

  @Get('evidence-packages')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/cases/evidence-packages'))
  @ApiOperation({ summary: 'List persisted case evidence package exports' })
  findEvidencePackages(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ComplianceCaseEvidencePackageQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.complianceCaseEvidencePackagesService.findEvidencePackages(query);
  }

  @Get('evidence-packages/:id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/cases/evidence-packages/:id'))
  @ApiOperation({ summary: 'Get case evidence package detail by id' })
  findEvidencePackage(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.complianceCaseEvidencePackagesService.findEvidencePackage(id);
  }

  @Get('evidence-packages/:id/download')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/cases/evidence-packages/:id/download'))
  @ApiOperation({ summary: 'Download case evidence package content by id' })
  downloadEvidencePackage(@Req() req: any, @Param('id') id: string) {
    return this.complianceCaseEvidencePackagesService.downloadEvidencePackage(
      id,
      this.ensureAdmin(req),
    );
  }
}
