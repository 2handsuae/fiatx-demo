import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { RequirePermissions } from 'src/modules/identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from 'src/modules/identity/access-control/permission-code.util';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import {
  AdvanceSwapLegDto,
  CreateSwapTransactionDto,
  SwapTransactionQueryDto,
} from './dto/swap-transaction.dto';
import { AdminSwapQuoteQueryDto } from './dto/swap-quote.dto';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';

@ApiTags('Admin - Swap Transactions')
@Controller('admin/swap-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SwapTransactionsController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapWorkflow: SwapWorkflowService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new swap transaction' })
  async create(@Body() _createSwapTransactionDto: CreateSwapTransactionDto) {
    throw new ForbiddenException('Admin direct swap creation is disabled');
  }

  @Get()
  @ApiOperation({ summary: 'Get all swap transactions' })
  findAll(@Query() query: SwapTransactionQueryDto) {
    return this.swapTransactionsService.findAll(query);
  }

  @Get('quotes')
  @ApiOperation({ summary: 'List swap quotes' })
  findAllQuotes(@Query() query: AdminSwapQuoteQueryDto) {
    return this.swapQuoteService.findAllForAdmin(query);
  }

  @Get('quotes/:id')
  @ApiOperation({ summary: 'Get swap quote detail' })
  findOneQuote(@Param('id') id: string) {
    return this.swapQuoteService.findOneForAdmin(id);
  }

  @Post(':swapNo/legs/:legSeq/advance')
  @ApiOperation({ summary: 'Advance a swap settlement leg (manual simulate)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/advance'),
  )
  advanceSwapLeg(
    @Param('swapNo') swapNo: string,
    @Param('legSeq') legSeq: string,
    @Body() dto: AdvanceSwapLegDto,
    @Req() req: any,
  ) {
    return this.swapWorkflow.advanceLeg(
      swapNo,
      Number(legSeq),
      dto.action,
      req.user?.userNo || req.user?.sub || 'ADMIN',
    );
  }

  @Post(':swapNo/legs/:legSeq/resume')
  @ApiOperation({ summary: 'Resume a NEEDS_REVIEW (stuck) swap leg by creating a fresh attempt' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/resume'),
  )
  resumeSwapLeg(
    @Param('swapNo') swapNo: string,
    @Param('legSeq') legSeq: string,
    @Req() req: any,
  ) {
    const op = req.user?.userNo || req.user?.sub || 'ADMIN';
    return this.swapWorkflow.resumeLeg(swapNo, Number(legSeq), op);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get swap transaction by ID' })
  findOne(@Param('id') id: string) {
    return this.swapTransactionsService.findOne(id);
  }
}
