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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { ComplianceAlertsService } from './compliance-alerts.service';
import {
  ComplianceAlertQueryDto,
  ResolveComplianceAlertDto,
  UpdateComplianceAlertWorkItemDto,
} from './dto/compliance-alert.dto';

@ApiTags('Admin - Compliance Alerts')
@Controller('admin/compliance/alerts')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/alerts'))
  @ApiOperation({ summary: 'List compliance alerts with filters' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ComplianceAlertQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.complianceAlertsService.findAll(query);
  }

  @Post('simulate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/alerts/simulate'))
  @ApiOperation({ summary: 'Simulate 10 random compliance alerts' })
  simulate(@Req() req: any) {
    this.ensureAdmin(req);
    return this.complianceAlertsService.simulateRandomAlerts(10);
  }

  @Get(':id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/compliance/alerts/:id'))
  @ApiOperation({ summary: 'Get compliance alert detail by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    const actor = this.ensureAdmin(req);
    return this.complianceAlertsService.findOne(id, actor);
  }

  @Patch(':id/action')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/compliance/alerts/:id/action'))
  @ApiOperation({
    summary:
      'Assign or reassign compliance alert work item.',
  })
  applyAction(
    @Req() req: any,
    @Param('id') id: string,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateComplianceAlertWorkItemDto,
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

  @Post(':id/resolve')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/alerts/:id/resolve'))
  @ApiOperation({ summary: 'Resolve workflow-bound alert via canonical resolution path' })
  resolve(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ResolveComplianceAlertDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.complianceAlertsService.resolveAlert(id, body, actor);
  }
}
