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
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { OnboardingService } from './onboarding.service';
import { RiskDecisionRecordsService } from '../../risk-engine/risk-decision-records.service';
import {
  DecisionRecordQueryDto,
  UpdateInvestorClassificationDto,
} from './dto/onboarding.dto';

@ApiTags('Admin - Onboarding')
@Controller('admin/compliance')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class OnboardingAdminController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly riskDecisionRecordsService: RiskDecisionRecordsService,
  ) {}

  private getAdminActor(req: any) {
    if (req.user?.type === 'CUSTOMER') {
      throw new ForbiddenException('Admin token required');
    }
    return {
      actorId: req.user?.userId || 'ADMIN_SYSTEM',
      actorRole: req.user?.role || 'ADMIN',
    };
  }

  private parseCustomerIds(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const values = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }

  // CDD/EDD endpoints expose onboarding provider-response containers and should
  // not be treated as the platform compliance Case object.
  @Get('cdd-responses')
  @ApiOperation({ summary: 'List CDD responses for compliance review.' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'customerType', required: false, type: String })
  @ApiQuery({
    name: 'workflow',
    required: false,
    type: String,
    description: 'Filter response workflow: ONBOARDING | PERIODIC_REVIEW. Omit to include both.',
  })
  @ApiQuery({
    name: 'customerIds',
    required: false,
    type: String,
    description: 'Comma separated customer ids for scoped lookup',
  })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listCddResponses(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('customerType') customerType?: string,
    @Query('workflow') workflow?: string,
    @Query('customerIds') customerIds?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listCddResponses({
      status,
      customerType,
      workflow,
      customerIds: this.parseCustomerIds(customerIds),
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('cdd-responses/:id')
  @ApiOperation({ summary: 'Get CDD response detail with customer snapshot and mock detail payload.' })
  getCddResponseDetail(@Req() req: any, @Param('id') id: string) {
    this.getAdminActor(req);
    return this.onboardingService.getCddResponseDetail(id);
  }

  @Get('edd-responses')
  @ApiOperation({ summary: 'List EDD responses for MLRO review.' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({
    name: 'workflow',
    required: false,
    type: String,
    description: 'Filter response workflow: ONBOARDING | PERIODIC_REVIEW. Omit to include both.',
  })
  @ApiQuery({
    name: 'customerIds',
    required: false,
    type: String,
    description: 'Comma separated customer ids for scoped lookup',
  })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listEddResponses(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('workflow') workflow?: string,
    @Query('customerIds') customerIds?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listEddResponses({
      status,
      workflow,
      customerIds: this.parseCustomerIds(customerIds),
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('edd-responses/:id')
  @ApiOperation({ summary: 'Get EDD response detail with customer snapshot and mock detail payload.' })
  getEddResponseDetail(@Req() req: any, @Param('id') id: string) {
    this.getAdminActor(req);
    return this.onboardingService.getEddResponseDetail(id);
  }

  // Decision records are the canonical risk-execution read model. The legacy
  // /admin/compliance endpoints remain as compatibility aliases during Wave 2.
  @Get('decision-records')
  @RequirePermissions(buildPermissionCode('GET', '/admin/risk/decision-records'))
  @ApiOperation({ summary: 'List onboarding risk decision records' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'contextType', required: false, type: String })
  @ApiQuery({ name: 'outputDecision', required: false, type: String })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  @ApiQuery({ name: 'ownerId', required: false, type: String })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({ name: 'policyVersion', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listDecisionRecords(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: DecisionRecordQueryDto,
  ) {
    this.getAdminActor(req);
    return this.riskDecisionRecordsService.listDecisionRecords({
      status: query.status,
      contextType: query.contextType,
      outputDecision: query.outputDecision,
      ownerId: query.ownerId || query.customerId,
      subjectId: query.subjectId,
      policyVersion: query.policyVersion,
      skip: query.skip,
      take: query.take,
    });
  }

  @Get('decision-records/:id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/risk/decision-records/:id'))
  @ApiOperation({ summary: 'Get onboarding risk decision record detail' })
  getDecisionRecordDetail(@Req() req: any, @Param('id') id: string) {
    this.getAdminActor(req);
    return this.riskDecisionRecordsService.getDecisionRecordDetail(id);
  }

  @Post('customers/:id/simulate-expired')
  @ApiOperation({ summary: 'Simulate CDD document expiry and recompute compliance snapshot' })
  simulateExpired(@Req() req: any, @Param('id') id: string) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.simulateCustomerExpired(id, actor.actorId, actor.actorRole);
  }

  @Patch('customers/:id/investor-classification')
  @ApiOperation({ summary: 'Override investor classification with audit reason' })
  updateInvestorClassification(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateInvestorClassificationDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.updateInvestorClassification(
      id,
      actor.actorId,
      actor.actorRole,
      body,
    );
  }
}
