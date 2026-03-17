import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import {
  ComplianceIncidentQueryDto,
  CreateIncidentFromAlertDto,
  LinkIncidentAlertDto,
  UpdateComplianceIncidentActionDto,
} from './dto/compliance-incident.dto';
import {
  FinalizeCaseReportDto,
  UpsertCaseReportDraftDto,
} from './dto/compliance-incident-report.dto';

@ApiTags('Admin - Compliance Incidents')
@Controller('admin/compliance/incidents')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ComplianceIncidentsAdminController {
  constructor(
    private readonly complianceIncidentsService: ComplianceIncidentsService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return {
      actorType: req.user.type,
      actorId: req.user.userId,
      actorNo: req.user.userNo,
      actorRole: req.user.role,
      sourcePlatform: 'ADMIN_API',
    };
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/incidents'))
  @ApiOperation({ summary: 'List compliance incidents with filters (compatibility alias)' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ComplianceIncidentQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.complianceIncidentsService.findAll(query);
  }

  @Post('from-alert/:alertId')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/incidents/from-alert/:alertId'))
  @ApiOperation({ summary: 'Create incident by escalating alert (compatibility alias)' })
  createFromAlert(
    @Req() req: any,
    @Param('alertId') alertId: string,
    @Body(new ValidationPipe({ transform: true })) body: CreateIncidentFromAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.createFromAlert(alertId, body, actor);
  }

  @Get(':id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/incidents/:id'))
  @ApiOperation({ summary: 'Get compliance incident detail by id (compatibility alias)' })
  findOne(@Req() req: any, @Param('id') id: string) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.findOne(id, actor);
  }

  @Get(':id/report')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/incidents/:id'))
  @ApiOperation({ summary: 'Get current incident report and version history (compatibility alias)' })
  getReport(@Req() req: any, @Param('id') id: string) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.getReport(id, actor);
  }

  @Put(':id/report/draft')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/incidents/:id/action'))
  @ApiOperation({ summary: 'Save or revise current incident report draft (compatibility alias)' })
  saveReportDraft(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpsertCaseReportDraftDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.saveReportDraft(id, body, actor);
  }

  @Post(':id/report/finalize')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/incidents/:id/action'))
  @ApiOperation({ summary: 'Finalize current incident report draft (compatibility alias)' })
  finalizeReport(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: FinalizeCaseReportDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.finalizeReport(id, body, actor);
  }

  @Patch(':id/action')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/incidents/:id/action'))
  @ApiOperation({ summary: 'Apply action to compliance incident (compatibility alias)' })
  applyAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateComplianceIncidentActionDto,
  ) {
    const actor = this.ensureAdmin(req);
    const payload =
      body.action === 'ASSIGN' && !body.assigneeUserId
        ? {
            ...body,
            assigneeUserId: actor.actorId,
          }
        : body;

    return this.complianceIncidentsService.applyAction(id, payload, actor);
  }

  @Post(':id/alerts')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/incidents/:id/alerts'))
  @ApiOperation({ summary: 'Link alert into existing incident (compatibility alias)' })
  linkAlert(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: LinkIncidentAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.linkAlert(id, body, actor);
  }
}
