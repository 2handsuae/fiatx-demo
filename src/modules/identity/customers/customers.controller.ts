import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Prisma } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { AgreementsReadService } from '../agreements/agreements-read.service';
import { MonthlyStatementService } from '../../asset-treasury/treasury/monthly-statement.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

const buildCustomerStatusWhere = (status?: string): Prisma.CustomerMainWhereInput | null => {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return { lifecycle: normalized };
};

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly agreementsRead: AgreementsReadService,
    private readonly monthlyStatements: MonthlyStatementService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  /** 铁律⑥ 对外用业务键：三个详情端点的路由参数都是 customerNo，这里换成内部 id
   *  再传给 service（同 users.controller.ts resolveUserId 的镜像约定）。 */
  private async resolveCustomerId(customerNo: string): Promise<string> {
    const customer = await this.customersService.findByCustomerNo(customerNo);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer.id;
  }

  @Get()
  @ApiOperation({ summary: 'List all customers with pagination and filtering' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name, email or phone',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description:
      'Filter by customer lifecycle. Accepts a single CustomerLifecycle value: PROSPECT | IN_VERIFICATION | PENDING_APPROVAL | ACTIVE | REJECTED | WITHDRAWN | OFFBOARDED.',
  })
  @ApiQuery({
    name: 'customerType',
    required: false,
    type: String,
    description: 'Filter by customer type: INDIVIDUAL or CORPORATE.',
  })
  findAll(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerType') customerType?: string,
  ) {
    this.ensureAdmin(req);
    const where: Prisma.CustomerMainWhereInput = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search } }, // SQLite contains is case-sensitive usually, but Prisma might handle it
        { lastName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const normalizedType = String(customerType || '').trim().toUpperCase();
    if (normalizedType === 'INDIVIDUAL' || normalizedType === 'CORPORATE') {
      where.customerType = normalizedType;
    }

    const statusWhere = buildCustomerStatusWhere(status);
    if (statusWhere) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existingAnd, statusWhere];
    }

    return this.customersService.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':customerNo')
  @ApiOperation({ summary: 'Get a customer by customer number' })
  async findOne(@Request() req: any, @Param('customerNo') customerNo: string) {
    this.ensureAdmin(req);
    const id = await this.resolveCustomerId(customerNo);
    const customer = await this.customersService.findOne(id);
    // 战役丙波三 T9：详情档案区的协议行（已同意 vX / pending response / declined）——五键直通。
    return customer && { ...customer, agreement: await this.agreementsRead.consentStateFor(id) };
  }

  // 战役丙波四 T4：详情页 Monthly statements 节——列表三键 + 逐币种期末余额，业务月降序。
  @Get(':customerNo/statements')
  @ApiOperation({ summary: 'List a customer\'s issued monthly statements' })
  async listStatements(@Request() req: any, @Param('customerNo') customerNo: string) {
    this.ensureAdmin(req);
    const id = await this.resolveCustomerId(customerNo);
    return this.monthlyStatements.listForAdmin(id);
  }

  // 战役丙波四 T8：运营改档案（CDD 七字段）。挂 CUSTOMER_WRITE（孤儿桶 customer.manage_profile 的第一条路由）。
  // body 刻意不挂 DTO：全局 ValidationPipe 带 whitelist 会把白名单外的键静默剥掉，而业务规则要的是
  // 「白名单外的键显式 400」——由 service 的 PROFILE_FIELD_NOT_EDITABLE 守。
  @Patch(':customerNo/profile')
  @ApiOperation({ summary: 'Edit a customer\'s CDD profile fields (first/last name, DOB, nationality, ID type/number, address)' })
  async updateProfile(
    @Request() req: any,
    @Param('customerNo') customerNo: string,
    @Body() body: Record<string, string>,
  ) {
    this.ensureAdmin(req);
    await this.customersService.updateProfileFields(this.buildActor(req), customerNo, body);
    return { customerNo };
  }
}
