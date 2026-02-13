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
import { CoaService } from './coa.service';
import { CreateCoaDto, UpdateCoaDto, CoaQueryDto } from './dto/coa.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Chart of Accounts')
@Controller('coa')
export class CoaController {
  constructor(private readonly coaService: CoaService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new COA' })
  create(@Body() createCoaDto: CreateCoaDto) {
    return this.coaService.create(createCoaDto);
  }

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

  @Patch(':id')
  @ApiOperation({ summary: 'Update a COA' })
  update(@Param('id') id: string, @Body() updateCoaDto: UpdateCoaDto) {
    return this.coaService.update(id, updateCoaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a COA' })
  remove(@Param('id') id: string) {
    return this.coaService.remove(id);
  }
}
