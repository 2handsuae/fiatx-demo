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
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelCreationWorkflowService } from './swap-fee-level-creation-workflow.service';
import { SwapFeeLevelChangeWorkflowService } from './swap-fee-level-change-workflow.service';
import { SwapFeeLevelBindingWorkflowService } from './swap-fee-level-binding-workflow.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';

@Controller('admin/swap-fee-levels')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class SwapFeeLevelController {
  constructor(
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly creationWorkflowService: SwapFeeLevelCreationWorkflowService,
    private readonly changeWorkflowService: SwapFeeLevelChangeWorkflowService,
    private readonly bindingWorkflowService: SwapFeeLevelBindingWorkflowService,
    private readonly bindingService: SwapFeeLevelBindingService,
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/swap-fee-levels'))
  async findAll(
    @Query('fromAssetId') fromAssetId?: string,
    @Query('toAssetId') toAssetId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: Prisma.SwapFeeLevelWhereInput = {};
    if (fromAssetId) where.fromAssetId = fromAssetId;
    if (toAssetId) where.toAssetId = toAssetId;
    if (status) where.status = status;
    const result = await this.feeLevelService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      where,
    });
    return { items: result.items, total: result.total };
  }

  @Get(':levelCode')
  @RequirePermissions(buildPermissionCode('GET', '/admin/swap-fee-levels/:levelCode'))
  async findOne(@Param('levelCode') levelCode: string) {
    return this.feeLevelService.findByLevelCode(levelCode);
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels'))
  async create(
    @Body() dto: {
      levelCode: string;
      name: string;
      fromAssetId: string;
      toAssetId: string;
      isDefault: boolean;
      tiersJson: string;
      reason: string;
    },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.creationWorkflowService.initiateCreate(dto, this.buildAdminActor(req));
  }

  @Post(':levelCode/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels/:levelCode/change'))
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
  @RequirePermissions(buildPermissionCode('GET', '/admin/swap-fee-levels/:levelCode/bindings'))
  async getBindings(@Param('levelCode') levelCode: string) {
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    return this.bindingService.findByLevel(level.id);
  }

  @Post('bindings/bind')
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels/bindings'))
  async bindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.bindLevel(dto, this.buildAdminActor(req));
  }

  @Delete('bindings/unbind')
  @RequirePermissions(buildPermissionCode('DELETE', '/admin/swap-fee-levels/bindings'))
  async unbindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.unbindLevel(dto, this.buildAdminActor(req));
  }
}
