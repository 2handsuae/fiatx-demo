import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import {
  BootstrapCasesDto,
  CreateCaseSessionDto,
  MockCompleteSessionDto,
  ReinitiateEddDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';

@ApiTags('Customer - Onboarding')
@Controller('onboarding')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OnboardingCustomerController {
  constructor(private readonly onboardingService: OnboardingService) {}

  private ensureCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my onboarding status and active cases' })
  getMyOnboarding(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.getMyOnboarding(customerId);
  }

  @Get('cases')
  @ApiOperation({ summary: 'List my CDD/EDD cases with latest provider session status' })
  listMyCases(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.listMyCases(customerId);
  }

  @Get('next-step')
  @ApiOperation({ summary: 'Get single-path onboarding next step' })
  getNextStep(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.getNextStep(customerId);
  }

  @Post('entity')
  @ApiOperation({ summary: 'Save entity profile without changing registered customer type' })
  upsertEntity(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: UpsertEntityDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.upsertEntity(customerId, customerId, body);
  }

  @Post('cdd-cases/bootstrap')
  @ApiOperation({ summary: 'Start CDD journey: bootstrap required CDD cases and auto-create QR session' })
  bootstrapCddCases(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: BootstrapCasesDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.startCddCases(customerId, customerId, body);
  }

  @Post('cdd-cases/reinitiate')
  @ApiOperation({ summary: 'Re-initiate CDD and auto-create QR session for current CDD case' })
  reinitiateCddCases(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.reinitiateCddCases(customerId, customerId);
  }

  @Post('edd-cases/start')
  @ApiOperation({ summary: 'Start EDD current case and auto-create QR session' })
  startEddCases(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.startEddCases(customerId, customerId);
  }

  @Post('edd-cases/reinitiate')
  @ApiOperation({ summary: 'Re-initiate EDD cases after EDD rejection' })
  reinitiateEddCases(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: ReinitiateEddDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.reinitiateEddCases(customerId, customerId, body);
  }

  @Post('cases/:id/sessions')
  @ApiOperation({ summary: 'Create third-party compliance session and return QR payload' })
  createCaseSession(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: CreateCaseSessionDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.createCaseSession(customerId, customerId, id, body);
  }

  @Post('sessions/:sessionId/mock-complete')
  @ApiOperation({ summary: 'Mock callback: complete compliance session and advance case status' })
  mockCompleteSession(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body(new ValidationPipe({ transform: true })) body: MockCompleteSessionDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.mockCompleteSession(customerId, customerId, sessionId, body);
  }
}
