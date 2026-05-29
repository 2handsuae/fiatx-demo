import {
  Body,
  Controller,
  Delete,
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
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelCreationWorkflowService } from './withdrawal-fee-level-creation-workflow.service';
import { WithdrawalFeeLevelChangeWorkflowService } from './withdrawal-fee-level-change-workflow.service';
import { WithdrawalFeeLevelBindingWorkflowService } from './withdrawal-fee-level-binding-workflow.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';

@Controller('admin/withdrawal-fee-levels')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawalFeeLevelController {
  constructor(
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly creationWorkflowService: WithdrawalFeeLevelCreationWorkflowService,
    private readonly changeWorkflowService: WithdrawalFeeLevelChangeWorkflowService,
    private readonly bindingWorkflowService: WithdrawalFeeLevelBindingWorkflowService,
    private readonly bindingService: WithdrawalFeeLevelBindingService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin access required');
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels'))
  async findAll(
    @Query('assetId') assetId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: Prisma.WithdrawalFeeLevelWhereInput = {};
    if (assetId) where.assetId = assetId;
    if (status) where.status = status;
    const result = await this.feeLevelService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      where,
    });
    return { items: result.items, total: result.total };
  }

  @Get(':levelCode')
  @RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels/:levelCode'))
  async findOne(@Param('levelCode') levelCode: string) {
    return this.feeLevelService.findByLevelCode(levelCode);
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/withdrawal-fee-levels'))
  async create(
    @Body() dto: { levelCode: string; name: string; assetId: string; isDefault: boolean; tiersJson: string; reason: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.creationWorkflowService.initiateCreate(dto, this.buildAdminActor(req));
  }

  @Post(':levelCode/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/withdrawal-fee-levels/:levelCode/change'))
  async requestChange(
    @Param('levelCode') levelCode: string,
    @Body() dto: { proposedTiersJson: string; changeReason: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.changeWorkflowService.requestChange(
      levelCode,
      dto.proposedTiersJson,
      dto.changeReason,
      this.buildAdminActor(req),
    );
  }

  @Get(':levelCode/bindings')
  @RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels/:levelCode/bindings'))
  async getBindings(@Param('levelCode') levelCode: string) {
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    return this.bindingService.findByLevel(level.id);
  }

  @Post('bindings/bind')
  @RequirePermissions(buildPermissionCode('POST', '/admin/withdrawal-fee-levels/bindings'))
  async bindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.bindLevel(dto, this.buildAdminActor(req));
  }

  @Delete('bindings/unbind')
  @RequirePermissions(buildPermissionCode('DELETE', '/admin/withdrawal-fee-levels/bindings'))
  async unbindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.unbindLevel(dto, this.buildAdminActor(req));
  }
}
