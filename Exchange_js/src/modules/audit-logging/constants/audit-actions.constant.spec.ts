import { V1_AUDIT_ACTIONS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS, V6_SWAP_AUDIT_ACTIONS, V8_RECON_AUDIT_ACTIONS, DEPRECATED_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

describe('第一批 · V1 词表守则', () => {
  const codes = Object.keys(V1_AUDIT_ACTIONS);

  it('恰好 48 个码（首铸 45 + 站7 收编 22：治理 18 + 平台运营 4 − Task5(2026-08-30/31)退役 19：'
    + '监管闸门7+五本档案簿10+LP配置1+手工建户1，剩 APPROVAL_REQUIRED_MISSING/WALLET_STATUS_UPDATED/FUNDS_ORDER_ADVANCED）', () => {
    expect(codes).toHaveLength(48);
  });

  it('全部全局唯一（键即字面量，无重复）', () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('六个后缀语义封闭，无例外', () => {
    // 站7 收编追加：MISSING/CREATED/UPDATED/RECORDED/EFFECTIVE/REVOKED/ADVANCED（现名保守，收编不改名）
    const ok = /_(REQUESTED|APPLIED|COMPLETED|CANCELLED|EXPIRED|DENIED|GRANTED|SUBMITTED|DECLINED|DISPATCHED|ACCEPTED|INITIATED|BOUND|CONFIRMED|ISSUED|GENERATED|DOWNLOADED|QUERIED|RELEASED|MISSING|CREATED|UPDATED|RECORDED|EFFECTIVE|REVOKED|ADVANCED)$/;
    const bad = codes.filter((c) => !ok.test(c));
    expect(bad).toEqual([]);
  });

  it('每码都声明了四件事', () => {
    for (const c of codes) {
      const s = V1_AUDIT_ACTIONS[c];
      expect(typeof s.domain).toBe('string');
      expect(Object.values(AuditCorrelationMode)).toContain(s.correlationMode);
      expect(Array.isArray(s.requiredFields)).toBe(true);
      expect(typeof s.requiresCausation).toBe('boolean');
    }
  });

  it('前缀优先：同一趟流程的码共享前缀', () => {
    const expectCount: Record<string, number> = {
      'ADMIN_INVITE_': 5, 'ADMIN_FIRST_LOGIN_': 4, 'ADMIN_ROLE_CHANGE_': 3,
      'ADMIN_SUSPENSION_': 2, 'ADMIN_REACTIVATION_': 2, 'ADMIN_PASSWORD_RESET_': 6,
      'ADMIN_MFA_RESET_': 3, 'ADMIN_ACCOUNT_LOCK_': 2,
      'ROLE_DEFINITION_CREATE_': 3, 'ROLE_DEFINITION_MODIFY_': 3,
      'APPROVAL_POLICY_CHANGE_': 2, 'AUDIT_EVIDENCE_EXPORT_': 3,
      // REGULATORY_GATE_ 曾 7 码，Task 5(2026-08-30) 随监管闸门整块退役。
      // 断言 0 而不是删掉这一行：只有显式钉住「live 表里该前缀一个都没有」，才能挡住
      // 「新铸一个从未出现过的 REGULATORY_GATE_* 码进 live 表、同时别处删一个键把总数
      // 维持在 48」这条绕过路径——它躲得过总数断言，也躲得过退役名册零交集断言。
      'REGULATORY_GATE_': 0,
    };
    for (const [p, n] of Object.entries(expectCount)) {
      expect(codes.filter((c) => c.startsWith(p))).toHaveLength(n);
    }
  });

  it('恰好 13 个 START', () => {
    expect(codes.filter((c) => V1_AUDIT_ACTIONS[c].correlationMode === AuditCorrelationMode.START))
      .toHaveLength(13);
  });

  it('退役码 74 个（V1 域 11 + 充值域 18+1 + 提现域 18 + 兑换域 3 + 对账域 4 + Task5扩面 19：'
    + '监管闸门7+五本档案簿10+LP配置1+手工建户1），且与五本在用名册零交集', () => {
    expect(DEPRECATED_AUDIT_ACTIONS).toHaveLength(74);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => codes.includes(d))).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V4_DEPOSIT_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V5_WITHDRAW_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V6_SWAP_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V8_RECON_AUDIT_ACTIONS)).toEqual([]);
  });
});
