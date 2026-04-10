import {
  Body,
  Controller,
  forwardRef,
  Headers,
  Inject,
  Optional,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';
import { SumsubWebhookDispatcher } from '../sumsub-integration/sumsub-webhook-dispatcher.service';

@ApiTags('Onboarding - Sumsub')
@Controller('onboarding/sumsub')
export class OnboardingSumsubWebhookController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly sumsubClient: SumsubClient,
    @Optional()
    @Inject(forwardRef(() => SumsubWebhookDispatcher))
    private readonly dispatcher?: SumsubWebhookDispatcher,
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

    if (this.dispatcher) {
      return this.dispatcher.dispatch(body as any, {
        rawBody: req.rawBody,
        signature,
        simulated: false,
        actorId: 'SUMSUB',
      });
    }

    // Backward-compat fallback: dispatcher not loaded (e.g. in isolated unit tests)
    return this.onboardingService.handleSumsubVerificationEvent(body, {
      rawBody: req.rawBody,
      signature,
      digestAlg,
      simulated: false,
      actorId: 'SUMSUB',
    });
  }
}
