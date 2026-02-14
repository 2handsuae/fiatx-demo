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
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Prisma } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(AuthGuard('jwt'))
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
  @ApiQuery({ name: 'status', required: false, type: String })
  findAll(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
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

    if (status) {
      where.complianceStatus = status;
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
  findOne(@Request() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() updateCustomerDto: Prisma.CustomerMainUpdateInput,
  ) {
    this.ensureAdmin(req);
    return this.customersService.update({
      where: { id },
      data: updateCustomerDto,
    });
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Deprecated: customer status changes moved to onboarding module' })
  async changeStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { status: string, reason?: string },
  ) {
    this.ensureAdmin(req);
    throw new BadRequestException(
      'Deprecated endpoint. Use /onboarding/* (customer) and /admin/compliance/* (admin) for onboarding decisions.',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a customer' })
  remove(@Request() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.customersService.remove({ id });
  }
}
