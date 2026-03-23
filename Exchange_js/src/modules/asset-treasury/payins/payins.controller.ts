import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Patch,
  Body,
} from '@nestjs/common';
import { PayinsService } from './payins.service';
import { PayinQueryDto, UpdatePayinStatusDto } from './dto/payin.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';

@ApiTags('treasury/payins')
@ApiBearerAuth()
@Controller('treasury/payins')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PayinsController {
  constructor(private readonly service: PayinsService) {}

  @Get()
  @ApiOperation({ summary: 'List all payins' })
  findAll(@Query() query: PayinQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payin details' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update payin status (State Machine)' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePayinStatusDto) {
    return this.service.updateStatus(id, dto.action);
  }
}
