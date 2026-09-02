// src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { ListSumsubEventsQueryDto } from './dto/sumsub-ingestion.dto';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../identity/access-control/permission-code.util';

@ApiTags('Admin - Sumsub Events')
@Controller('admin/sumsub-events')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/sumsub-events'))
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

  // findOne()/replay() HTTP handlers retired (Task 4) — zero admin-web consumers (the
  // Sumsub Events page only ever listed events; the Replay button removed in this same
  // task was its one caller). Underlying SumsubIngestionService.findOne()/replay() had
  // no other callers either, so both were deleted too.
}
