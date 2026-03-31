import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CancelFeeOccurrenceDto,
  CreateFeeOccurrenceDto,
  FeeOccurrenceQueryDto,
} from './dto/fee-occurrence.dto';
import { FeeOccurrencesService } from './fee-occurrences.service';

@ApiTags('Admin - Fee Occurrences')
@Controller('admin/fee-occurrences')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FeeOccurrencesController {
  constructor(private readonly feeOccurrencesService: FeeOccurrencesService) {}

  @Get()
  @ApiOperation({ summary: 'List fee occurrences' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: FeeOccurrenceQueryDto) {
    return this.feeOccurrencesService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fee occurrence detail' })
  findOne(@Param('id') id: string) {
    return this.feeOccurrencesService.findOneForAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Record manual fee occurrence' })
  create(@Req() req: any, @Body() dto: CreateFeeOccurrenceDto) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.feeOccurrencesService.recordManual(dto, operatorId);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel fee occurrence' })
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CancelFeeOccurrenceDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.feeOccurrencesService.cancel(id, dto, operatorId);
  }
}
