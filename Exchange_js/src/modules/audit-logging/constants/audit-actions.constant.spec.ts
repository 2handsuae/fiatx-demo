import { V1_AUDIT_ACTIONS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS, V6_SWAP_AUDIT_ACTIONS, V8_RECON_AUDIT_ACTIONS, DEPRECATED_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

describe('第一批 · V1 词表守则', () => {
  const codes = Object.keys(V1_AUDIT_ACTIONS);

  it('恰好 78 个码（首铸 45 + 站7 收编 22：治理 18 + 平台运营 4 − Task5(2026-08-30/31)退役 19：'
    + '监管闸门7+五本档案簿10+LP配置1+手工建户1，剩 APPROVAL_REQUIRED_MISSING/WALLET_STATUS_UPDATED/FUNDS_ORDER_ADVANCED，得 48；'
    + '+ 2 ADMIN_ACCESS_DENIED/APPROVAL_TIMEOUT_SIMULATED（此前未同步本断言的历史遗漏）；'
    + '+ 16 Task12(2026-09-01) SWAP/WITHDRAWAL_FEE_LEVEL_CREATION/CHANGE 四族裸名换前缀唯一新码，得 66；'
    + '+ 12 Task13(2026-09-01) 资产四族：6 码值不变只进合同（ASSET_CREATED_AND_PROVISIONED/ASSET_CREATION_FAILED/'
    + 'ASSET_PROVISIONING_UPDATED/ASSET_ACTIVATED/ASSET_SUSPENDED/ASSET_REACTIVATED）'
    + '+ 6 裸名换前缀唯一新码（SUSPENSION_/REACTIVATION_/ACTIVATION_ 各 REQUESTED+FAILED），得 78）', () => {
    expect(codes).toHaveLength(78);
  });

  it('全部全局唯一（键即字面量，无重复）', () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('六个后缀语义封闭，无例外', () => {
    // 站7 收编追加：MISSING/CREATED/UPDATED/RECORDED/EFFECTIVE/REVOKED/ADVANCED（现名保守，收编不改名）
    // SIMULATED：ADMIN_ACCESS_DENIED 之外另一处历史遗漏（APPROVAL_TIMEOUT_SIMULATED，此前未同步本断言）
    // APPLY_FAILED：Task12(2026-09-01) 费率两域专设失败码——不复用「APPLIED + outcome=FAILED」老套路
    // FAILED：Task13(2026-09-01) 资产四族——ASSET_CREATION_FAILED/ASSET_ACTIVATION_FAILED/
    // ASSET_SUSPENSION_FAILED/ASSET_REACTIVATION_FAILED 四码新增裸 FAILED 后缀
    // PROVISIONED/ACTIVATED/SUSPENDED/REACTIVATED：Task13 六个码值不变只进合同的一部分——
    // ASSET_CREATED_AND_PROVISIONED/ASSET_ACTIVATED/ASSET_SUSPENDED/ASSET_REACTIVATED
    // 沿用 AuditGovernanceActions 附册里的旧值（现名保守，入册不改名）
    const ok = /_(REQUESTED|APPLIED|COMPLETED|CANCELLED|EXPIRED|DENIED|GRANTED|SUBMITTED|DECLINED|DISPATCHED|ACCEPTED|INITIATED|BOUND|CONFIRMED|ISSUED|GENERATED|DOWNLOADED|QUERIED|RELEASED|MISSING|CREATED|UPDATED|RECORDED|EFFECTIVE|REVOKED|ADVANCED|SIMULATED|APPLY_FAILED|FAILED|PROVISIONED|ACTIVATED|SUSPENDED|REACTIVATED)$/;
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
      // Task12(2026-09-01)：费率两域裸名换前缀唯一新码，四族各 4 码
      'SWAP_FEE_LEVEL_CREATION_': 4, 'SWAP_FEE_LEVEL_CHANGE_': 4,
      'WITHDRAWAL_FEE_LEVEL_CREATION_': 4, 'WITHDRAWAL_FEE_LEVEL_CHANGE_': 4,
      // Task13(2026-09-01)：资产四族——REQUESTED/FAILED 共享前缀各 2 码；ASSET_ACTIVATED/
      // ASSET_SUSPENDED/ASSET_REACTIVATED 是保留原值的不规则过去式，不进前缀桶（同
      // WALLET_STATUS_UPDATED 等单码一样落单）；ASSET_CREATION_ 仅 FAILED 1 码
      // （ASSET_CREATED_AND_PROVISIONED/ASSET_PROVISIONING_UPDATED 不共享该前缀）
      'ASSET_ACTIVATION_': 2, 'ASSET_SUSPENSION_': 2, 'ASSET_REACTIVATION_': 2,
      'ASSET_CREATION_': 1,
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

  it('恰好 22 个 START（13 + Task12 四个 REQUESTED 各起一段新旅程 + Task13 五个：'
    + 'ASSET_CREATED_AND_PROVISIONED/ASSET_CREATION_FAILED 各起创建旅程 + 三族 REQUESTED）', () => {
    expect(codes.filter((c) => V1_AUDIT_ACTIONS[c].correlationMode === AuditCorrelationMode.START))
      .toHaveLength(22);
  });

  it('退役码 80 个（V1 域 11 + 充值域 18+1 + 提现域 18 + 兑换域 3 + 对账域 4 + Task5扩面 19：'
    + '监管闸门7+五本档案簿10+LP配置1+手工建户1 + Task13(2026-09-01) 资产四族裸名 6：'
    + 'SUSPENSION_REQUESTED/SUSPENSION_EXECUTION_FAILED/REACTIVATION_REQUESTED/'
    + 'REACTIVATION_EXECUTION_FAILED/ACTIVATION_REQUESTED/ACTIVATION_FAILED），且与五本在用名册零交集', () => {
    expect(DEPRECATED_AUDIT_ACTIONS).toHaveLength(80);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => codes.includes(d))).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V4_DEPOSIT_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V5_WITHDRAW_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V6_SWAP_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V8_RECON_AUDIT_ACTIONS)).toEqual([]);
  });
});
