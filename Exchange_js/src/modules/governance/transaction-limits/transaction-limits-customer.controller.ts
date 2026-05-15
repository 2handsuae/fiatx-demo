import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TransactionLimitsService } from './transaction-limits.service';

@Controller('customer/my/trading-limits')
@UseGuards(AuthGuard('jwt'))
export class TransactionLimitsCustomerController {
  constructor(
    private readonly limitsService: TransactionLimitsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getMyLimits(@Req() req: any) {
    const customerId = req.user?.userId || req.user?.sub;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { tradingTier: true },
    });

    const tradingTier = customer?.tradingTier || 'BASIC';
    const policies = await this.limitsService.findByTradingTier(tradingTier);

    return {
      tradingTier,
      limits: policies.map((p) => ({
        policyNo: p.policyNo,
        operationType: p.operationType,
        period: p.period,
        limitAmount: p.limitAmount.toString(),
      })),
    };
  }
}
