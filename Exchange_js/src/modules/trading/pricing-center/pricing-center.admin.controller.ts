import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminPricingQuoteQueryDto,
  PricingQuoteBusiness,
  SwapSimulatorDto,
  WithdrawalSimulatorDto,
} from './dto/pricing-center.dto';
import { PricingCenterService } from './pricing-center.service';

@ApiTags('Admin - Pricing Center')
@ApiBearerAuth()
@Controller('admin/pricing')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PricingCenterAdminController {
  constructor(private readonly pricingCenterService: PricingCenterService) {}

  @Get('policies')
  @ApiOperation({ summary: 'List pricing policies (swap + withdrawal)' })
  listPolicies() {
    return this.pricingCenterService.listPolicies();
  }

  @Get('policies/swap')
  @ApiOperation({ summary: 'Get swap pricing policy' })
  getSwapPolicy() {
    return this.pricingCenterService.getSwapPolicy();
  }

  @Get('policies/withdrawal')
  @ApiOperation({ summary: 'Get withdrawal pricing policy' })
  getWithdrawalPolicy() {
    return this.pricingCenterService.getWithdrawalPolicy();
  }

  @Post('simulator/swap')
  @ApiOperation({ summary: 'Simulate swap quote by pricing policy' })
  simulateSwap(@Body() dto: SwapSimulatorDto) {
    return this.pricingCenterService.simulateSwap(dto, {
      actorType: 'ADMIN',
      actorId: 'SYSTEM',
      actorNo: 'SYSTEM',
      actorRole: 'ADMIN',
    });
  }

  @Post('simulator/withdrawal')
  @ApiOperation({ summary: 'Simulate withdrawal quote by pricing policy' })
  simulateWithdrawal(@Body() dto: WithdrawalSimulatorDto) {
    return this.pricingCenterService.simulateWithdrawal(dto, {
      actorType: 'ADMIN',
      actorId: 'SYSTEM',
      actorNo: 'SYSTEM',
      actorRole: 'ADMIN',
    });
  }

  @Get('quotes')
  @ApiOperation({ summary: 'List pricing quotes (swap + withdrawal)' })
  listQuotes(@Query() query: AdminPricingQuoteQueryDto) {
    return this.pricingCenterService.listAdminPricingQuotes(query);
  }

  @Get('quotes/:business/:id')
  @ApiOperation({ summary: 'Get pricing quote detail (swap + withdrawal)' })
  getQuoteDetail(
    @Param('business') business: PricingQuoteBusiness,
    @Param('id') id: string,
  ) {
    return this.pricingCenterService.getAdminPricingQuoteDetail(business, id);
  }

  @Get('policies/swap/pairs/:pairId/market-source')
  @ApiOperation({ summary: 'Get swap pair market source (read-only)' })
  getSwapPairMarketSource(@Param('pairId') pairId: string) {
    return this.pricingCenterService.getSwapPairMarketSource(pairId);
  }
}
