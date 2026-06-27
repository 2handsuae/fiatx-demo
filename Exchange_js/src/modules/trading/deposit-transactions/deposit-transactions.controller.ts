import {
  Controller,
  Get,
  Body,
  Param,
  Query,
  Patch,
  Post,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionQueryDto,
  UpdateDepositTransactionStatusDto,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { DepositWorkflowService } from './deposit-workflow.service';
import {
  CreateInboundTransferSignalDto,
  InboundTransferSignalQueryDto,
  ScanInboundTransferSignalsDto,
} from './dto/inbound-transfer-signal.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';

@ApiTags('Deposit Transactions')
@ApiBearerAuth()
@Controller('deposit-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class DepositTransactionsController {
  constructor(
    private readonly service: DepositTransactionsService,
    private readonly inboundTransferSignalsService: InboundTransferSignalsService,
    private readonly workflow: DepositWorkflowService,
  ) {}

  @Get('my')
  @ApiOperation({ summary: 'List my deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: DepositTransactionQueryDto) {
    const userId = req.user.userId;
    return this.service.findAll({ ...query, ownerId: userId });
  }

  @Get('my/inbound-signals')
  @ApiOperation({ summary: 'List my inbound transfer signals' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMyInboundSignals(
    @Req() req: any,
    @Query() query: InboundTransferSignalQueryDto,
  ) {
    const userId = req.user.userId;
    return this.inboundTransferSignalsService.findAllForCustomer(userId, query);
  }

  @Post('my/inbound-signals')
  @ApiOperation({ summary: 'Create my inbound transfer signal' })
  @UsePipes(new ValidationPipe({ transform: true }))
  createMyInboundSignal(
    @Req() req: any,
    @Body() dto: CreateInboundTransferSignalDto,
  ) {
    const userId = req.user.userId;
    return this.inboundTransferSignalsService.createForCustomer(userId, dto);
  }

  @Post('my/inbound-signals/scan')
  @ApiOperation({ summary: 'Scan my inbound transfer signals' })
  @UsePipes(new ValidationPipe({ transform: true }))
  scanMyInboundSignals(
    @Req() req: any,
    @Body() dto: ScanInboundTransferSignalsDto,
  ) {
    const userId = req.user.userId;
    return this.inboundTransferSignalsService.scanForCustomer(userId, dto);
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

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update deposit transaction status' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDepositTransactionStatusDto,
    @Req() req: any,
  ) {
    const actor = {
      actorId: req.user?.userId,
      actorRole: req.user?.role,
    };
    switch (dto.action) {
      case DepositTransactionAction.APPROVE:
        return this.workflow.approveDeposit(id);
      case DepositTransactionAction.REJECT:
        return this.workflow.adminReject(id, dto.reason, actor);
      case DepositTransactionAction.FREEZE:
        return this.workflow.adminFreeze(id, dto.reason, actor);
      default:
        return this.service.updateStatus(id, dto, {
          sourcePlatform: 'ADMIN_API',
          actor: {
            actorType: 'ADMIN',
            actorId: req.user?.userId,
            actorRole: req.user?.role,
          },
        });
    }
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
