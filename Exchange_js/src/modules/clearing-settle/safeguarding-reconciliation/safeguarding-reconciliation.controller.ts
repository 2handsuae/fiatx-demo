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
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import {
  GenerateSafeguardingDailyDiffDto,
  SafeguardingBreakQueryDto,
  UpdateReconciliationBreakStatusDto,
} from './dto/safeguarding-reconciliation.dto';
import { SafeguardingReconciliationService } from './safeguarding-reconciliation.service';

@ApiTags('Admin - Reconciliation Safeguarding Breaks')
@ApiBearerAuth()
@Controller('admin/reconciliation/safeguarding-breaks')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class SafeguardingReconciliationController {
  constructor(
    private readonly safeguardingReconciliationService: SafeguardingReconciliationService,
  ) {}

  @Post('generate-daily-diff')
  @ApiOperation({
    summary:
      'Generate minimum safeguarding reconciliation diff for a business date',
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  generateDailyDiff(
    @Req() req: any,
    @Body() dto: GenerateSafeguardingDailyDiffDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.generateDailyDiff(
      dto,
      operatorId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List safeguarding reconciliation breaks' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: SafeguardingBreakQueryDto) {
    return this.safeguardingReconciliationService.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get safeguarding reconciliation break detail' })
  findOne(@Param('id') id: string) {
    return this.safeguardingReconciliationService.findOneForAdmin(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update safeguarding reconciliation break status' })
  @UsePipes(new ValidationPipe({ transform: true }))
  updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateReconciliationBreakStatusDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.updateStatus(
      id,
      dto,
      operatorId,
    );
  }
}
