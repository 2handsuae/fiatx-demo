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
    // 波五 T4：SILENT 便签放行建单——真正的折叠+冻结在 workflow.createWithdrawal
    // 内落地（纵深闸，本调用只挡 DISCLOSED 客户）。
    await this.customerAccess.assertTradingIntake(userId, 'WITHDRAW');
    const created = await this.workflow.createWithdrawal(dto, userId);
    // 波五 T4 评审 Critical：workflow.createWithdrawal() 返回的是整行（含
    // l1Snapshot/needsReview/sumsub* 等执法态字段——fold 客户的响应里会明文
    // 带 CUSTOMER_RESTRICTION FAIL 详情，tipping-off 泄露）。不收窄 service
    // 返回值本身——demo-lib.ts/demo-fixtures.ts 与多份 e2e 直接消费那个整行；
    // 在控制器这一层收口：建单后过与 GET 详情端点同一条客户白名单路径重取一次
    // （不复用 created——那行可能缺 asset include），逐字节对齐 findOneForCustomer。
    return this.service.findOneForCustomer(created.id, userId);
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
}
