import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import {
  CreateSwapTransactionDto,
  SwapTransactionQueryDto,
} from './dto/swap-transaction.dto';

@ApiTags('Customer - Swap Transactions')
@Controller('swap-transactions')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SwapTransactionsCustomerController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly orchestrator: SwapWorkflowOrchestrator,
    private readonly onboardingService: OnboardingService,
  ) {}

  @Post('preview')
  @ApiOperation({ summary: 'Preview swap rate and amount' })
  preview(
    @Body() dto: { fromAssetId: string; fromAmount: number; toAssetId: string },
  ) {
    return this.swapTransactionsService.preview(dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new swap transaction for current customer',
  })
  async create(@Request() req: any, @Body() dto: CreateSwapTransactionDto) {
    // Force ownerId to be current user
    dto.ownerId = req.user.userId;
    dto.ownerType = 'CUSTOMER';
    await this.onboardingService.assertTradingEligibility(dto.ownerId, 'SWAP');
    return this.orchestrator.createSwap(dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get all swap transactions for current customer' })
  findMy(@Request() req: any, @Query() query: SwapTransactionQueryDto) {
    query.ownerId = req.user.userId;
    query.ownerType = 'CUSTOMER';
    return this.swapTransactionsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get swap transaction by ID' })
  async findOne(@Request() req: any, @Param('id') id: string) {
    const item = await this.swapTransactionsService.findOne(id);
    if (item.ownerId !== req.user.userId) {
      throw new Error('Unauthorized');
    }
    return item;
  }
}
