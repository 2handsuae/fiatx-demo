import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Prisma } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
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

  switch (normalized) {
    case 'ACTIVE':
      return {
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      };
    case 'PENDING_CDD':
    case 'REVIEW_CDD':
    case 'PENDING_EDD':
    case 'REVIEW_EDD':
    case 'PENDING_VERIFICATION':
    case 'PENDING_CDD_INPUT':
    case 'CDD_UNDER_REVIEW':
    case 'PENDING_EDD_INPUT':
    case 'EDD_UNDER_REVIEW':
      return { onboardingStatus: 'PENDING_VERIFICATION' };
    case 'FINAL_APPROVAL':
    case 'APPROVED':
    case 'REJECTED':
    case 'WITHDRAWN':
    case 'NONE':
      return { onboardingStatus: normalized };
    default:
      return { onboardingStatus: normalized };
  }
};

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new customer' })
  create(@Request() req: any, @Body() createCustomerDto: Prisma.CustomerMainCreateInput) {
    this.ensureAdmin(req);
    return this.customersService.create(createCustomerDto);
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
      'Compatibility filter. Accepts legacy values (e.g. ACTIVE, REVIEW_CDD) and canonical onboardingStatus values; internally mapped to canonical conditions.',
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

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by ID' })
  findOne(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    this.ensureAdmin(req);
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @Request() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateCustomerDto: Prisma.CustomerMainUpdateInput,
  ) {
    this.ensureAdmin(req);
    return this.customersService.update({
      where: { id },
      data: updateCustomerDto,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a customer' })
  remove(@Request() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    this.ensureAdmin(req);
    return this.customersService.remove({ id });
  }
}
