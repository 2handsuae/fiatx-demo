import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClearingTemplatesService } from './clearing-templates.service';
import { QueryClearingTemplateDto } from './dto/clearing.dto';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Clearing Templates')
@Controller('clearing-templates')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class ClearingTemplatesController {
  constructor(private readonly clearingTemplatesService: ClearingTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List clearing templates' })
  findAll(@Query() query: QueryClearingTemplateDto) {
    return this.clearingTemplatesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get clearing template detail' })
  findOne(@Param('id') id: string) {
    return this.clearingTemplatesService.findOne(id);
  }
}
