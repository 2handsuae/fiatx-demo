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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import {
  CreateSwapTransactionDto,
  SwapTransactionQueryDto,
  UpdateSwapTransactionStatusDto,
} from './dto/swap-transaction.dto';

@ApiTags('Admin - Swap Transactions')
@Controller('admin/swap-transactions')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SwapTransactionsController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly orchestrator: SwapWorkflowOrchestrator,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new swap transaction' })
  async create(@Body() createSwapTransactionDto: CreateSwapTransactionDto) {
    return this.orchestrator.createSwap(createSwapTransactionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all swap transactions' })
  findAll(@Query() query: SwapTransactionQueryDto) {
    return this.swapTransactionsService.findAll(query);
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
