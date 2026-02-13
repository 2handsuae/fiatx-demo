import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ClearingsService } from './clearings.service';
import { QueryClearingDto, QueryClearingLineDto } from './dto/clearing.dto';

@Controller('clearings')
export class ClearingsController {
  constructor(private readonly clearingsService: ClearingsService) {}

  @Get()
  findAll(@Query() query: QueryClearingDto) {
    return this.clearingsService.findAll(query);
  }

  @Get('lines')
  findAllLines(@Query() query: QueryClearingLineDto) {
    return this.clearingsService.findAllLines(query);
  }

  @Get('lines/:id')
  findLine(@Param('id') id: string) {
    return this.clearingsService.findLine(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clearingsService.findOne(id);
  }

  @Post(':id/re-clear')
  reClear(@Param('id') id: string) {
    return this.clearingsService.reClear(id);
  }
}
