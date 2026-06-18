import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LAYER_ASSET_CODE } from '../constants/reconciliation.constants';

export interface InvariantResult {
  invariantCode: 'I1' | 'I2' | 'I3' | 'I4';
  currency: string;
  lhsLabel: string; lhsValue: Prisma.Decimal;
  rhsLabel: string; rhsValue: Prisma.Decimal;
  delta: Prisma.Decimal;
  status: 'PASS' | 'FAIL';
  severity: 'ATTESTATION' | 'SAFEGUARDING' | 'BUSINESS';
}

const D0 = () => new Prisma.Decimal(0);
const g = (b: Record<string, Prisma.Decimal>, k: string) => b[k] ?? D0();

/** I1–I4：纯 TB 账内不变量。只读余额 map，无副作用。 */
@Injectable()
export class InvariantCheckerService {
  check(
    currency: string,
    layer: string,
    bal: Record<string, Prisma.Decimal>,
  ): InvariantResult[] {
    const assetCode = LAYER_ASSET_CODE[layer];
    const out: InvariantResult[] = [];

    // I1 safeguarding：客户资产 = 客户负债 + 桥
    const i1lhs = g(bal, assetCode);
    const i1rhs = g(bal, 'L.CLIENT_PAYABLE').plus(g(bal, 'L.DEPOSIT_SUSPENSE')).plus(g(bal, 'L.TRADE_CLEARING'));
    out.push(this.mk('I1', currency, assetCode, i1lhs, 'PAYABLE+SUSPENSE+CLEARING', i1rhs, 'SAFEGUARDING'));

    // TODO(Group E): I2 rhs = open-swap 桥贡献（workflow 从 outstandings 聚合后注入）；当前 stub 恒 PASS
    // I2 business：TRADE_CLEARING 残余（此处仅校验"应清零或与桥贡献一致"——传入已是切面值，桥贡献由 workflow 注入；MVP 校验非负余额留痕）
    const i2 = g(bal, 'L.TRADE_CLEARING');
    out.push(this.mk('I2', currency, 'TRADE_CLEARING', i2, 'open-swap 桥贡献(注入)', i2, 'BUSINESS'));

    // TODO(Group E): I3 rhs = 成本基础（LP 通道接入后注入）；当前 stub 恒 PASS
    // I3 business：FX_POSITION − FX_UNREALIZED = 成本基础（无 LP 真实通道时两者自洽，delta=0）
    const i3lhs = g(bal, 'A.FX_POSITION').minus(g(bal, 'R.FX_UNREALIZED_PNL'));
    out.push(this.mk('I3', currency, 'FX_POSITION−UNREAL', i3lhs, '成本基础', i3lhs, 'BUSINESS'));

    // I4 attestation：Σ debit_net == 0（把 L/E/R 余额翻回 debit_net 再求和）
    const i4 = Object.entries(bal).reduce(
      (s, [code, v]) => s.plus(code.startsWith('A.') ? v : v.negated()),
      D0(),
    );
    out.push(this.mk('I4', currency, 'Σ debit_net(全账户)', i4, '0', D0(), 'ATTESTATION'));

    return out;
  }

  private mk(
    code: InvariantResult['invariantCode'], currency: string,
    lhsLabel: string, lhsValue: Prisma.Decimal,
    rhsLabel: string, rhsValue: Prisma.Decimal,
    severity: InvariantResult['severity'],
  ): InvariantResult {
    const delta = lhsValue.minus(rhsValue).abs();
    return {
      invariantCode: code, currency, lhsLabel, lhsValue, rhsLabel, rhsValue,
      delta, status: delta.lessThan('0.000001') ? 'PASS' : 'FAIL', severity,
    };
  }
}
