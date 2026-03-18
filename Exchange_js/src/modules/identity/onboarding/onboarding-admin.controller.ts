import {
  Body,
  ConflictException,
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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { OnboardingService } from './onboarding.service';
import { RiskDecisionRecordsService } from '../../risk-engine/risk-decision-records.service';
import {
  ApplyOnboardingAlertDecisionDto,
  DecisionRecordQueryDto,
  FinalReviewCustomerDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
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
  @Get('cdd-cases')
  @ApiOperation({ summary: 'List CDD cases for compliance review' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'customerType', required: false, type: String })
  @ApiQuery({
    name: 'customerIds',
    required: false,
    type: String,
    description: 'Comma separated customer ids for scoped lookup',
  })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listCddCases(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('customerType') customerType?: string,
    @Query('customerIds') customerIds?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listCddCases({
      status,
      customerType,
      customerIds: this.parseCustomerIds(customerIds),
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post('cdd-cases/:id/review')
  @ApiOperation({ summary: 'Review CDD case (approve/reject/upgrade-edd)' })
  reviewCddCase(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ReviewCddCaseDto,
  ) {
    this.getAdminActor(req);
    void id;
    void body;
    throw new ConflictException('Use alert triage workflow');
  }

  @Get('cdd-cases/:id')
  @ApiOperation({ summary: 'Get CDD case detail with customer snapshot and mock detail payload' })
  getCddCaseDetail(@Req() req: any, @Param('id') id: string) {
    this.getAdminActor(req);
    return this.onboardingService.getCddCaseDetail(id);
  }

  @Get('edd-cases')
  @ApiOperation({ summary: 'List EDD cases for MLRO review' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({
    name: 'customerIds',
    required: false,
    type: String,
    description: 'Comma separated customer ids for scoped lookup',
  })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listEddCases(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('customerIds') customerIds?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listEddCases({
      status,
      customerIds: this.parseCustomerIds(customerIds),
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post('edd-cases/:id/mlro-review')
  @ApiOperation({ summary: 'MLRO review EDD case' })
  mlroReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ReviewEddCaseDto,
  ) {
    this.getAdminActor(req);
    void id;
    void body;
    throw new ConflictException('Use alert triage workflow');
  }

  @Get('edd-cases/:id')
  @ApiOperation({ summary: 'Get EDD case detail with customer snapshot and mock detail payload' })
  getEddCaseDetail(@Req() req: any, @Param('id') id: string) {
    this.getAdminActor(req);
    return this.onboardingService.getEddCaseDetail(id);
  }

  @Post('alerts/:id/onboarding-decision')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/alerts/:id/onboarding-decision'))
  @ApiOperation({ summary: 'Apply onboarding decision from assigned onboarding journey alert' })
  applyOnboardingDecisionFromAlert(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ApplyOnboardingAlertDecisionDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.applyOnboardingDecisionFromAlert(
      id,
      actor.actorId,
      actor.actorRole,
      body,
    );
  }

  @Post('cases/:id/onboarding-decision')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/cases/:id/onboarding-decision'))
  @ApiOperation({ summary: 'Apply onboarding decision from assigned onboarding case' })
  async applyOnboardingDecisionFromCase(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ApplyOnboardingAlertDecisionDto,
  ) {
    const actor = this.getAdminActor(req);
    const result = await this.onboardingService.applyOnboardingDecisionFromIncident(
      id,
      actor.actorId,
      actor.actorRole,
      body,
    );
    return {
      ...result,
      case: result.incident,
    };
  }

  @Post('incidents/:id/onboarding-decision')
  @RequirePermissions(buildPermissionCode('POST', '/admin/compliance/incidents/:id/onboarding-decision'))
  @ApiOperation({ summary: 'Apply onboarding decision from assigned onboarding incident (compatibility alias)' })
  applyOnboardingDecisionFromIncident(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ApplyOnboardingAlertDecisionDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.applyOnboardingDecisionFromIncident(
      id,
      actor.actorId,
      actor.actorRole,
      body,
    );
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

  @Post('customers/:id/final-review')
  @ApiOperation({ summary: 'Customer-level final management decision for EDD-triggered onboarding' })
  finalReviewCustomer(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: FinalReviewCustomerDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.reviewCustomerFinalDecision(
      id,
      actor.actorId,
      actor.actorRole,
      body,
    );
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
