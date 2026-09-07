import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { DispositionService } from './disposition.service';
import { SupplementEvidenceService } from './supplement-evidence.service';
import { RecordDispositionDto } from '../dto/disposition.dto';

@ApiTags('Admin - Reconciliation Disposition (Recon · Findings)')
@ApiBearerAuth()
@Controller('admin/reconciliation/cases/:caseNo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DispositionController {
  constructor(
    private readonly disposition: DispositionService,
    private readonly supplementEvidence: SupplementEvidenceService,
  ) {}

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  @Post('dispositions')
  @ApiOperation({ summary: 'Record finding: log the investigation conclusion (cause + note); outlet is determined by the registry' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/cases/:caseNo/dispositions'))
  record(@Param('caseNo') caseNo: string, @Body() dto: RecordDispositionDto, @Req() req: any) {
    return this.disposition.record(caseNo, dto, this.buildActor(req));
  }

  @Get('reattribution-candidates')
  @ApiOperation({ summary: 'Reattribution candidates: same-day, same-asset, same-amount opposite orphans' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases/:caseNo/reattribution-candidates'))
  candidates(@Param('caseNo') caseNo: string, @Query('side') side: 'FROM' | 'TO', @Query('amount') amount: string) {
    return this.disposition.listReattributionCandidates(caseNo, side, amount);
  }

  @Get('supplement-candidates')
  @ApiOperation({ summary: 'Statement-line facts + candidate original orders for a supplement (Recon Batch B)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases/:caseNo/supplement-candidates'))
  supplementCandidates(@Param('caseNo') caseNo: string, @Query('externalLineId') externalLineId: string) {
    return this.supplementEvidence.listCandidates(caseNo, externalLineId);
  }
}
