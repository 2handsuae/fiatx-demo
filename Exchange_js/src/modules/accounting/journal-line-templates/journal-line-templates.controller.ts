import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { JournalLineTemplatesService } from './journal-line-templates.service';
import {
  CreateJournalLineTemplateDto,
  UpdateJournalLineTemplateDto,
  JournalLineTemplateQueryDto,
} from './dto/journal-line-template.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Journal Line Templates')
@Controller('journal-line-templates')
export class JournalLineTemplatesController {
  constructor(private readonly service: JournalLineTemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new journal line template' })
  create(@Body() createDto: CreateJournalLineTemplateDto) {
    return this.service.create(createDto);
  }

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

  @Patch(':id')
  @ApiOperation({ summary: 'Update a line template' })
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateJournalLineTemplateDto,
  ) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a line template' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
