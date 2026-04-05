import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';

@ApiTags('Onboarding - Sumsub')
@Controller('onboarding/sumsub')
export class OnboardingSumsubWebhookController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Receive Sumsub webhook events' })
  handleWebhook(
    @Req() req: { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-payload-digest') signature?: string,
    @Headers('x-payload-digest-alg') digestAlg?: string,
  ) {
    if (!this.sumsubClient.verifyWebhookSignature(req.rawBody, signature, digestAlg)) {
      throw new UnauthorizedException('Invalid Sumsub webhook signature');
    }

    return this.onboardingService.handleSumsubVerificationEvent(body, {
      rawBody: req.rawBody,
      signature,
      digestAlg,
      simulated: false,
      actorId: 'SUMSUB',
    });
  }
}
