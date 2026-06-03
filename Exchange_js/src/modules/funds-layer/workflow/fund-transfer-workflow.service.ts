import { Injectable } from '@nestjs/common';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';

/**
 * V7 Phase 2 fund-transfer workflow.
 *
 * Thin orchestration over the universal {@link InternalTransferWorkflowService}
 * for the two platform Main↔Outbound paths used by the withdraw lifecycle:
 *   - FUND_OUT     (C_MAIN → C_OUT): pre-funding the outbound wallet before payout.
 *   - FUND_RETURN  (C_OUT → C_MAIN): returning unused outbound funds (repair).
 *
 * Both resolve the ACTIVE platform C_MAIN + C_OUT wallets for the asset and
 * delegate to `initiate`, which enforces the whitelist + accounting invariants.
 */
@Injectable()
export class FundTransferWorkflowService {
  constructor(
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  /** 提现付款前：Main→Outbound 预归集（FUND_OUT，非阻塞跟踪转账）。crypto only。 */
  async fundOut(
    input: { withdrawId: string; withdrawNo: string; assetId: string; netAmount: string },
    operatorId = 'SYSTEM',
  ) {
    const [main, out] = await Promise.all([
      this.systemWallets.resolve(input.assetId, 'C_MAIN'),
      this.systemWallets.resolve(input.assetId, 'C_OUT'),
    ]);
    return this.transferWorkflow.initiate(
      {
        fromRole: 'C_MAIN',
        toRole: 'C_OUT',
        sourceType: 'WITHDRAW',
        sourceId: input.withdrawId,
        sourceNo: input.withdrawNo,
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        assetId: input.assetId,
        amount: input.netAmount,
        fromWalletId: main.id,
        toWalletId: out.id,
        triggerSource: 'WITHDRAW',
      },
      operatorId,
    );
  }

  /** FUND_RETURN：Outbound→Main 退回（Task 2B.2 的 repair 面调用）。 */
  async fundReturn(
    input: {
      withdrawId: string;
      withdrawNo: string;
      assetId: string;
      amount: string;
      reason?: string;
    },
    operatorId = 'SYSTEM',
  ) {
    const [main, out] = await Promise.all([
      this.systemWallets.resolve(input.assetId, 'C_MAIN'),
      this.systemWallets.resolve(input.assetId, 'C_OUT'),
    ]);
    return this.transferWorkflow.initiate(
      {
        fromRole: 'C_OUT',
        toRole: 'C_MAIN',
        sourceType: 'WITHDRAW_RETURN',
        sourceId: input.withdrawId,
        sourceNo: input.withdrawNo,
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        assetId: input.assetId,
        amount: input.amount,
        fromWalletId: out.id,
        toWalletId: main.id,
        triggerSource: 'WITHDRAW',
        note: input.reason,
      },
      operatorId,
    );
  }
}
