import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalTransactionWorkflowService } from './internal-transaction-workflow.service';
import { CreateManualInternalTransactionDto } from './dto/create-manual-internal-transaction.dto';
import { ReviewManualInternalTransactionDto } from './dto/review-manual-internal-transaction.dto';

@ApiTags('Admin - Internal Transactions')
@ApiBearerAuth()
@Controller('admin/internal-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class InternalTransactionWorkflowController {
  constructor(
    private readonly internalTransactionWorkflowService: InternalTransactionWorkflowService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create manual internal transaction with initial fund' })
  @UsePipes(new ValidationPipe({ transform: true }))
  createManual(@Req() req: any, @Body() dto: CreateManualInternalTransactionDto) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.internalTransactionWorkflowService.createManualTransaction(
      dto,
      operatorId,
    );
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Review manual internal transaction (approve/reject)' })
  @UsePipes(new ValidationPipe({ transform: true }))
  reviewManual(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewManualInternalTransactionDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.internalTransactionWorkflowService.reviewManualTransaction(
      id,
      dto,
      operatorId,
    );
  }
}
