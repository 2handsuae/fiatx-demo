import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomerPortfolioService } from './customer-portfolio.service';
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';

@ApiTags('client/portfolio')
@ApiBearerAuth()
@Controller('client/portfolio')
@UseGuards(AuthGuard('jwt'))
export class CustomerPortfolioController {
  constructor(
    private readonly portfolioService: CustomerPortfolioService,
    private readonly registryService: TbAccountRegistryService,
    private readonly evidenceService: TbEvidenceService,
  ) {}

  @Get('balances')
  @ApiOperation({ summary: 'Get current customer portfolio balances from TB ledger' })
  async getBalances(@Request() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.portfolioService.getPortfolioBalances(req.user.userId);
  }

  @Get('statement')
  @ApiOperation({ summary: 'Get account statement for a specific asset' })
  async getStatement(@Request() req: any, @Query('assetCurrency') assetCurrency: string) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    if (!assetCurrency) {
      throw new BadRequestException({ code: 'MISSING_PARAMS', message: 'assetCurrency is required' });
    }

    const ledger = TB_LEDGERS[assetCurrency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new BadRequestException({ code: 'UNSUPPORTED_CURRENCY', message: `Unsupported currency: ${assetCurrency}` });
    }

    const registry = await this.registryService.resolve({
      code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      ledger,
      ownerType: 'CUSTOMER',
      ownerUuid: req.user.userId,
    });
    if (!registry) {
      return { items: [], currentBalance: 0, assetCurrency };
    }

    const statement = await this.evidenceService.getAccountStatement(registry.tbAccountId);
    return { ...statement, assetCurrency };
  }
}
