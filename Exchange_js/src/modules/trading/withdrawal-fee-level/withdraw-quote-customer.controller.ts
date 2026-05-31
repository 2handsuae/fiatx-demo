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
import { CreateWithdrawPricingQuoteDto } from '../pricing-center/dto/pricing-center.dto';
import { WithdrawQuoteService } from './withdraw-quote.service';

@ApiTags('Withdraw Pricing Quotes')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawQuoteCustomerController {
  constructor(
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

    // Resolve owner number inline (no PricingCenterService dependency)
    let ownerNo: string | null = null;
    if (ownerType === 'CUSTOMER') {
      const cust = await this.prisma.customerMain.findUnique({ where: { id: ownerId }, select: { customerNo: true } });
      ownerNo = cust?.customerNo || null;
    }

    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const quote = await this.withdrawQuoteService.createQuote({
      ownerType,
      ownerId,
      ownerNo: ownerNo ?? undefined,
      assetId: dto.assetId,
      assetCode: asset.currency,
      amount: new Prisma.Decimal(dto.amount),
      customerId: ownerId,
    });

    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      matched: {
        assetEntryId: quote.matchedAssetId,
        tierId: quote.matchedTierId,
        tierName: quote.matchedTierName,
      },
      fees: JSON.parse(quote.feeBreakdown as string),
      totals: JSON.parse(quote.totalsJson as string),
    };
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
