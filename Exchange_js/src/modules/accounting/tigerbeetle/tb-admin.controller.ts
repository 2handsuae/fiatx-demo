import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';

@ApiTags('TB Ledger Admin')
@Controller('admin/tb')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TbAdminController {
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
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
