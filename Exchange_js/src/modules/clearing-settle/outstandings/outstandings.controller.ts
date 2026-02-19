import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OutstandingsService } from './outstandings.service';
import { OutstandingQueryDto } from './dto/outstanding.dto';

@ApiTags('Admin - Reconciliation Outstandings')
@Controller('admin/reconciliation/outstandings')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class OutstandingsController {
  constructor(private readonly outstandingsService: OutstandingsService) {}

  @Get()
  @ApiOperation({ summary: 'List outstandings for reconciliation' })
  findAll(@Query() query: OutstandingQueryDto) {
    return this.outstandingsService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get outstanding detail by id' })
  findOne(@Param('id') id: string) {
    return this.outstandingsService.findOneForAdmin(id);
  }
}
