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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import {
  FinalReviewCustomerDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
  UpdateInvestorClassificationDto,
} from './dto/onboarding.dto';

@ApiTags('Admin - Onboarding')
@Controller('admin/compliance')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OnboardingAdminController {
  constructor(private readonly onboardingService: OnboardingService) {}

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
    const actor = this.getAdminActor(req);
    return this.onboardingService.reviewCddCase(id, actor.actorId, actor.actorRole, body);
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
    const actor = this.getAdminActor(req);
    return this.onboardingService.mlroReviewEddCase(id, actor.actorId, actor.actorRole, body);
  }

  @Get('edd-cases/:id')
  @ApiOperation({ summary: 'Get EDD case detail with customer snapshot and mock detail payload' })
  getEddCaseDetail(@Req() req: any, @Param('id') id: string) {
    this.getAdminActor(req);
    return this.onboardingService.getEddCaseDetail(id);
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
