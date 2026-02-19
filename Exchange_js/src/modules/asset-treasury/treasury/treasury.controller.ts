import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('treasury')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Get('customer/:customerId/assets')
  @ApiOperation({ summary: 'Get asset balances for a customer' })
  async getCustomerAssets(@Param('customerId') customerId: string) {
    return this.treasuryService.getCustomerAssets(customerId);
  }
}
