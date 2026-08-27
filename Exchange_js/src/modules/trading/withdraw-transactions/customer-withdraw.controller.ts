import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import {
  WithdrawTransactionQueryDto,
  CreateWithdrawTransactionDto,
} from './dto/withdraw-transaction.dto';

@ApiTags('Client Withdraw Transactions')
@ApiBearerAuth()
@Controller('client/withdraw-transactions')
@UseGuards(AuthGuard('jwt'))
export class CustomerWithdrawController {
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly workflow: WithdrawWorkflowService,
    private readonly customerAccess: CustomerAccessService,
  ) {}

  private assertCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId;
  }

  @Post()
  @ApiOperation({ summary: 'Create a withdrawal request (customer)' })
  async create(@Req() req: any, @Body() dto: CreateWithdrawTransactionDto) {
    const userId = this.assertCustomer(req);
    await this.customerAccess.assertTradingEligibility(userId, 'WITHDRAW');
    return this.workflow.createWithdrawal(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List my withdraw transactions (customer)' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    const userId = this.assertCustomer(req);
    return this.service.findAllForCustomer(userId, query);
  }

  // 2026-08-18 材料请求账：本域补料会话端点（原按 seq 定位的旧端点）已删除。
  // 客户面改走 material-requests.client.controller.ts
  // 的 requestNo 定位端点（Task 14 接入）。

  @Get('my/:withdrawNo')
  @ApiOperation({ summary: 'Get my withdraw transaction detail by withdrawNo (customer)' })
  getMyWithdrawByNo(@Req() req: any, @Param('withdrawNo') withdrawNo: string) {
    const userId = this.assertCustomer(req);
    return this.service.findOneForCustomerByWithdrawNo(withdrawNo, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get my withdraw transaction detail (customer)' })
  findOne(@Req() req: any, @Param('id') id: string) {
    const userId = this.assertCustomer(req);
    return this.service.findOneForCustomer(id, userId);
  }
}
