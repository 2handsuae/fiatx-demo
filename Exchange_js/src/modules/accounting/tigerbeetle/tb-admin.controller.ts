import { Controller, Get, Post, Body, Request, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbManualAccountService } from './tb-manual-account.service';
import { CreateTbAccountDto } from './dto/create-tb-account.dto';
import { hexToBigint } from './utils/tb-id.util';
import { isAssetCode, accountNameOf } from './constants/tb-account-codes.constant';

@ApiTags('TB Ledger Admin')
@Controller('admin/tb')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TbAdminController {
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly accountingService: AccountingService,
    private readonly tbManualAccountService: TbManualAccountService,
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
      // 科目名称随行下发(2026-08-13):唯一真相源在 tb-account-codes.constant.ts。
      accountName: accountNameOf(registry.code),
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

  @Get('account-flows')
  @ApiOperation({ summary: 'List account_flows (raw per-account ledger rows)' })
  findAccountFlows(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('tbAccountId') tbAccountId?: string,
    @Query('customerNo') customerNo?: string,
    @Query('walletRef') walletRef?: string,
    @Query('direction') direction?: string,
    @Query('assetCurrency') assetCurrency?: string,
    @Query('sourceType') sourceType?: string,
    @Query('transferType') transferType?: string,
    @Query('effectiveFrom') effectiveFrom?: string,
    @Query('effectiveTo') effectiveTo?: string,
    @Query('q') q?: string,
  ) {
    return this.tbEvidenceService.findAllFlows({
      tbAccountId: tbAccountId || undefined,
      customerNo: customerNo || undefined,
      walletRef: walletRef || undefined,
      direction: direction || undefined,
      assetCurrency: assetCurrency || undefined,
      sourceType: sourceType || undefined,
      transferType: transferType || undefined,
      effectiveFrom: effectiveFrom || undefined,
      effectiveTo: effectiveTo || undefined,
      q: q || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('wallets')
  @ApiOperation({ summary: 'List distinct walletRefs from account_flows with owner info (T4)' })
  async listWallets() {
    const items = await this.tbEvidenceService.listWallets();
    return { items };
  }
}
