import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { SimulateOnboardingSumsubEventDto } from './dto/onboarding.dto';

@ApiTags('Customer - Onboarding')
@Controller('onboarding/sumsub')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OnboardingSumsubSimulationController {
  constructor(private readonly onboardingService: OnboardingService) {}

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
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Simulation is only available in development');
    }

    const actorId = this.ensureCustomer(req);
    const payload: Record<string, unknown> = {
      type: body.eventType,
      levelName: body.levelName,
      reviewAnswer: body.reviewAnswer,
      reviewRejectType: body.reviewRejectType,
    };

    return this.onboardingService.handleSumsubVerificationEvent(payload, {
      simulated: true,
      actorId,
      levelName: body.levelName,
      reviewAnswer: body.reviewAnswer,
      reviewRejectType: body.reviewRejectType,
      rawBody: Buffer.from(JSON.stringify(payload)),
    });
  }
}
