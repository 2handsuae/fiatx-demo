import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface I5Result {
  invariantCode: 'I5';
  currency: string;
  tbAmount: Prisma.Decimal;
  externalAmount: Prisma.Decimal;
  inTransitAmount: Prisma.Decimal;
  expectedExternal: Prisma.Decimal;
  delta: Prisma.Decimal;
  status: 'PASS' | 'FAIL';
  severity: 'ACCOUNT_ACTUAL';
}

/** I5 = Step 1 账实对账：TB 客户池 vs 外部物理(+in-transit)。纯函数。 */
@Injectable()
export class BalanceReconService {
  computeI5(
    currency: string,
    tbAmount: Prisma.Decimal,
    externalActual: Prisma.Decimal,
    inTransitAdj: Prisma.Decimal,
  ): I5Result {
    // 外部物理 + in-transit 调整 = 期望应等于 TB
    const expectedExternal = externalActual.plus(inTransitAdj);
    const delta = tbAmount.minus(expectedExternal);
    return {
      invariantCode: 'I5', currency,
      tbAmount, externalAmount: externalActual, inTransitAmount: inTransitAdj,
      expectedExternal, delta,
      status: delta.abs().lessThan('0.000001') ? 'PASS' : 'FAIL',
      severity: 'ACCOUNT_ACTUAL',
    };
  }
}
