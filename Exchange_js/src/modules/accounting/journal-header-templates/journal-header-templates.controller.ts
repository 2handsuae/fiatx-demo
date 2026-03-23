import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JournalHeaderTemplatesService } from './journal-header-templates.service';
import { JournalHeaderTemplateQueryDto } from './dto/journal-header-template.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Journal Header Templates')
@Controller('journal-header-templates')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class JournalHeaderTemplatesController {
  constructor(private readonly service: JournalHeaderTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List all templates' })
  findAll(@Query() query: JournalHeaderTemplateQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by id' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
