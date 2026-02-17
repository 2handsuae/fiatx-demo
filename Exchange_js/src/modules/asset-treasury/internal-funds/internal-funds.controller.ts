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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalFundsService } from './internal-funds.service';
import {
  InternalFundQueryDto,
  UpdateInternalFundStatusDto,
} from './dto/internal-fund.dto';

@ApiTags('Admin - Internal Funds')
@ApiBearerAuth()
@Controller('admin/internal-funds')
@UseGuards(AuthGuard('jwt'))
export class InternalFundsController {
  constructor(private readonly internalFundsService: InternalFundsService) {}

  @Get()
  @ApiOperation({ summary: 'List internal funds' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: InternalFundQueryDto) {
    return this.internalFundsService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get internal fund detail' })
  findOne(@Param('id') id: string) {
    return this.internalFundsService.findOneForAdmin(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update internal fund status' })
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateInternalFundStatusDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.internalFundsService.updateStatus(id, dto, operatorId);
  }

  @Post('mock')
  @ApiOperation({ summary: 'Create mock internal fund and transaction' })
  createMock(@Req() req: any) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.internalFundsService.createMock(operatorId);
  }
}
