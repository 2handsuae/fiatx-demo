import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { CreateWithdrawPricingQuoteDto } from './dto/pricing-center.dto';
import { PricingCenterService } from './pricing-center.service';
import { WithdrawQuoteService } from '../withdrawal-fee-level/withdraw-quote.service';

@ApiTags('Withdraw Pricing Quotes')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PricingCenterCustomerController {
  constructor(
    private readonly pricingCenterService: PricingCenterService,
    @Inject(forwardRef(() => WithdrawQuoteService))
    private readonly withdrawQuoteService: WithdrawQuoteService,
    private readonly onboardingService: OnboardingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('quotes')
  @ApiOperation({ summary: 'Create withdrawal pricing quote for transaction binding' })
  async createWithdrawQuote(@Req() req: any, @Body() dto: CreateWithdrawPricingQuoteDto) {
    const ownerType = String(req?.user?.type || 'CUSTOMER').toUpperCase();
    const ownerId = String(req?.user?.userId || '');
    if (!ownerId) {
      throw new BadRequestException('Token userId missing');
    }

    if (ownerType === 'CUSTOMER') {
      await this.onboardingService.assertTradingEligibility(ownerId, 'WITHDRAW');
    }

    const ownerNo = await this.pricingCenterService.resolveOwnerNo(ownerType, ownerId);

    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return this.withdrawQuoteService.createQuote({
      ownerType,
      ownerId,
      ownerNo: ownerNo ?? undefined,
      assetId: dto.assetId,
      assetCode: asset.currency,
      amount: new Prisma.Decimal(dto.amount),
      customerId: ownerId,
    });
  }

  @Post('quotes/:id/cancel')
  @ApiOperation({ summary: 'Cancel an active withdrawal pricing quote' })
  async cancelWithdrawQuote(@Req() req: any, @Param('id') id: string) {
    const ownerType = String(req?.user?.type || 'CUSTOMER').toUpperCase();
    const ownerId = String(req?.user?.userId || '');
    if (!ownerId) {
      throw new BadRequestException('Token userId missing');
    }

    return this.withdrawQuoteService.cancelQuote(
      id,
      ownerType,
      ownerId,
    );
  }
}
