import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { 
  PayoutQueryDto, 
  AdminUpdatePayoutStatusDto,
  PayoutAction,
  CreatePayoutDto 
} from './dto/payout.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';

@ApiTags('Payouts')
@ApiBearerAuth()
@Controller('payouts')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Get()
  @ApiOperation({ summary: 'List payouts' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: PayoutQueryDto) {
    return this.service.findAll(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a payout' })
  create(@Req() req: any, @Body() dto: CreatePayoutDto) {
    const operatorId = req.user.userId || 'SYSTEM';
    return this.service.create(dto, operatorId);
  }

  @Post('mock')
  @ApiOperation({ summary: 'Create 3 mock payouts' })
  createMock(@Req() req: any) {
    const operatorId = req.user.userId || 'SYSTEM';
    return this.service.createMock(operatorId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payout details' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update payout status' })
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AdminUpdatePayoutStatusDto,
  ) {
    const operatorId = req.user.userId || 'SYSTEM';
    return this.service.updateStatus(
      id,
      {
        action: dto.action as unknown as PayoutAction,
        txHash: dto.txHash,
        referenceNo: dto.referenceNo,
        reason: dto.reason,
      },
      operatorId,
    );
  }
}
