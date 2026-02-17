import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalTransactionsService } from './internal-transactions.service';
import { InternalTransactionQueryDto } from './dto/internal-transaction.dto';

@ApiTags('Admin - Internal Transactions')
@Controller('admin/internal-transactions')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class InternalTransactionsController {
  constructor(
    private readonly internalTransactionsService: InternalTransactionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List internal transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: InternalTransactionQueryDto) {
    return this.internalTransactionsService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get internal transaction detail' })
  findOne(@Param('id') id: string) {
    return this.internalTransactionsService.findOneForAdmin(id);
  }
}
