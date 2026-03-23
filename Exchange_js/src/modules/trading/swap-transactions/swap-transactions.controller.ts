import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import {
  CreateSwapTransactionDto,
  SwapTransactionQueryDto,
  UpdateSwapTransactionStatusDto,
} from './dto/swap-transaction.dto';
import { AdminSwapQuoteQueryDto } from './dto/swap-quote.dto';
import { PricingCenterService } from '../pricing-center/pricing-center.service';
import { PricingQuoteBusiness } from '../pricing-center/dto/pricing-center.dto';

@ApiTags('Admin - Swap Transactions')
@Controller('admin/swap-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SwapTransactionsController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly orchestrator: SwapWorkflowOrchestrator,
    private readonly pricingCenterService: PricingCenterService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new swap transaction' })
  async create(@Body() _createSwapTransactionDto: CreateSwapTransactionDto) {
    throw new ForbiddenException('Admin direct swap creation is disabled');
  }

  @Get()
  @ApiOperation({ summary: 'Get all swap transactions' })
  findAll(@Query() query: SwapTransactionQueryDto) {
    return this.swapTransactionsService.findAll(query);
  }

  @Get('quotes')
  @ApiOperation({ summary: 'Compatibility alias: get swap quotes through the unified Quote Center read model' })
  findAllQuotes(@Query() query: AdminSwapQuoteQueryDto) {
    return this.pricingCenterService.listAdminPricingQuotes({
      ...query,
      business: PricingQuoteBusiness.SWAP,
    });
  }

  @Get('quotes/:id')
  @ApiOperation({ summary: 'Compatibility alias: get swap quote detail through the unified Quote Center read model' })
  findOneQuote(@Param('id') id: string) {
    return this.pricingCenterService.getAdminPricingQuoteDetail(
      PricingQuoteBusiness.SWAP,
      id,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get swap transaction by ID' })
  findOne(@Param('id') id: string) {
    return this.swapTransactionsService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update swap transaction status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateSwapTransactionStatusDto,
    @Request() req: any,
  ) {
    const operatorId = req.user.userId || 'ADMIN_SYSTEM';
    return this.orchestrator.handleStatusTransition(
      id,
      updateStatusDto,
      operatorId,
    );
  }
}
