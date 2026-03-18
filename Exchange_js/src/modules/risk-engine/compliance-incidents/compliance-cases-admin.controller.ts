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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import {
  ComplianceCaseQueryDto,
  CreateCaseFromAlertDto,
  FinalizeComplianceCaseReportDto,
  LinkCaseAlertDto,
  UpsertComplianceCaseReportDraftDto,
  UpdateComplianceCaseActionDto,
} from './dto/compliance-case.dto';

@ApiTags('Admin - Compliance Cases')
@Controller('admin/compliance/cases')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ComplianceCasesAdminController {
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/cases'))
  @ApiOperation({ summary: 'List compliance cases with filters' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ComplianceCaseQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.complianceIncidentsService.findAll(query);
  }

  @Post('from-alert/:alertId')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/cases/from-alert/:alertId'))
  @ApiOperation({ summary: 'Create case by escalating alert' })
  createFromAlert(
    @Req() req: any,
    @Param('alertId') alertId: string,
    @Body(new ValidationPipe({ transform: true })) body: CreateCaseFromAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.createFromAlert(alertId, body, actor);
  }

  @Get(':id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/cases/:id'))
  @ApiOperation({ summary: 'Get compliance case detail by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.findOne(id, actor);
  }

  @Get(':id/report')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/cases/:id'))
  @ApiOperation({ summary: 'Get current case report and version history' })
  getReport(@Req() req: any, @Param('id') id: string) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.getReport(id, actor);
  }

  @Put(':id/report/draft')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/cases/:id/action'))
  @ApiOperation({ summary: 'Save or revise current case report draft' })
  saveReportDraft(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: UpsertComplianceCaseReportDraftDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.saveReportDraft(id, body, actor);
  }

  @Post(':id/report/finalize')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/cases/:id/action'))
  @ApiOperation({ summary: 'Finalize current case report draft' })
  finalizeReport(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: FinalizeComplianceCaseReportDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.finalizeReport(id, body, actor);
  }

  @Patch(':id/action')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/cases/:id/action'))
  @ApiOperation({ summary: 'Apply action to compliance case' })
  applyAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateComplianceCaseActionDto,
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
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/cases/:id/alerts'))
  @ApiOperation({ summary: 'Link alert into existing case' })
  linkAlert(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: LinkCaseAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.linkAlert(id, body, actor);
  }
}
