import { Controller, Post, Get, Patch, Delete, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { CreateWithdrawalAddressDto } from './dto/create-withdrawal-address.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { ListWithdrawalAddressQueryDto } from './dto/list-withdrawal-address-query.dto';
import { UpdateWithdrawalAddressDto } from './dto/update-withdrawal-address.dto';

@ApiTags('client/withdrawal-addresses')
@ApiBearerAuth()
@Controller('client/withdrawal-addresses')
@UseGuards(AuthGuard('jwt'))
export class WithdrawalAddressController {
  constructor(
    private readonly workflowService: WithdrawalAddressWorkflowService,
    private readonly addressService: WithdrawalAddressService,
  ) {}

  private extractCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return { customerId: req.user.userId, customerNo: req.user.userNo ?? req.user.userId };
  }

  @Post()
  @ApiOperation({ summary: 'Register a new withdrawal address' })
  async create(@Request() req: any, @Body() dto: CreateWithdrawalAddressDto) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.registerAddress(dto, customerId, customerNo);
  }

  @Post('bank-accounts')
  @ApiOperation({ summary: 'Register a new bank account for fiat withdrawals' })
  async createBankAccount(@Request() req: any, @Body() dto: CreateBankAccountDto) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.registerBankAccount(dto, customerId, customerNo);
  }

  @Get()
  @ApiOperation({ summary: 'List my withdrawal addresses' })
  async list(@Request() req: any, @Query() query: ListWithdrawalAddressQueryDto) {
    const { customerId } = this.extractCustomer(req);
    await this.workflowService.batchActivateExpired(customerId, query.network);
    return this.addressService.listByCustomer(customerId, query);
  }

  @Get(':addressNo')
  @ApiOperation({ summary: 'Get withdrawal address detail' })
  async findOne(@Request() req: any, @Param('addressNo') addressNo: string) {
    const { customerId } = this.extractCustomer(req);
    await this.workflowService.batchActivateExpired(customerId);
    const address = await this.addressService.findByNo(addressNo);
    if (!address || address.customerId !== customerId) {
      throw new ForbiddenException('Address not found or not owned by you');
    }
    return address;
  }

  @Patch(':addressNo')
  @ApiOperation({ summary: 'Edit label / beneficiary name of my withdrawal address' })
  async update(@Request() req: any, @Param('addressNo') addressNo: string, @Body() dto: UpdateWithdrawalAddressDto) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.updateAddress(addressNo, customerId, customerNo, dto);
  }

  @Delete(':addressNo')
  @ApiOperation({ summary: 'Cancel a withdrawal address during cooling period' })
  async cancel(@Request() req: any, @Param('addressNo') addressNo: string, @Body() body: { reason: string }) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.cancelAddress(addressNo, customerId, customerNo, body?.reason);
  }

  @Post(':addressNo/deactivate')
  @ApiOperation({ summary: 'Deactivate an active withdrawal address' })
  async deactivate(@Request() req: any, @Param('addressNo') addressNo: string, @Body() body: { reason: string }) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.deactivateAddress(addressNo, customerId, customerNo, body?.reason);
  }
}
