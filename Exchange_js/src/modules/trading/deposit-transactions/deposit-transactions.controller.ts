import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionQueryDto,
  UpdateDepositTransactionStatusDto,
} from './dto/deposit-transaction.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Deposit Transactions')
@ApiBearerAuth()
@Controller('deposit-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class DepositTransactionsController {
  constructor(private readonly service: DepositTransactionsService) {}

  @Get('my')
  @ApiOperation({ summary: 'List my deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: DepositTransactionQueryDto) {
    const userId = req.user.userId;
    return this.service.findAll({ ...query, ownerId: userId });
  }

  @Get()
  @ApiOperation({ summary: 'List deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: DepositTransactionQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deposit transaction details' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a random deposit transaction (Demo)' })
  create() {
    return this.service.createRandom();
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update deposit transaction status' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDepositTransactionStatusDto,
  ) {
    return this.service.updateStatus(id, dto);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async export(@Query() query: DepositTransactionQueryDto) {
    // For simplicity, reusing findAll. In production, use stream/csv generator.
    // Front-end usually expects JSON or CSV file.
    // Requirement says "Add data export interface".
    // I will return the data and let frontend handle CSV conversion or return CSV string.
    // Returning JSON is easiest for now.
    const result = await this.service.findAll({ ...query, take: 10000 }); // Limit export
    return result.items;
  }
}
