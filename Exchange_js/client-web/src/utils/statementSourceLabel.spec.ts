// client-web/src/utils/statementSourceLabel.spec.ts
import { statementSourceLabel } from './statementSourceLabel';

/** 平账二期（spec §11）：客户对账单三种平台发起的行——客户真经历过的余额变动，不藏，只换成人话。 */
describe('statementSourceLabel', () => {
  it('认损调账 → 平台调整', () => {
    expect(statementSourceLabel({ sourceType: 'RECON_ADJUSTMENT', eventCode: 'RECON_ADJUSTMENT_POSTED' })).toBe('平台调整');
  });
  it('补款 → 平台补款；垫款 → 平台垫付（按客户侧腿的事件码分）', () => {
    expect(statementSourceLabel({ sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_COMPENSATION_IN' })).toBe('平台补款');
    expect(statementSourceLabel({ sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_ADVANCE_IN' })).toBe('平台垫付');
  });
  it('其余不动：WITHDRAWAL 仍显示 WITHDRAW，其它原样', () => {
    expect(statementSourceLabel({ sourceType: 'WITHDRAWAL', eventCode: 'WITHDRAW_NET_POST' })).toBe('WITHDRAW');
    expect(statementSourceLabel({ sourceType: 'DEPOSIT', eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE' })).toBe('DEPOSIT');
    expect(statementSourceLabel({ sourceType: 'SWAP', eventCode: 'SWAP_BUY_CLIENT' })).toBe('SWAP');
  });
});
