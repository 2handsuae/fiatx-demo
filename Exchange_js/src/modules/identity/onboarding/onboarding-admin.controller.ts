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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import {
  RejectCustomerDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
} from './dto/onboarding.dto';

@ApiTags('Admin - Onboarding')
@Controller(['admin/onboarding', 'admin/compliance'])
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

  @Get('cdd-cases')
  @ApiOperation({ summary: 'List CDD cases for compliance review' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'customerType', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listCddCases(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('customerType') customerType?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listCddCases({
      status,
      customerType,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
    });
  }

  @Post('cdd-cases/:id/review')
  @ApiOperation({ summary: 'Review CDD case (approve/reject/need-info)' })
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
  @ApiOperation({ summary: 'List EDD cases for MLRO/Senior review' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listEddCases(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listEddCases({
      status,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
    });
  }

  @Get('decisions')
  @ApiOperation({ summary: 'List onboarding decision queue' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listDecisionQueue(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.getAdminActor(req);
    return this.onboardingService.listDecisionQueue({
      status,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
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

  @Post('edd-cases/:id/senior-review')
  @ApiOperation({ summary: 'Senior management review EDD case' })
  seniorReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ReviewEddCaseDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.seniorReviewEddCase(id, actor.actorId, actor.actorRole, body);
  }

  @Post('customers/:id/approve')
  @ApiOperation({ summary: 'Approve onboarding and unlock trading permissions' })
  approveCustomer(@Req() req: any, @Param('id') id: string) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.approveCustomer(id, actor.actorId, actor.actorRole);
  }

  @Post('customers/:id/reject')
  @ApiOperation({ summary: 'Reject onboarding and keep trading blocked' })
  rejectCustomer(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: RejectCustomerDto,
  ) {
    const actor = this.getAdminActor(req);
    return this.onboardingService.rejectCustomer(id, actor.actorId, actor.actorRole, body);
  }
}
