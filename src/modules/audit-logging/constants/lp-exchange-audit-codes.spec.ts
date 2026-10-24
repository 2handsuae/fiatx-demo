import { AuditActions, CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

const I = AuditCorrelationMode.INHERIT;

describe('LP 两步准入 T6 · LP 兑换单审计码 LP_EXCHANGE_DELIVERY_SCREENED（四属性冻结）', () => {
  it('入既有兑换族表（不另立名册）并与平面表同名；兑换族由 8 码变 9 码', () => {
    expect(CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS.LP_EXCHANGE_DELIVERY_SCREENED).toBeDefined();
    expect(AuditActions.LP_EXCHANGE_DELIVERY_SCREENED).toBe('LP_EXCHANGE_DELIVERY_SCREENED');
    expect(Object.keys(CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS).sort()).toEqual([
      'LP_EXCHANGE_ACCEPTED', 'LP_EXCHANGE_CANCELLED', 'LP_EXCHANGE_DELIVERED', 'LP_EXCHANGE_DELIVERY_SCREENED', 'LP_EXCHANGE_EXECUTION_STARTED',
      'LP_EXCHANGE_FAILED', 'LP_EXCHANGE_PAY_LEG_POSTED', 'LP_EXCHANGE_REJECTED', 'LP_EXCHANGE_REQUESTED',
    ]);
  });

  it('四属性冻结：域 TREASURY ｜ 继承兑换单旅程 ｜ 必填 afterData（来源 + 结论，同 LP_ADDRESS_SCREENED 的形状）｜ 非异步（系统在到货动作内同步筛，不带 causation）', () => {
    expect(CAMPAIGN_B_LP_EXCHANGE_AUDIT_ACTIONS.LP_EXCHANGE_DELIVERY_SCREENED).toEqual({
      domain: 'TREASURY', correlationMode: I, requiredFields: ['afterData'], requiresCausation: false,
    });
  });
});
