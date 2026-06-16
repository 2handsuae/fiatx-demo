import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { FeeAccrualService } from './fee-accrual.service';
import { FeeAccrualQueryDto } from './dto/fee-accrual-query.dto';

@ApiTags('Admin - Fee Accruals')
@Controller('admin/reconciliation/fee-accruals')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FeeAccrualsController {
  constructor(private readonly service: FeeAccrualService) {}

  @Get()
  @ApiOperation({ summary: 'List fee accruals for reconciliation' })
  findAll(@Query() query: FeeAccrualQueryDto) {
    return this.service.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fee accrual detail with siblings' })
  findOne(@Param('id') id: string) {
    return this.service.findOneForAdmin(id);
  }
}
