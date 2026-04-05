import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import type { OnboardingService } from './onboarding.service';
import { SimulateOnboardingSumsubEventDto } from './dto/onboarding.dto';

interface SumsubVerificationEventHandler {
  handleSumsubVerificationEvent(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<unknown>;
}

@ApiTags('Customer - Onboarding')
@Controller('onboarding/sumsub')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class OnboardingSumsubSimulationController {
  constructor(
    @Inject('OnboardingService')
    private readonly onboardingService: OnboardingService,
  ) {}

  private get sumsubHandler(): SumsubVerificationEventHandler {
    return this.onboardingService as unknown as SumsubVerificationEventHandler;
  }

  private ensureCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }

  @Post('simulate')
  @ApiOperation({ summary: 'Simulate Sumsub webhook events for a customer' })
  simulate(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: SimulateOnboardingSumsubEventDto,
  ) {
    const actorId = this.ensureCustomer(req);
    const payload: Record<string, unknown> = {
      type: body.eventType,
      levelName: body.levelName,
      reviewAnswer: body.reviewAnswer,
      reviewRejectType: body.reviewRejectType,
    };

    return this.sumsubHandler.handleSumsubVerificationEvent(payload, {
      simulated: true,
      actorId,
      levelName: body.levelName,
      reviewAnswer: body.reviewAnswer,
      reviewRejectType: body.reviewRejectType,
      rawBody: Buffer.from(JSON.stringify(payload)),
    });
  }
}
