import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OnboardingService } from './onboarding.service';

interface SumsubVerificationEventHandler {
  handleSumsubVerificationEvent(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<unknown>;
}

@ApiTags('Onboarding - Sumsub')
@Controller('onboarding/sumsub')
export class OnboardingSumsubWebhookController {
  constructor(
    @Inject('OnboardingService')
    private readonly onboardingService: OnboardingService,
  ) {}

  private get sumsubHandler(): SumsubVerificationEventHandler {
    return this.onboardingService as unknown as SumsubVerificationEventHandler;
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Receive Sumsub webhook events' })
  handleWebhook(
    @Req() req: { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-payload-digest') signature?: string,
  ) {
    return this.sumsubHandler.handleSumsubVerificationEvent(body, {
      rawBody: req.rawBody,
      signature,
      simulated: false,
      actorId: 'SUMSUB',
    });
  }
}
