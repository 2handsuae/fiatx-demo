import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { CreateWithdrawPricingQuoteDto } from './dto/pricing-center.dto';
import { PricingCenterService } from './pricing-center.service';

@ApiTags('Withdraw Pricing Quotes')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PricingCenterCustomerController {
  constructor(
    private readonly pricingCenterService: PricingCenterService,
    private readonly onboardingService: OnboardingService,
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

    return this.pricingCenterService.createWithdrawPricingQuote(
      ownerType,
      ownerId,
      ownerNo,
      dto,
    );
  }

  @Post('quotes/:id/cancel')
  @ApiOperation({ summary: 'Cancel an active withdrawal pricing quote' })
  async cancelWithdrawQuote(@Req() req: any, @Param('id') id: string) {
    const ownerType = String(req?.user?.type || 'CUSTOMER').toUpperCase();
    const ownerId = String(req?.user?.userId || '');
    if (!ownerId) {
      throw new BadRequestException('Token userId missing');
    }

    return this.pricingCenterService.cancelWithdrawPricingQuote(
      id,
      ownerType,
      ownerId,
    );
  }
}
