import { Controller, Get, Param, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { ReconciliationQueryService } from '../domain/reconciliation-query.service';
import { ReconRunQueryDto, ReconCaseQueryDto, ReconExternalBalanceQueryDto } from '../dto/reconciliation.dto';

@ApiTags('Admin - Reconciliation (V8)')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReconciliationAdminController {
  constructor(private readonly query: ReconciliationQueryService) {}

  @Get('redesign/latest')
  @ApiOperation({ summary: 'Latest redesign reconciliation run (5-formula result + cases + 4-bucket line items)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/runs'))
  getRedesignLatest(@Query() q: ReconRunQueryDto) {
    return this.query.getLatestRedesignRun(q.businessDate);
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

  @Get('external-balances/:statementId')
  @ApiOperation({ summary: 'External balance detail (header fields + its statement lines)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/external-balances/:statementId'))
  getExternalBalance(@Param('statementId') statementId: string) { return this.query.getExternalBalance(statementId); }
}
