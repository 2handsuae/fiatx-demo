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
  ForbiddenException,
} from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import {
  WithdrawTransactionQueryDto,
  AdminUpdateWithdrawTransactionStatusDto,
  WithdrawTransactionAction,
} from './dto/withdraw-transaction.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Withdraw Transactions')
@ApiBearerAuth()
@Controller('withdraw-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawTransactionsController {
  constructor(
    private readonly service: WithdrawTransactionsService,
  ) {}

  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List withdraw transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    this.assertAdmin(req);
    return this.service.findAll(query);
  }

  @Post('mock')
  @ApiOperation({ summary: 'Create 10 mock withdraw transactions' })
  createMock(@Req() req: any) {
    this.assertAdmin(req);
    return this.service.createMockData();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get withdraw transaction details' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.assertAdmin(req);
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update withdraw transaction status' })
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AdminUpdateWithdrawTransactionStatusDto,
  ) {
    this.assertAdmin(req);
    return this.service.updateStatus(
      id,
      {
        action: dto.action as unknown as WithdrawTransactionAction,
        reason: dto.reason,
      },
      {
        source: 'ADMIN_API',
        actorType: 'ADMIN',
        actorId: req.user?.userId || 'ADMIN_SYSTEM',
        actorRole: req.user?.role || 'ADMIN',
        sourcePlatform: 'ADMIN_API',
      },
    );
  }

}
