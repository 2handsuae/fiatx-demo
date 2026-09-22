import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { ReconciliationQueryService } from '../domain/reconciliation-query.service';
import { ReconRunQueryDto, ReconCaseQueryDto, ReconExternalBalanceQueryDto } from '../dto/reconciliation.dto';
import { WalletReconRunService } from '../workflow/wallet-recon-run.service';
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';
import { endOfBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

@ApiTags('Admin - Reconciliation (V8)')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReconciliationAdminController {
  constructor(
    private readonly query: ReconciliationQueryService,
    private readonly walletReconRun: WalletReconRunService,
    private readonly caseService: ReconciliationCaseService,
  ) {}

  @Post('runs/wallet')
  @ApiOperation({ summary: 'Trigger a per-wallet reconciliation run' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/runs/wallet'))
  async createWalletRun(@Body() dto: { cutoff?: string; businessDate?: string }, @Req() req: any) {
    const hasCutoff = !!dto?.cutoff;
    const hasBusinessDate = !!dto?.businessDate;
    if (hasCutoff === hasBusinessDate) {
      throw new BadRequestException('Provide exactly one of cutoff (ISO timestamp) or businessDate (YYYY-MM-DD)');
    }
    let cutoff: Date;
    if (hasBusinessDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.businessDate!)) throw new BadRequestException('businessDate must be YYYY-MM-DD');
      cutoff = endOfBusinessDate(dto.businessDate!);
    } else {
      cutoff = new Date(dto.cutoff!);
      if (Number.isNaN(cutoff.getTime())) throw new BadRequestException('cutoff is not a valid ISO timestamp');
    }
    // 铁律①：管理员手动触发跑批要记他名字（cron 路径不传 actor,走系统通道）。
    const operatorId = req.user?.userNo || req.user?.sub || 'ADMIN';
    return this.walletReconRun.run(
      { cutoff },
      { actorType: 'ADMIN', actorNo: operatorId, actorDisplayName: operatorId, actorRolesAtTime: ['ADMIN'] },
    );
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

  @Post('cases/:caseNo/simulate-aging-timeout')
  @ApiOperation({ summary: '演示用：把该案件的账龄截止拨到过去，下一分钟扫描即超期' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/cases/:caseNo/simulate-aging-timeout'))
  simulateAgingTimeout(@Param('caseNo') caseNo: string, @Req() req: any) {
    const user = req.user;
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
    return this.caseService.simulateTimeout(caseNo, actor);
  }

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
