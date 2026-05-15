import { Controller, Get, Post, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { ListWithdrawalAddressQueryDto } from './dto/list-withdrawal-address-query.dto';
import { SuspendWithdrawalAddressDto } from './dto/suspend-withdrawal-address.dto';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';

@ApiTags('admin/withdrawal-addresses')
@ApiBearerAuth()
@Controller('admin/withdrawal-addresses')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawalAddressAdminController {
  constructor(
    private readonly workflowService: WithdrawalAddressWorkflowService,
    private readonly addressService: WithdrawalAddressService,
  ) {}

  private extractAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return {
      userId: req.user.userId,
      userNo: req.user.userNo ?? req.user.userId,
      role: req.user.role ?? req.user.roleCodes?.[0] ?? 'UNKNOWN',
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all withdrawal addresses' })
  async list(@Query() query: ListWithdrawalAddressQueryDto) {
    return this.addressService.listAll(query);
  }

  @Get(':addressNo')
  @ApiOperation({ summary: 'Get withdrawal address detail' })
  async findOne(@Param('addressNo') addressNo: string) {
    return this.addressService.findByNo(addressNo);
  }

  @Post(':addressNo/suspend')
  @ApiOperation({ summary: 'Force suspend a withdrawal address' })
  async suspend(@Request() req: any, @Param('addressNo') addressNo: string, @Body() dto: SuspendWithdrawalAddressDto) {
    const actor = this.extractAdmin(req);
    return this.workflowService.suspendAddress(addressNo, actor, dto.reason);
  }

  @Post(':addressNo/skip-cooling')
  @ApiOperation({ summary: 'Skip cooling period (simulation)' })
  async skipCooling(@Request() req: any, @Param('addressNo') addressNo: string) {
    const actor = this.extractAdmin(req);
    return this.workflowService.skipCoolingPeriod(addressNo, actor);
  }
}
