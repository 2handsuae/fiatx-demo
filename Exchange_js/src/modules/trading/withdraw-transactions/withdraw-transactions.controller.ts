import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { 
  WithdrawTransactionQueryDto,
  UpdateWithdrawTransactionStatusDto,
  CreateWithdrawTransactionDto 
} from './dto/withdraw-transaction.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Withdraw Transactions')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawTransactionsController {
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly onboardingService: OnboardingService,
  ) {}

  @Get('my')
  @ApiOperation({ summary: 'List my withdraw transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    const userId = req.user.userId;
    return this.service.findAll({ ...query, ownerId: userId });
  }

  @Get()
  @ApiOperation({ summary: 'List withdraw transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: WithdrawTransactionQueryDto) {
    return this.service.findAll(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a withdrawal request' })
  async create(@Req() req: any, @Body() dto: CreateWithdrawTransactionDto) {
    const userId = req.user.userId;
    await this.onboardingService.assertTradingEligibility(userId, 'WITHDRAW');
    return this.service.create(dto, userId);
  }

  @Post('mock')
  @ApiOperation({ summary: 'Create 10 mock withdraw transactions' })
  createMock() {
    return this.service.createMockData();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get withdraw transaction details' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update withdraw transaction status' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateWithdrawTransactionStatusDto,
  ) {
    return this.service.updateStatus(id, dto);
  }
}
