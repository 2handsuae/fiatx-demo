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
import { ComplianceAlertsService } from './compliance-alerts.service';
import {
  ComplianceAlertQueryDto,
  UpdateComplianceAlertActionDto,
} from './dto/compliance-alert.dto';

@ApiTags('Admin - Compliance Alerts')
@Controller('admin/compliance/alerts')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ComplianceAlertsAdminController {
  constructor(private readonly complianceAlertsService: ComplianceAlertsService) {}

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
  @ApiOperation({ summary: 'List compliance alerts with filters' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ComplianceAlertQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.complianceAlertsService.findAll(query);
  }

  @Post('simulate')
  @ApiOperation({ summary: 'Simulate 10 random compliance alerts' })
  simulate(@Req() req: any) {
    this.ensureAdmin(req);
    return this.complianceAlertsService.simulateRandomAlerts(10);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get compliance alert detail by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.complianceAlertsService.findOne(id);
  }

  @Patch(':id/action')
  @ApiOperation({ summary: 'Apply action to compliance alert' })
  applyAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateComplianceAlertActionDto,
  ) {
    const actor = this.ensureAdmin(req);
    const payload =
      body.action === 'ASSIGN' && !body.assigneeUserId
        ? {
            ...body,
            assigneeUserId: actor.actorId,
          }
        : body;

    return this.complianceAlertsService.applyAction(id, payload, actor);
  }
}
