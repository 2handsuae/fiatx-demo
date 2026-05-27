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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { 
  WithdrawTransactionQueryDto,
  AdminUpdateWithdrawTransactionStatusDto,
  WithdrawTransactionAction,
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
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AdminUpdateWithdrawTransactionStatusDto,
  ) {
    return this.service.updateStatus(
      id,
      {
        action: dto.action as unknown as WithdrawTransactionAction,
        reason: dto.reason,
      },
      {
        source: 'ADMIN_API',
        actorType: 'ADMIN',
        actorId: req.user?.userId || 'ADMIN_SYSTEM',
        actorRole: req.user?.role || 'ADMIN',
        sourcePlatform: 'ADMIN_API',
      },
    );
  }

  @Post(':id/simulate/kyt-phase1')
  @ApiOperation({ summary: '[DEV] Simulate KYT Phase 1 result' })
  async simulateKytPhase1(
    @Param('id') id: string,
    @Body() body: { result?: string; riskScore?: number },
  ) {
    const result = body.result || 'PASSED';
    const riskScore = body.riskScore ?? 10;
    await this.service.updateKytStatus(id, result, `SIM-KYT-${Date.now()}`, riskScore, 1);
    return { message: `KYT Phase 1 simulated: ${result}`, withdrawId: id, kytStatus: result };
  }

  @Post(':id/simulate/travel-rule')
  @ApiOperation({ summary: '[DEV] Simulate Travel Rule result' })
  async simulateTravelRule(
    @Param('id') id: string,
    @Body() body: { result?: string },
  ) {
    const result = body.result || 'PASSED';
    await this.service.updateTravelRuleStatus(id, result, result === 'PASSED' ? `SIM-TR-${Date.now()}` : null);
    return { message: `Travel Rule simulated: ${result}`, withdrawId: id, travelRuleStatus: result };
  }

  @Post(':id/simulate/payout-confirmed')
  @ApiOperation({ summary: '[DEV] Simulate payout confirmed event' })
  async simulatePayoutConfirmed(
    @Param('id') id: string,
    @Body() body: { txHash?: string },
  ) {
    const txHash = body.txHash || `0xSIM${Date.now().toString(16)}`;
    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { txHash },
    });
    this.eventEmitter.emit(DomainEventNames.PAYOUT_STATUS_CONFIRMED, {
      payoutId: id,
      withdrawId: id,
      txHash,
    });
    return { message: 'Payout confirmed simulated', withdrawId: id, txHash };
  }
}
