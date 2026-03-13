import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  SaveWithdrawalPolicyDto,
  SaveSwapPolicyDto,
  SwapSimulatorDto,
} from './dto/pricing-center.dto';
import { PricingCenterService } from './pricing-center.service';

@ApiTags('Admin - Pricing Center')
@ApiBearerAuth()
@Controller('admin/pricing')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PricingCenterAdminController {
  constructor(private readonly pricingCenterService: PricingCenterService) {}

  private buildActor(req: any) {
    return {
      actorType: 'ADMIN' as const,
      actorId: String(req?.user?.userId || 'SYSTEM'),
      actorNo: req?.user?.userNo ? String(req.user.userNo) : undefined,
      actorRole: req?.user?.role ? String(req.user.role) : 'ADMIN',
    };
  }

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

  @Put('policies/swap')
  @ApiOperation({ summary: 'Replace swap pricing policy' })
  updateSwapPolicy(@Req() req: any, @Body() dto: SaveSwapPolicyDto) {
    return this.pricingCenterService.updateSwapPolicy(dto.config, this.buildActor(req));
  }

  @Get('policies/withdrawal')
  @ApiOperation({ summary: 'Get withdrawal pricing policy' })
  getWithdrawalPolicy() {
    return this.pricingCenterService.getWithdrawalPolicy();
  }

  @Put('policies/withdrawal')
  @ApiOperation({ summary: 'Replace withdrawal pricing policy' })
  updateWithdrawalPolicy(@Req() req: any, @Body() dto: SaveWithdrawalPolicyDto) {
    return this.pricingCenterService.updateWithdrawalPolicy(dto.config, this.buildActor(req));
  }

  @Post('simulator/swap')
  @ApiOperation({ summary: 'Simulate swap quote by pricing policy' })
  simulateSwap(@Req() req: any, @Body() dto: SwapSimulatorDto) {
    return this.pricingCenterService.simulateSwap(dto, this.buildActor(req));
  }

  @Get('policies/swap/pairs/:pairId/market-source')
  @ApiOperation({ summary: 'Get swap pair market source (read-only)' })
  getSwapPairMarketSource(@Param('pairId') pairId: string) {
    return this.pricingCenterService.getSwapPairMarketSource(pairId);
  }
}
