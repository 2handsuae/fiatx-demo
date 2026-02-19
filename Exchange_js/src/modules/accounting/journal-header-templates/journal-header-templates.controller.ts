import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JournalHeaderTemplatesService } from './journal-header-templates.service';
import {
  CreateJournalHeaderTemplateDto,
  UpdateJournalHeaderTemplateDto,
  JournalHeaderTemplateQueryDto,
} from './dto/journal-header-template.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Journal Header Templates')
@Controller('journal-header-templates')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class JournalHeaderTemplatesController {
  constructor(private readonly service: JournalHeaderTemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new journal header template' })
  create(@Body() createDto: CreateJournalHeaderTemplateDto) {
    return this.service.create(createDto);
  }

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

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateJournalHeaderTemplateDto,
  ) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a template' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
