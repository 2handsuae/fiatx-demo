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
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import {
  CreateAppointmentRecordDto,
  CreateConflictDisclosureDto,
  CreateShareholdingRegistryVersionDto,
  CreateTrainingRecordDto,
  CreateWindDownMaterialRecordDto,
  GovernanceRegistryQueryDto,
  UpdateAppointmentRecordDto,
  UpdateConflictDisclosureDto,
  UpdateShareholdingRegistryVersionDto,
  UpdateTrainingRecordDto,
  UpdateWindDownMaterialRecordDto,
} from './dto/governance-registries.dto';
import { GovernanceRegistriesService } from './governance-registries.service';

@ApiTags('Admin - Governance Registries')
@Controller('admin/governance/registries')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class GovernanceRegistriesController {
  constructor(
    private readonly governanceRegistriesService: GovernanceRegistriesService,
  ) {}

  private ensureAdmin(req: any): ApprovalActorContext {
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

  @Get('shareholding-versions')
  @ApiOperation({ summary: 'List shareholding registry versions' })
  listShareholdingVersions(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: GovernanceRegistryQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.listShareholdingVersions(query);
  }

  @Get('shareholding-versions/:id')
  @ApiOperation({ summary: 'Get shareholding registry version detail' })
  getShareholdingVersion(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.getShareholdingVersion(id);
  }

  @Post('shareholding-versions')
  @ApiOperation({ summary: 'Create shareholding registry version' })
  createShareholdingVersion(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true }))
    body: CreateShareholdingRegistryVersionDto,
  ) {
    return this.governanceRegistriesService.createShareholdingVersion(
      body,
      this.ensureAdmin(req),
    );
  }

  @Patch('shareholding-versions/:id')
  @ApiOperation({ summary: 'Update shareholding registry version' })
  updateShareholdingVersion(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: UpdateShareholdingRegistryVersionDto,
  ) {
    return this.governanceRegistriesService.updateShareholdingVersion(
      id,
      body,
      this.ensureAdmin(req),
    );
  }

  @Get('appointments')
  @ApiOperation({ summary: 'List appointment records' })
  listAppointments(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: GovernanceRegistryQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.listAppointments(query);
  }

  @Get('appointments/:id')
  @ApiOperation({ summary: 'Get appointment record detail' })
  getAppointment(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.getAppointment(id);
  }

  @Post('appointments')
  @ApiOperation({ summary: 'Create appointment record' })
  createAppointment(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateAppointmentRecordDto,
  ) {
    return this.governanceRegistriesService.createAppointment(body, this.ensureAdmin(req));
  }

  @Patch('appointments/:id')
  @ApiOperation({ summary: 'Update appointment record' })
  updateAppointment(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateAppointmentRecordDto,
  ) {
    return this.governanceRegistriesService.updateAppointment(
      id,
      body,
      this.ensureAdmin(req),
    );
  }

  @Get('trainings')
  @ApiOperation({ summary: 'List training records' })
  listTrainings(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: GovernanceRegistryQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.listTrainings(query);
  }

  @Get('trainings/:id')
  @ApiOperation({ summary: 'Get training record detail' })
  getTraining(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.getTraining(id);
  }

  @Post('trainings')
  @ApiOperation({ summary: 'Create training record' })
  createTraining(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateTrainingRecordDto,
  ) {
    return this.governanceRegistriesService.createTraining(body, this.ensureAdmin(req));
  }

  @Patch('trainings/:id')
  @ApiOperation({ summary: 'Update training record' })
  updateTraining(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateTrainingRecordDto,
  ) {
    return this.governanceRegistriesService.updateTraining(id, body, this.ensureAdmin(req));
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'List conflict disclosures' })
  listConflicts(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: GovernanceRegistryQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.listConflicts(query);
  }

  @Get('conflicts/:id')
  @ApiOperation({ summary: 'Get conflict disclosure detail' })
  getConflict(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.getConflict(id);
  }

  @Post('conflicts')
  @ApiOperation({ summary: 'Create conflict disclosure' })
  createConflict(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateConflictDisclosureDto,
  ) {
    return this.governanceRegistriesService.createConflictDisclosure(
      body,
      this.ensureAdmin(req),
    );
  }

  @Patch('conflicts/:id')
  @ApiOperation({ summary: 'Update conflict disclosure' })
  updateConflict(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateConflictDisclosureDto,
  ) {
    return this.governanceRegistriesService.updateConflictDisclosure(
      id,
      body,
      this.ensureAdmin(req),
    );
  }

  @Get('wind-down-materials')
  @ApiOperation({ summary: 'List wind-down material records' })
  listWindDownMaterials(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: GovernanceRegistryQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.listWindDownMaterials(query);
  }

  @Get('wind-down-materials/:id')
  @ApiOperation({ summary: 'Get wind-down material record detail' })
  getWindDownMaterial(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.governanceRegistriesService.getWindDownMaterial(id);
  }

  @Post('wind-down-materials')
  @ApiOperation({ summary: 'Create wind-down material record' })
  createWindDownMaterial(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true }))
    body: CreateWindDownMaterialRecordDto,
  ) {
    return this.governanceRegistriesService.createWindDownMaterial(
      body,
      this.ensureAdmin(req),
    );
  }

  @Patch('wind-down-materials/:id')
  @ApiOperation({ summary: 'Update wind-down material record' })
  updateWindDownMaterial(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true }))
    body: UpdateWindDownMaterialRecordDto,
  ) {
    return this.governanceRegistriesService.updateWindDownMaterial(
      id,
      body,
      this.ensureAdmin(req),
    );
  }
}
