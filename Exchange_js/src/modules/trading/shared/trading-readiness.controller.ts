import { Controller, Get, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { WalletQueryService } from '../../asset-treasury/wallets/wallet-query.service';
import { AssetsService } from '../../asset-treasury/assets/assets.service';

@ApiTags('client/trading-readiness')
@ApiBearerAuth()
@Controller('client/trading-readiness')
@UseGuards(AuthGuard('jwt'))
export class TradingReadinessController {
  constructor(
    private readonly withdrawalAddresses: WithdrawalAddressService,
    private readonly walletQuery: WalletQueryService,
    private readonly assets: AssetsService,
  ) {}

  private extractCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return { customerId: req.user.userId };
  }

  @Get('trading-readiness')
  @ApiOperation({ summary: 'Whether the customer has an active fiat withdrawal address (R1 gate)' })
  async readiness(@Request() req: any) {
    const { customerId } = this.extractCustomer(req);
    const has = await this.withdrawalAddresses.hasActiveFiatWithdrawalAddress(customerId);
    return { tradingReady: has, hasActiveFiatWithdrawalAddress: has };
  }

  @Get('receiving-accounts')
  @ApiOperation({ summary: 'Per-asset-code whether the customer has a receiving account (R4 gate)' })
  async receiving(@Request() req: any, @Query('assets') assets: string) {
    const { customerId } = this.extractCustomer(req);
    const codes = (assets ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const out: Record<string, { hasReceivingAccount: boolean }> = {};
    for (const code of codes) {
      const asset = await this.assets.findByCode(code);
      out[code] = {
        hasReceivingAccount: asset ? await this.walletQuery.hasReceivingAccount(customerId, asset.id) : false,
      };
    }
    return out;
  }
}
