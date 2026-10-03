import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomerPortfolioService } from './customer-portfolio.service';
import { CustomerStatementService } from './customer-statement.service';
import { MonthlyStatementService } from './monthly-statement.service';
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { PrismaService } from '../../../core/prisma/prisma.service';

@ApiTags('client/portfolio')
@ApiBearerAuth()
@Controller('client/portfolio')
@UseGuards(AuthGuard('jwt'))
export class CustomerPortfolioController {
  constructor(
    private readonly portfolioService: CustomerPortfolioService,
    private readonly registryService: TbAccountRegistryService,
    private readonly evidenceService: TbEvidenceService,
    private readonly statementService: CustomerStatementService,
    private readonly monthlyStatements: MonthlyStatementService,
    private readonly prisma: PrismaService,
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
  async getStatement(
    @Request() req: any,
    @Query('assetCurrency') assetCurrency: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
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

    const asset = await this.prisma.asset.findFirst({
      where: { currency: assetCurrency },
      select: { decimals: true, type: true },
    });
    const decimals = asset?.decimals ?? 0;
    const isFiat = asset?.type === 'FIAT';

    const registry = await this.registryService.resolve({
      code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      ledger,
      ownerType: 'CUSTOMER',
      ownerUuid: req.user.userId,
    });
    if (!registry) {
      return { items: [], total: 0, currentBalance: 0, assetCurrency, decimals };
    }

    const { items: legs, currentBalance } = await this.evidenceService.getAccountStatement(registry.tbAccountId);
    const { items, total } = await this.statementService.buildStatement(legs, {
      isFiat,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      skip: skip !== undefined ? parseInt(skip, 10) : undefined,
      take: take !== undefined ? parseInt(take, 10) : undefined,
    });
    return { items, total, currentBalance, assetCurrency, decimals };
  }

  // 战役丙波四 T4：月结单读面（客户面零权限码；归属 = JWT 本人）。
  @Get('statements')
  @ApiOperation({ summary: 'List my issued monthly statements (newest month first)' })
  async listMonthlyStatements(@Request() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.monthlyStatements.listForCustomer(req.user.userId);
  }

  @Get('statements/:statementNo')
  @ApiOperation({ summary: 'Get one of my monthly statements (frozen snapshot)' })
  async getMonthlyStatement(@Request() req: any, @Param('statementNo') statementNo: string) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.monthlyStatements.getForCustomer(req.user.userId, statementNo);
  }
}
