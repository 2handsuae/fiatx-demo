import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
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
import { WithdrawVerificationSessionService } from './withdraw-verification-session.service';
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
    private readonly verificationSessions: WithdrawVerificationSessionService,
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
    return this.service.findAllForCustomer(userId, query);
  }

  @Get('my/:withdrawNo/verification-session/:seq')
  @ApiOperation({ summary: 'Get my withdraw verification session' })
  getMyVerificationSession(
    @Req() req: any,
    @Param('withdrawNo') withdrawNo: string,
    @Param('seq', ParseIntPipe) seq: number,
  ) {
    const userId = this.assertCustomer(req);
    return this.verificationSessions.getSession(userId, withdrawNo, seq);
  }

  @Post('my/:withdrawNo/verification-session/:seq/submit')
  @ApiOperation({ summary: 'Mark my withdraw verification materials as submitted' })
  submitMyVerification(
    @Req() req: any,
    @Param('withdrawNo') withdrawNo: string,
    @Param('seq', ParseIntPipe) seq: number,
  ) {
    const userId = this.assertCustomer(req);
    return this.verificationSessions.submit(userId, withdrawNo, seq);
  }

  // ⚠️ 必须声明在 'my/:withdrawNo/verification-session/:seq' 之后——Nest 按
  // 声明顺序匹配路由，这条 'my/:withdrawNo' 段数更短，写前面会抢占上面那条
  // （mirrors deposit-transactions.controller.ts 同款排序纪律）。
  @Get('my/:withdrawNo')
  @ApiOperation({ summary: 'Get my withdraw transaction detail by withdrawNo (customer)' })
  getMyWithdrawByNo(@Req() req: any, @Param('withdrawNo') withdrawNo: string) {
    const userId = this.assertCustomer(req);
    return this.service.findOneForCustomerByWithdrawNo(withdrawNo, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get my withdraw transaction detail (customer)' })
  findOne(@Req() req: any, @Param('id') id: string) {
    const userId = this.assertCustomer(req);
    return this.service.findOneForCustomer(id, userId);
  }
}
