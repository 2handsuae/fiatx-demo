import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  MockBackfillDto,
  MockKytCaseCompleteDto,
  MockTravelRuleCaseCompleteDto,
  TxKytCaseCallbackDto,
  TxTravelRuleCaseCallbackDto,
  TxCaseListQueryDto,
} from './dto/tx-compliance.dto';
import { TxSourceType } from './types/tx-compliance.types';
import { TransactionComplianceService } from './transaction-compliance.service';

@ApiTags('Admin - Transaction Compliance')
@Controller('admin/compliance')
@ApiBearerAuth()
export class TransactionComplianceAdminController {
  constructor(
    private readonly transactionComplianceService: TransactionComplianceService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private ensureCallbackAuthorized(req: any, signature?: string) {
    const configured = process.env.TX_COMPLIANCE_CALLBACK_SIGNATURE?.trim();
    if (configured) {
      if (signature !== configured) {
        throw new ForbiddenException('Invalid callback signature');
      }
      return;
    }
    this.ensureAdmin(req);
  }

  @Post('tx-kyt-cases/callback')
  @ApiOperation({ summary: 'Upsert KYT transaction case from external callback' })
  callbackKytCase(
    @Req() req: any,
    @Headers('x-tx-compliance-signature') signature: string | undefined,
    @Body(new ValidationPipe({ transform: true })) body: TxKytCaseCallbackDto,
  ) {
    this.ensureCallbackAuthorized(req, signature);
    return this.transactionComplianceService.callbackKytCase(body);
  }

  @Post('tx-travel-rule-cases/callback')
  @ApiOperation({
    summary: 'Upsert travel rule transaction case from external callback',
  })
  callbackTravelRuleCase(
    @Req() req: any,
    @Headers('x-tx-compliance-signature') signature: string | undefined,
    @Body(new ValidationPipe({ transform: true }))
    body: TxTravelRuleCaseCallbackDto,
  ) {
    this.ensureCallbackAuthorized(req, signature);
    return this.transactionComplianceService.callbackTravelRuleCase(body);
  }

  @Get('tx-cases/:sourceType/:sourceId')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @ApiOperation({
    summary: 'Get aggregated transaction compliance cases by source',
  })
  getTransactionCases(
    @Req() req: any,
    @Param('sourceType') sourceTypeRaw: string,
    @Param('sourceId') sourceId: string,
    @Query('includeReports') includeReportsRaw?: string,
    @Query('includePayload') includePayloadRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    this.ensureAdmin(req);
    const sourceType = String(sourceTypeRaw || '').toUpperCase() as TxSourceType;
    const includeReports = includeReportsRaw !== 'false';
    const includePayload = includePayloadRaw === 'true';
    const limit = limitRaw ? Number(limitRaw) : 20;
    const offset = offsetRaw ? Number(offsetRaw) : 0;
    return this.transactionComplianceService.getTransactionCaseAggregate(
      sourceType,
      sourceId,
      { includeReports, includePayload, limit, offset },
    );
  }

  @Post('tx-kyt-cases/mock-complete')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @ApiOperation({ summary: 'Mock complete a KYT transaction case' })
  mockCompleteKytCase(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockKytCaseCompleteDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.mockCompleteKytCase(body);
  }

  @Post('tx-travel-rule-cases/mock-complete')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @ApiOperation({ summary: 'Mock complete a travel rule transaction case' })
  mockCompleteTravelRuleCase(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockTravelRuleCaseCompleteDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.mockCompleteTravelRuleCase(body);
  }

  @Post('tx-cases/mock-backfill')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @ApiOperation({ summary: 'Mock backfill pending transaction compliance cases' })
  mockBackfill(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockBackfillDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.mockBackfill(body);
  }

  // KYT/Travel Rule/Tx Evidence endpoints expose provider responses and
  // evidence containers; they are not the platform compliance Case object.
  @Get('tx-kyt-cases')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @ApiOperation({ summary: 'List transaction KYT cases' })
  @ApiQuery({ name: 'sourceType', required: false, type: String })
  @ApiQuery({ name: 'sourceId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'provider', required: false, type: String })
  @ApiQuery({ name: 'screeningStage', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listKytCases(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: TxCaseListQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.listKytCases(query);
  }

  @Get('tx-travel-rule-cases')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  @ApiOperation({ summary: 'List transaction travel rule cases' })
  @ApiQuery({ name: 'sourceType', required: false, type: String })
  @ApiQuery({ name: 'sourceId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'provider', required: false, type: String })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  listTravelRuleCases(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: TxCaseListQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.listTravelRuleCases(query);
  }
}
