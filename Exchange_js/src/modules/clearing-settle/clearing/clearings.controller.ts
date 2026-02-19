import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClearingsService } from './clearings.service';
import { QueryClearingDto, QueryClearingLineDto } from './dto/clearing.dto';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@Controller('clearings')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
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
