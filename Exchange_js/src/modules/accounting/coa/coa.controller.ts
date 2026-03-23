import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CoaService } from './coa.service';
import { CoaQueryDto } from './dto/coa.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Chart of Accounts')
@Controller('coa')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CoaController {
  constructor(private readonly coaService: CoaService) {}

  @Get()
  @ApiOperation({ summary: 'List all COAs' })
  findAll(@Query() query: CoaQueryDto) {
    return this.coaService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a COA by id' })
  findOne(@Param('id') id: string) {
    return this.coaService.findOne(id);
  }
}
