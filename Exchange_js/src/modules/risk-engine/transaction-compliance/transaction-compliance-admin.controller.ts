import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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
  TxCaseListQueryDto,
} from './dto/tx-compliance.dto';
import { TransactionComplianceService } from './transaction-compliance.service';

@ApiTags('Admin - Transaction Compliance')
@Controller('admin/compliance')
@UseGuards(AuthGuard('jwt'))
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

  @Post('tx-kyt-cases/mock-complete')
  @ApiOperation({ summary: 'Mock complete a KYT transaction case' })
  mockCompleteKytCase(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockKytCaseCompleteDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.mockCompleteKytCase(body);
  }

  @Post('tx-travel-rule-cases/mock-complete')
  @ApiOperation({ summary: 'Mock complete a travel rule transaction case' })
  mockCompleteTravelRuleCase(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockTravelRuleCaseCompleteDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.mockCompleteTravelRuleCase(body);
  }

  @Post('tx-cases/mock-backfill')
  @ApiOperation({ summary: 'Mock backfill pending transaction compliance cases' })
  mockBackfill(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: MockBackfillDto,
  ) {
    this.ensureAdmin(req);
    return this.transactionComplianceService.mockBackfill(body);
  }

  @Get('tx-kyt-cases')
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
