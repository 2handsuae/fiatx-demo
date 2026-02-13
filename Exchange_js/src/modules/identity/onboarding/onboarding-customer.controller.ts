import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
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
  SaveCddCaseDto,
  SaveEddCaseDto,
  SubmitCaseDto,
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
  @ApiOperation({ summary: 'Bootstrap required CDD cases by customer type and UBO set' })
  bootstrapCddCases(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: BootstrapCasesDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.bootstrapCddCases(customerId, customerId, body);
  }

  @Post('cdd-cases')
  @ApiOperation({ summary: 'Create or update CDD draft case' })
  saveCddDraft(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: SaveCddCaseDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.saveCddDraft(customerId, customerId, body);
  }

  @Patch('cdd-cases/:id/submit')
  @ApiOperation({ summary: 'Submit CDD case for compliance review' })
  submitCddCase(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitCaseDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.submitCddCase(customerId, customerId, id, body.note);
  }

  @Post('edd-cases/bootstrap')
  @ApiOperation({ summary: 'Bootstrap required EDD cases after CDD triggers EDD escalation' })
  bootstrapEddCases(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: BootstrapCasesDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.bootstrapEddCases(customerId, customerId, body);
  }

  @Post('edd-cases')
  @ApiOperation({ summary: 'Create or update EDD draft case' })
  saveEddDraft(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: SaveEddCaseDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.saveEddDraft(customerId, customerId, body);
  }

  @Patch('edd-cases/:id/submit')
  @ApiOperation({ summary: 'Submit EDD case for MLRO/Senior review' })
  submitEddCase(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: SubmitCaseDto,
  ) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.submitEddCase(customerId, customerId, id, body.note);
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
