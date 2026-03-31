import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  ReimbursementObligationQueryDto,
  UpdateReimbursementObligationStatusDto,
} from './dto/reimbursement-obligation.dto';
import { ReimbursementObligationsService } from './reimbursement-obligations.service';

@ApiTags('Admin - Reimbursement Obligations')
@Controller('admin/reimbursement-obligations')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ReimbursementObligationsController {
  constructor(
    private readonly reimbursementObligationsService: ReimbursementObligationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List reimbursement obligations' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: ReimbursementObligationQueryDto) {
    return this.reimbursementObligationsService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reimbursement obligation detail' })
  findOne(@Param('id') id: string) {
    return this.reimbursementObligationsService.findOneForAdmin(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update reimbursement obligation status' })
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateReimbursementObligationStatusDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.reimbursementObligationsService.updateStatus(id, dto, operatorId);
  }
}
