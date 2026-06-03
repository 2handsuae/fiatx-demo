import { Injectable, NotImplementedException } from '@nestjs/common';
import { AccountingClass } from '../constants/internal-transfer-paths.constant';

@Injectable()
export class FundsAccountingService {
  /**
   * A 类：客户资产在公司钱包间搬位置，TB 托管余额不变 → 不产生 TB transfer。
   * B 类：drain TRADE_CLEARING / FEE_RECEIVABLE ↔ CUSTODY（Phase 3 实现）。
   */
  async applyAccounting(input: {
    accountingClass: AccountingClass;
    internalTransferId: string;
  }): Promise<{ tbApplied: boolean }> {
    if (input.accountingClass === AccountingClass.A) {
      return { tbApplied: false };
    }
    throw new NotImplementedException({
      code: 'B_CLASS_ACCOUNTING_PENDING',
      message: 'B-class drain accounting is implemented in Phase 3',
    });
  }
}
