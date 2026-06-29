import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { ReconciliationQueryService } from '../domain/reconciliation-query.service';
import { ReconRunQueryDto, ReconCaseQueryDto, ReconExternalBalanceQueryDto } from '../dto/reconciliation.dto';
import { WalletReconRunService } from '../workflow/wallet-recon-run.service';

@ApiTags('Admin - Reconciliation (V8)')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReconciliationAdminController {
  constructor(
    private readonly query: ReconciliationQueryService,
    private readonly walletReconRun: WalletReconRunService,
  ) {}

  @Post('runs/wallet')
  @ApiOperation({ summary: 'Trigger a per-wallet reconciliation run' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/runs/wallet'))
  async createWalletRun(@Body() dto: { cutoff: string }) {
    if (!dto?.cutoff) throw new BadRequestException('cutoff is required (ISO timestamp)');
    const cutoff = new Date(dto.cutoff);
    if (Number.isNaN(cutoff.getTime())) throw new BadRequestException('cutoff is not a valid ISO timestamp');
    return this.walletReconRun.run({ cutoff });
  }

  @Get('demo/compare')
  @ApiOperation({ summary: 'Demo compare: injected break manifest vs engine-detected case line-items' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/runs'))
  getDemoCompare(@Query('runNo') runNo: string) {
    return this.query.getDemoCompare(runNo);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List reconciliation runs' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/runs'))
  listRuns(@Query() q: ReconRunQueryDto) { return this.query.listRuns(q); }

  @Get('runs/:runNo')
  @ApiOperation({ summary: 'Reconciliation run detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/runs/:runNo'))
  getRun(@Param('runNo') runNo: string) { return this.query.getRun(runNo); }

  @Get('cases')
  @ApiOperation({ summary: 'List reconciliation cases' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases'))
  listCases(@Query() q: ReconCaseQueryDto) { return this.query.listCases(q); }

  @Get('cases/:caseNo')
  @ApiOperation({ summary: 'Reconciliation case detail (with line items)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases/:caseNo'))
  getCase(@Param('caseNo') caseNo: string) { return this.query.getCase(caseNo); }

  @Get('external-balances')
  @ApiOperation({ summary: 'List external account balances (per source/account/cutoff, grouped by book)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/external-balances'))
  listExternalBalances(@Query() q: ReconExternalBalanceQueryDto) { return this.query.listExternalBalances(q); }

  @Get('external-balances/:walletNo')
  @ApiOperation({ summary: 'External balance detail by walletNo + date (header fields + statement lines)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/external-balances/:walletNo'))
  getExternalBalanceByWallet(
    @Param('walletNo') walletNo: string,
    @Query('date') date: string,
  ) {
    if (!date) throw new BadRequestException('date query param is required (YYYY-MM-DD)');
    return this.query.getExternalBalanceByWallet(walletNo, date);
  }
}
