import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Patch,
  Body,
  Post,
} from '@nestjs/common';
import { PayinsService } from './payins.service';
import {
  PayinQueryDto,
  UpdatePayinStatusDto,
  SimulatePayinDto,
} from './dto/payin.dto';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('treasury/payins')
@ApiBearerAuth()
@Controller('treasury/payins')
export class PayinsController {
  constructor(private readonly service: PayinsService) {}

  @Post('simulate')
  @ApiOperation({ summary: 'Simulate a new payin (For testing/demo)' })
  simulate(@Body() dto: SimulatePayinDto) {
    return this.service.simulate(dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'List all payins' })
  findAll(@Query() query: PayinQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Get payin details' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Update payin status (State Machine)' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePayinStatusDto) {
    return this.service.updateStatus(id, dto.action);
  }
}
