import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import {
  WithdrawTransactionQueryDto,
  CreateWithdrawTransactionDto,
} from './dto/withdraw-transaction.dto';

@ApiTags('Client Withdraw Transactions')
@ApiBearerAuth()
@Controller('client/withdraw-transactions')
@UseGuards(AuthGuard('jwt'))
export class CustomerWithdrawController {
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly workflow: WithdrawWorkflowService,
    private readonly onboardingService: OnboardingService,
  ) {}

  private assertCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId;
  }

  @Post()
  @ApiOperation({ summary: 'Create a withdrawal request (customer)' })
  async create(@Req() req: any, @Body() dto: CreateWithdrawTransactionDto) {
    const userId = this.assertCustomer(req);
    await this.onboardingService.assertTradingEligibility(userId, 'WITHDRAW');
    return this.workflow.createWithdrawal(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List my withdraw transactions (customer)' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    const userId = this.assertCustomer(req);
    return this.service.findAll({ ...query, ownerId: userId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get my withdraw transaction detail (customer)' })
  async findOne(@Req() req: any, @Param('id') id: string) {
    const userId = this.assertCustomer(req);
    const item = await this.service.findOneInternal(id);
    if (item.ownerId !== userId) {
      throw new ForbiddenException('Not your withdrawal');
    }
    return item;
  }
}
