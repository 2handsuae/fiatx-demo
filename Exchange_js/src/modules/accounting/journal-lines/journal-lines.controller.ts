import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JournalLinesService } from './journal-lines.service';
import { JournalLineQueryDto } from './dto/journal-line.dto';
import { CustomerBalanceHistoryQueryDto } from './dto/customer-balance-history.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Journal Lines')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@Controller('journal-lines')
export class JournalLinesController {
  constructor(private readonly journalLinesService: JournalLinesService) {}

  @Get()
  @ApiOperation({ summary: 'List all journal lines (Admin only)' })
  findAll(@Query() query: JournalLineQueryDto) {
    throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
  }

  @Get('customer-balance-history')
  @ApiOperation({ summary: 'Get customer available balance history' })
  getCustomerBalanceHistory(@Query() query: CustomerBalanceHistoryQueryDto) {
    throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a journal line by id' })
  findOne(@Param('id') id: string) {
    throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
  }
}
