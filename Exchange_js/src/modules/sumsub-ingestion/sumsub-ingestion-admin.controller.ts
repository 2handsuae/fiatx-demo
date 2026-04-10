// src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import {
  ListSumsubEventsQueryDto,
  SimulateEventDto,
} from './dto/sumsub-ingestion.dto';

@ApiTags('Admin - Sumsub Events')
@Controller('admin/sumsub-events')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SumsubIngestionAdminController {
  constructor(private readonly ingestionService: SumsubIngestionService) {}

  private requireAdmin(req: any): string {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return req.user.userId as string;
  }

  @Get()
  @ApiOperation({ summary: 'List Sumsub webhook events' })
  list(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: ListSumsubEventsQueryDto,
  ) {
    this.requireAdmin(req);
    return this.ingestionService.list({
      status: query.status,
      eventType: query.eventType,
      externalUserId: query.externalUserId,
      applicantId: query.applicantId,
      skip: query.skip ? Number(query.skip) : 0,
      take: query.take ? Number(query.take) : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Sumsub webhook event detail' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.ingestionService.findOne(id);
  }

  @Post('simulate')
  @ApiOperation({ summary: 'Simulate a Sumsub event for demo / testing' })
  simulate(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: SimulateEventDto,
  ) {
    const adminId = this.requireAdmin(req);
    return this.ingestionService.simulate(
      body.customerId,
      body.scenario,
      adminId,
      body.overrides,
      body.customerNo,
    );
  }

  @Post(':id/replay')
  @ApiOperation({ summary: 'Replay a DEAD Sumsub webhook event' })
  replay(@Req() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.ingestionService.replay(id);
  }
}
