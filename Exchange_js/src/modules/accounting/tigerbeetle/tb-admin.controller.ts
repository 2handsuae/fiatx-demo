import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { hexToBigint } from './utils/tb-id.util';

@ApiTags('TB Ledger Admin')
@Controller('admin/tb')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TbAdminController {
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly accountingService: AccountingService,
  ) {}

  @Get('accounts')
  @ApiOperation({ summary: 'List TB account registry entries' })
  findAccounts(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('assetCode') assetCode?: string,
    @Query('ownerType') ownerType?: string,
    @Query('code') code?: string,
  ) {
    return this.tbAccountRegistryService.findAll({
      assetCode: assetCode || undefined,
      ownerType: ownerType || undefined,
      code: code ? Number(code) : undefined,
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
      netBalance = (balance.creditsPosted - balance.debitsPosted).toString();
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
    @Query('assetCode') assetCode?: string,
    @Query('eventCode') eventCode?: string,
    @Query('transferType') transferType?: string,
  ) {
    return this.tbEvidenceService.findAll({
      sourceType: sourceType || undefined,
      assetCode: assetCode || undefined,
      eventCode: eventCode || undefined,
      transferType: transferType || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('backlog')
  @ApiOperation({ summary: 'List TB evidence backlog entries' })
  findBacklog(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
  ) {
    return this.tbEvidenceService.findBacklog({
      status: status || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }
}
