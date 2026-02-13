import { Controller, Get, Param, Query } from '@nestjs/common';
import { JournalsService } from './journals.service';
import { JournalQueryDto } from './dto/journal.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Journals')
@Controller('journals')
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @Get()
  @ApiOperation({ summary: 'List all journal entries' })
  findAll(@Query() query: JournalQueryDto) {
    return this.journalsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a journal entry by id' })
  findOne(@Param('id') id: string) {
    return this.journalsService.findOne(id);
  }
}
