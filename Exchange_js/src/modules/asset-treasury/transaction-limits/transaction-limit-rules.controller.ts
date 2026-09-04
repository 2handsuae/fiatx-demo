import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { TransactionLimitRuleWorkflowService } from './transaction-limit-rule-workflow.service';
import { ChangeTransactionLimitRuleDto } from './dto/transaction-limit-rule.dto';

@Controller('admin/transaction-limit-rules')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TransactionLimitRulesController {
  constructor(
    private readonly rulesService: TransactionLimitRulesService,
    private readonly workflow: TransactionLimitRuleWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-rules'))
  async findAll(@Query('gateType') gateType?: string) {
    return this.rulesService.findAll(gateType);
  }

  @Get(':ruleNo')
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-rules/:ruleNo'))
  async findOne(@Param('ruleNo') ruleNo: string) {
    return this.rulesService.findByNo(ruleNo);
  }

  @Post(':ruleNo/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/transaction-limit-rules/:ruleNo/change'))
  async requestChange(
    @Param('ruleNo') ruleNo: string,
    @Body() dto: ChangeTransactionLimitRuleDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.workflow.initiateChange(ruleNo, dto, this.buildAdminActor(req));
  }
}
