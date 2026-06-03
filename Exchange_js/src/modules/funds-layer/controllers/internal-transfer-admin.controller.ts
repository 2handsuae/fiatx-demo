import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { InternalTransferQueryDto } from '../dto/internal-transfer-query.dto';

@ApiTags('Admin - Funds Layer Transfers')
@Controller('admin/funds-layer/transfers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class InternalTransferAdminController {
  constructor(private readonly transfers: InternalTransferService) {}

  @Get()
  @ApiOperation({ summary: 'List internal transfers' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/funds-layer/transfers'))
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: InternalTransferQueryDto) {
    return this.transfers.findAllForAdmin(query);
  }

  @Get(':internalTxNo')
  @ApiOperation({ summary: 'Get internal transfer detail' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/funds-layer/transfers/:internalTxNo'),
  )
  findOne(@Param('internalTxNo') internalTxNo: string) {
    return this.transfers.findOneByNoForAdmin(internalTxNo);
  }
}
