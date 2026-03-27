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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../identity/access-control/permission-code.util';
import {
  RiskDecisionRecordQueryDto,
  SimulateRiskDecisionRecordDto,
} from './dto/risk-decision-record.dto';
import { RiskDecisionRecordsService } from './risk-decision-records.service';

@ApiTags('Admin - Risk')
@Controller('admin/risk/decision-records')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class RiskDecisionRecordsAdminController {
  constructor(
    private readonly riskDecisionRecordsService: RiskDecisionRecordsService,
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/risk/decision-records'))
  @ApiOperation({ summary: 'List risk decision records' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'contextType', required: false, type: String })
  @ApiQuery({ name: 'outputDecision', required: false, type: String })
  @ApiQuery({ name: 'ownerId', required: false, type: String })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({ name: 'policyVersion', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: RiskDecisionRecordQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.riskDecisionRecordsService.listDecisionRecords(query);
  }

  @Get(':id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/risk/decision-records/:id'))
  @ApiOperation({ summary: 'Get risk decision record detail' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.riskDecisionRecordsService.getDecisionRecordDetail(id);
  }

  @Post(':id/simulate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/risk/decision-records/:id/simulate'))
  @ApiOperation({ summary: 'Manually simulate one pending risk decision record' })
  @ApiBody({ type: SimulateRiskDecisionRecordDto })
  simulate(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SimulateRiskDecisionRecordDto,
  ) {
    const actor = this.ensureAdmin(req);
    return this.riskDecisionRecordsService.simulateDecisionRecord(id, body, actor);
  }
}
