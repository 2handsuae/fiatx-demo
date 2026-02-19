import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CustomerSwapRateStatus,
  CreateCustomerSwapRateDto,
  UpdateCustomerSwapRateDto,
  UpdateCustomerSwapRateStatusDto,
} from './dto/customer-swap-rate.dto';
import { CustomerSwapRatesService } from './customer-swap-rates.service';

@ApiTags('customers/swap-rates')
@ApiBearerAuth()
@Controller('customers/swap-rates')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustomerSwapRatesController {
  constructor(private readonly service: CustomerSwapRatesService) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create customer swap rate config' })
  create(@Request() req: any, @Body() dto: CreateCustomerSwapRateDto) {
    this.ensureAdmin(req);
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List customer swap rate configs' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: CustomerSwapRateStatus })
  findAll(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: CustomerSwapRateStatus,
  ) {
    this.ensureAdmin(req);
    return this.service.findAll({
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 20,
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer swap rate config by id' })
  findOne(@Request() req: any, @Param('id') id: string) {
    this.ensureAdmin(req);
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update customer swap rate config' })
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerSwapRateDto,
  ) {
    this.ensureAdmin(req);
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change customer swap rate config status' })
  changeStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerSwapRateStatusDto,
  ) {
    this.ensureAdmin(req);
    return this.service.changeStatus(id, dto.status);
  }
}
