import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ClearingTemplatesService } from './clearing-templates.service';
import { CreateClearingTemplateDto, UpdateClearingTemplateDto, QueryClearingTemplateDto } from './dto/clearing.dto';

@Controller('clearing-templates')
export class ClearingTemplatesController {
  constructor(private readonly clearingTemplatesService: ClearingTemplatesService) {}

  @Post()
  create(@Body() createClearingTemplateDto: CreateClearingTemplateDto) {
    return this.clearingTemplatesService.create(createClearingTemplateDto);
  }

  @Get()
  findAll(@Query() query: QueryClearingTemplateDto) {
    return this.clearingTemplatesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clearingTemplatesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateClearingTemplateDto: UpdateClearingTemplateDto) {
    return this.clearingTemplatesService.update(id, updateClearingTemplateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clearingTemplatesService.remove(id);
  }
}
