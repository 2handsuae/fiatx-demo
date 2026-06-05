import {
  Controller, Get, Param, Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsQueryDto } from '../dto/funds-query.dto';

@ApiTags('Admin - Funds Layer Funds')
@Controller('admin/funds-layer/funds')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FundsAdminController {
  constructor(private readonly fundsFlow: FundsFlowService) {}

  @Get()
  @ApiOperation({ summary: 'List funds flows' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/funds-layer/funds'))
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: FundsQueryDto) {
    return this.fundsFlow.findAllForAdmin(query as any);
  }

  @Get(':internalFundNo')
  @ApiOperation({ summary: 'Get funds flow detail' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/funds-layer/funds/:internalFundNo'),
  )
  findOne(@Param('internalFundNo') internalFundNo: string) {
    return this.fundsFlow.findOneByNoForAdmin(internalFundNo);
  }
}
