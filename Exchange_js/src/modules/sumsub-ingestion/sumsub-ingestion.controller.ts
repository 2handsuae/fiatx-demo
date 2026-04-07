// src/modules/sumsub-ingestion/sumsub-ingestion.controller.ts
import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubClient } from '../identity/onboarding/providers/sumsub/sumsub.client';

@ApiTags('Webhooks')
@Controller('webhooks')
export class SumsubIngestionController {
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Post('sumsub')
  @ApiOperation({ summary: 'Unified Sumsub webhook receiver' })
  async handleWebhook(
    @Req() req: { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-payload-digest') signature?: string,
    @Headers('x-payload-digest-alg') digestAlg?: string,
  ) {
    if (!this.sumsubClient.verifyWebhookSignature(req.rawBody, signature, digestAlg)) {
      throw new UnauthorizedException('Invalid Sumsub webhook signature');
    }

    const { event } = await this.ingestionService.ingest(body, { isSimulated: false });
    return { received: true, eventNo: event.eventNo };
  }
}
