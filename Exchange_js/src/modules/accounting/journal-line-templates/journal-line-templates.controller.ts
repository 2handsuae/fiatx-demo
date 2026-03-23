import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JournalLineTemplatesService } from './journal-line-templates.service';
import { JournalLineTemplateQueryDto } from './dto/journal-line-template.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Journal Line Templates')
@Controller('journal-line-templates')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class JournalLineTemplatesController {
  constructor(private readonly service: JournalLineTemplatesService) {}

  @Get()
  @ApiOperation({
    summary: 'List all line templates (filtered by header template)',
  })
  findAll(@Query() query: JournalLineTemplateQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a line template by id' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
