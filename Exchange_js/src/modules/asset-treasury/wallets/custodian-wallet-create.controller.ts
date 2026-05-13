import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { CustodianWalletCreateWorkflowService } from './custodian-wallet-create-workflow.service';
import { CreateCustodianWalletDto } from './dto/create-custodian-wallet.dto';

@Controller('admin/custodian-wallets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustodianWalletCreateController {
  constructor(
    private readonly workflowService: CustodianWalletCreateWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/custodian-wallets'))
  async create(@Body() dto: CreateCustodianWalletDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.initiateCreate(dto, this.buildAdminActor(req));
  }

  @Post(':walletNo/retry')
  @RequirePermissions(buildPermissionCode('POST', '/admin/custodian-wallets/:walletNo/retry'))
  async retry(@Param('walletNo') walletNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.retryCreate(walletNo, this.buildAdminActor(req));
  }
}
