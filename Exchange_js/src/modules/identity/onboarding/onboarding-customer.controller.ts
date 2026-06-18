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
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import {
  BootstrapResponsesDto,
  CreateResponseSessionDto,
  MockCompleteSessionDto,
  ReinitiateEddDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';

@ApiTags('Customer - Onboarding')
@Controller('onboarding')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
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
  @ApiOperation({ summary: 'Get my onboarding status and active responses' })
  getMyOnboarding(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.getMyOnboarding(customerId);
  }

  @Get('next-step')
  @ApiOperation({ summary: 'Get single-path onboarding next step' })
  getNextStep(@Req() req: any): Promise<any> {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.getNextStep(customerId);
  }

  @Post('verification/start')
  @ApiOperation({ summary: 'Start or continue provider-backed onboarding verification.' })
  startVerification(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.startVerification(customerId);
  }

  @Post('verification/mock-submit')
  @ApiOperation({
    summary:
      '[Mock-mode only] Simulate the customer completing the mobile KYC form. ' +
      'Dispatches an applicantPending event so the UI transitions to the under-review state. ' +
      'In production (with Sumsub credentials configured) this endpoint is disabled.',
  })
  mockSubmitVerification(@Req() req: any) {
    const customerId = this.ensureCustomer(req);
    return this.onboardingService.mockSubmitVerification(customerId);
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

}
