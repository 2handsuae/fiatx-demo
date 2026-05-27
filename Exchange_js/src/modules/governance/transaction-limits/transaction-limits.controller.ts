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
import { Prisma } from '@prisma/client';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { TransactionLimitsService } from './transaction-limits.service';
import { TransactionLimitChangeWorkflowService } from './transaction-limit-change-workflow.service';
import { TransactionLimitCreationWorkflowService } from './transaction-limit-creation-workflow.service';
import { UpdateLimitDto } from './dto/update-limit.dto';
import { CreateLimitPolicyDto } from './dto/create-limit-policy.dto';

@Controller('admin/transaction-limit-policies')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TransactionLimitsController {
  constructor(
    private readonly limitsService: TransactionLimitsService,
    private readonly workflowService: TransactionLimitChangeWorkflowService,
    private readonly creationWorkflowService: TransactionLimitCreationWorkflowService,
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

  @Get('trading-tiers')
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-policies'))
  async getTradingTiers() {
    return this.limitsService.getAvailableTradingTiers();
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-policies'))
  async findAll(
    @Query('tradingTier') tradingTier?: string,
    @Query('operationType') operationType?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: Prisma.TransactionLimitPolicyWhereInput = {};
    if (tradingTier) where.tradingTier = tradingTier;
    if (operationType) where.operationType = operationType;

    const result = await this.limitsService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      where,
    });
    return {
      items: result.items.map(this.serializePolicy),
      total: result.total,
    };
  }

  @Get(':policyNo')
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-policies/:policyNo'))
  async findOne(@Param('policyNo') policyNo: string) {
    const policy = await this.limitsService.findByPolicyNo(policyNo);
    return this.serializePolicy(policy);
  }

  private serializePolicy(policy: any) {
    return {
      ...policy,
      limitAmount: policy.limitAmount?.toString?.() ?? String(policy.limitAmount),
    };
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/transaction-limit-policies'))
  async create(
    @Body() dto: CreateLimitPolicyDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.creationWorkflowService.initiateCreate(
      {
        tradingTier: dto.tradingTier,
        operationType: dto.operationType,
        period: dto.period,
        limitAmount: dto.limitAmount,
        reason: dto.reason,
      },
      this.buildAdminActor(req),
    );
  }

  @Post(':policyNo/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/transaction-limit-policies/:policyNo/change'))
  async requestChange(
    @Param('policyNo') policyNo: string,
    @Body() dto: UpdateLimitDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.workflowService.requestChange(
      policyNo,
      dto.limitAmount,
      dto.changeReason,
      this.buildAdminActor(req),
    );
  }
}
