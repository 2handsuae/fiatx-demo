import { Controller, Get, Post, Body, Request, NotFoundException, BadRequestException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbManualAccountService } from './tb-manual-account.service';
import { CreateTbAccountDto } from './dto/create-tb-account.dto';
import { hexToBigint } from './utils/tb-id.util';
import { TB_ACCOUNT_CODES, isAssetCode } from './constants/tb-account-codes.constant';
import { TB_LEDGERS } from './constants/tb-ledgers.constant';
import { PrismaService } from '../../../core/prisma/prisma.service';

@ApiTags('TB Ledger Admin')
@Controller('admin/tb')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TbAdminController {
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly accountingService: AccountingService,
    private readonly tbManualAccountService: TbManualAccountService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('accounts')
  @ApiOperation({ summary: 'Manually create a TB account (system or customer)' })
  async createAccount(@Request() req: any, @Body() dto: CreateTbAccountDto) {
    return this.tbManualAccountService.manualCreate(
      {
        accountCategory: dto.accountCategory,
        assetCurrency: dto.assetCurrency,
        code: dto.code,
        customerNo: dto.customerNo,
        description: dto.description,
      },
      {
        actorId: req.user.userId,
        actorNo: req.user.userNo,
        actorRole: req.user.role || 'ADMIN',
      },
    );
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List TB account registry entries' })
  findAccounts(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('assetCurrency') assetCurrency?: string,
    @Query('ownerType') ownerType?: string,
    @Query('code') code?: string,
    @Query('q') q?: string,
  ) {
    return this.tbAccountRegistryService.findAll({
      assetCurrency: assetCurrency || undefined,
      ownerType: ownerType || undefined,
      code: code ? Number(code) : undefined,
      q: q || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('accounts/:tbAccountId')
  @ApiOperation({ summary: 'Get a single TB account with real-time balance' })
  async findOneAccount(@Param('tbAccountId') tbAccountId: string) {
    const registry = await this.tbAccountRegistryService.findByTbAccountId(tbAccountId);
    if (!registry) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_NOT_FOUND',
        message: `TB account ${tbAccountId} not found in registry`,
      });
    }

    let debitsPosted: string | null = null;
    let creditsPosted: string | null = null;
    let debitsPending: string | null = null;
    let creditsPending: string | null = null;
    let netBalance: string | null = null;

    try {
      const balance = await this.accountingService.lookupBalance(hexToBigint(tbAccountId));
      debitsPosted = balance.debitsPosted.toString();
      creditsPosted = balance.creditsPosted.toString();
      debitsPending = balance.debitsPending.toString();
      creditsPending = balance.creditsPending.toString();
      // Asset accounts are debit-normal; L/E are credit-normal. Sign by class
      // so assets don't show negative (mirrors verify-realtime-coa.ts).
      netBalance = (isAssetCode(registry.code)
        ? balance.debitsPosted - balance.creditsPosted
        : balance.creditsPosted - balance.debitsPosted
      ).toString();
    } catch {
      // TB unavailable — balance fields stay null
    }

    return {
      ...registry,
      debitsPosted,
      creditsPosted,
      debitsPending,
      creditsPending,
      netBalance,
    };
  }

  @Get('transfers')
  @ApiOperation({ summary: 'List TB transfer evidence entries' })
  findTransfers(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('sourceType') sourceType?: string,
    @Query('assetCurrency') assetCurrency?: string,
    @Query('eventCode') eventCode?: string,
    @Query('transferType') transferType?: string,
    @Query('q') q?: string,
    @Query('coa') coa?: string,
  ) {
    return this.tbEvidenceService.findAll({
      sourceType: sourceType || undefined,
      assetCurrency: assetCurrency || undefined,
      eventCode: eventCode || undefined,
      transferType: transferType || undefined,
      q: q || undefined,
      coa: coa || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('transfers/:tbTransferId')
  @ApiOperation({ summary: 'Get a single TB transfer evidence record' })
  async findOneTransfer(@Param('tbTransferId') tbTransferId: string) {
    const evidence = await this.tbEvidenceService.findOne(tbTransferId);
    if (!evidence) {
      throw new NotFoundException({
        code: 'TRANSFER_EVIDENCE_NOT_FOUND',
        message: `Transfer evidence ${tbTransferId} not found`,
      });
    }
    return evidence;
  }

  @Get('account-statement')
  @ApiOperation({ summary: 'Get account statement — by tbAccountId (any account), or customerNo+asset (legacy → CLIENT_PAYABLE)' })
  async getAccountStatement(
    @Query('tbAccountId') tbAccountId?: string,
    @Query('customerNo') customerNo?: string,
    @Query('assetCurrency') assetCurrency?: string,
  ) {
    // Path 1 — any account by tbAccountId (the multi-account statement entry).
    if (tbAccountId) {
      const registry = await this.tbAccountRegistryService.findByTbAccountId(tbAccountId);
      if (!registry) {
        throw new NotFoundException({ code: 'TB_ACCOUNT_NOT_FOUND', message: `TB account ${tbAccountId} not found` });
      }
      const asset = await this.prisma.asset.findFirst({ where: { currency: registry.assetCode, status: 'ACTIVE' } });
      const decimals = asset?.decimals ?? 6;
      const statement = await this.tbEvidenceService.getAccountStatement(tbAccountId);
      return {
        ...statement,
        decimals,
        assetCurrency: registry.assetCode,
        account: {
          tbAccountId: registry.tbAccountId,
          code: registry.code,
          ownerType: registry.ownerType,
          ownerNo: registry.ownerNo,
          ownerName: registry.ownerName ?? null,
          assetCode: registry.assetCode,
        },
      };
    }

    // Path 2 — legacy: customerNo + assetCurrency → that customer's CLIENT_PAYABLE.
    if (!customerNo || !assetCurrency) {
      throw new BadRequestException({ code: 'MISSING_PARAMS', message: 'tbAccountId, or customerNo + assetCurrency, is required' });
    }

    const ledger = TB_LEDGERS[assetCurrency as keyof typeof TB_LEDGERS];
    if (!ledger) {
      throw new BadRequestException({ code: 'UNSUPPORTED_CURRENCY', message: `Unsupported currency: ${assetCurrency}` });
    }

    const customer = await this.prisma.customerMain.findFirst({ where: { customerNo } });
    if (!customer) {
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: `Customer ${customerNo} not found` });
    }

    const asset = await this.prisma.asset.findFirst({ where: { currency: assetCurrency, status: 'ACTIVE' } });
    const decimals = asset?.decimals ?? 6;

    const registry = await this.tbAccountRegistryService.resolve({
      code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      ledger,
      ownerType: 'CUSTOMER',
      ownerUuid: customer.id,
    });
    if (!registry) {
      return { items: [], currentBalance: 0, customerNo, assetCurrency, decimals };
    }

    const statement = await this.tbEvidenceService.getAccountStatement(registry.tbAccountId);
    return { ...statement, customerNo, assetCurrency, decimals };
  }
}
