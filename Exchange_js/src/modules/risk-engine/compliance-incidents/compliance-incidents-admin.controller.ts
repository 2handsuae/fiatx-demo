import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import {
  ComplianceIncidentQueryDto,
  CreateIncidentFromAlertDto,
  LinkIncidentAlertDto,
  UpdateComplianceIncidentActionDto,
} from './dto/compliance-incident.dto';

@ApiTags('Admin - Compliance Incidents')
@Controller('admin/compliance/incidents')
@UseGuards(AuthGuard('jwt'))
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
  @ApiOperation({ summary: 'List compliance incidents with filters' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ComplianceIncidentQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.complianceIncidentsService.findAll(query);
  }

  @Post('from-alert/:alertId')
  @ApiOperation({ summary: 'Create incident by escalating alert' })
  createFromAlert(
    @Req() req: any,
    @Param('alertId') alertId: string,
    @Body(new ValidationPipe({ transform: true })) body: CreateIncidentFromAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.createFromAlert(alertId, body, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get compliance incident detail by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.complianceIncidentsService.findOne(id);
  }

  @Patch(':id/action')
  @ApiOperation({ summary: 'Apply action to compliance incident' })
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
  @ApiOperation({ summary: 'Link alert into existing incident' })
  linkAlert(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: LinkIncidentAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceIncidentsService.linkAlert(id, body, actor);
  }
}
