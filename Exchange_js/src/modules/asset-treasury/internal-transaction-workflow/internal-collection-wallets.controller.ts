import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { InternalCollectionWorkflowOrchestrator } from '../../../orchestrators/internal-collection-workflow.orchestrator';
import {
  CollectionWalletQueryDto,
  ReconcileCollectionWalletDto,
} from './dto/collection-wallet.dto';

@ApiTags('Admin - Internal Transactions')
@ApiBearerAuth()
@Controller('admin/internal-transactions/collection-wallets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class InternalCollectionWalletsController {
  constructor(
    private readonly internalCollectionWorkflowOrchestrator: InternalCollectionWorkflowOrchestrator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List DEPOSIT wallets for wallet-driven collection monitoring' })
  @UsePipes(new ValidationPipe({ transform: true }))
  listCollectionWallets(@Query() query: CollectionWalletQueryDto) {
    return this.internalCollectionWorkflowOrchestrator.listCollectionWallets({
      skip: query.skip,
      take: query.take,
      assetId: query.assetId,
    });
  }

  @Post(':walletId/reconcile')
  @ApiOperation({ summary: 'Dry-run or create wallet-driven collection for a DEPOSIT wallet' })
  @UsePipes(new ValidationPipe({ transform: true }))
  reconcileCollectionWallet(
    @Req() req: any,
    @Param('walletId') walletId: string,
    @Body() dto: ReconcileCollectionWalletDto,
  ) {
    return this.internalCollectionWorkflowOrchestrator.reconcileCollectionWallet({
      walletId,
      dryRun: dto.dryRun,
      operatorId: req.user?.userId || 'SYSTEM',
    });
  }
}
