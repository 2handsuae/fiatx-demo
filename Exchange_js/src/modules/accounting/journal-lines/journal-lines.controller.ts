import { Controller, Get, Param, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { JournalLinesService } from './journal-lines.service';
import { JournalLineQueryDto } from './dto/journal-line.dto';
import { CustomerBalanceHistoryQueryDto } from './dto/customer-balance-history.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('Journal Lines')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('journal-lines')
export class JournalLinesController {
  constructor(private readonly journalLinesService: JournalLinesService) {}

  @Get()
  @ApiOperation({ summary: 'List all journal lines (Admin only)' })
  findAll(@Query() query: JournalLineQueryDto, @Request() req: any) {
    if (req.user.type !== 'ADMIN') {
      throw new ForbiddenException('Only admin can access all journal lines');
    }
    return this.journalLinesService.findAll(query);
  }

  @Get('customer-balance-history')
  @ApiOperation({ summary: 'Get customer available balance history' })
  getCustomerBalanceHistory(@Query() query: CustomerBalanceHistoryQueryDto, @Request() req: any) {
    // If it's a customer, ensure they only fetch their own data
    if (req.user.type === 'CUSTOMER') {
      if (query.customerId && query.customerId !== req.user.userId) {
        throw new ForbiddenException('You can only access your own balance history');
      }
      query.customerId = req.user.userId;
    }
    return this.journalLinesService.getCustomerBalanceHistory(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a journal line by id' })
  findOne(@Param('id') id: string) {
    return this.journalLinesService.findOne(id);
  }
}
