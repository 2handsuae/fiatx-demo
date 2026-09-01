import { V1_AUDIT_ACTIONS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS, V6_SWAP_AUDIT_ACTIONS, V8_RECON_AUDIT_ACTIONS, DEPRECATED_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

describe('第一批 · V1 词表守则', () => {
  const codes = Object.keys(V1_AUDIT_ACTIONS);

  it('恰好 99 个码（首铸 45 + 站7 收编 22：治理 18 + 平台运营 4 − Task5(2026-08-30/31)退役 19：'
    + '监管闸门7+五本档案簿10+LP配置1+手工建户1，剩 APPROVAL_REQUIRED_MISSING/WALLET_STATUS_UPDATED/FUNDS_ORDER_ADVANCED，得 48；'
    + '+ 2 ADMIN_ACCESS_DENIED/APPROVAL_TIMEOUT_SIMULATED（此前未同步本断言的历史遗漏）；'
    + '+ 16 Task12(2026-09-01) SWAP/WITHDRAWAL_FEE_LEVEL_CREATION/CHANGE 四族裸名换前缀唯一新码，得 66；'
    + '+ 12 Task13(2026-09-01) 资产四族：6 码值不变只进合同（ASSET_CREATED_AND_PROVISIONED/ASSET_CREATION_FAILED/'
    + 'ASSET_PROVISIONING_UPDATED/ASSET_ACTIVATED/ASSET_SUSPENDED/ASSET_REACTIVATED）'
    + '+ 6 裸名换前缀唯一新码（SUSPENSION_/REACTIVATION_/ACTIVATION_ 各 REQUESTED+FAILED），得 78；'
    + '+ 11 Task14(2026-09-02) 限额两族 + 客户标签 + L1 拦截码：TRANSACTION_LIMIT_CREATION_/'
    + 'TRANSACTION_LIMIT_CHANGE_ 各 4（REQUESTED/APPLIED/APPLY_FAILED/CANCELLED）+ '
    + 'CUSTOMER_TAG_ASSIGNED/CUSTOMER_TAG_REVOKED + TRANSACTION_LIMIT_REJECTED（非本批裸名，顺带补登），得 89；'
    + '+ 10 Task15(2026-09-02) 托管钱包创建 + 提现地址登记两族：CUSTODIAN_WALLET_CREATE_REQUESTED/'
    + 'CREATED/FAILED/CANCELLED 四码 + WITHDRAWAL_ADDRESS_REGISTERED/ACTIVATED/CANCELLED/'
    + 'SUSPENDED/DEACTIVATED/COOLING_SKIPPED 六码，得 99）', () => {
    expect(codes).toHaveLength(99);
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
    // ASSIGNED：Task14(2026-09-02) CUSTOMER_TAG_ASSIGNED 新增裸 ASSIGNED 后缀
    // REJECTED：Task14 TRANSACTION_LIMIT_REJECTED（沿用 AuditGovernanceActions 附册旧值，入册不改名）
    // REGISTERED：Task15(2026-09-02) WITHDRAWAL_ADDRESS_REGISTERED 新增裸 REGISTERED 后缀
    // DEACTIVATED：Task15 WITHDRAWAL_ADDRESS_DEACTIVATED 新增裸 DEACTIVATED 后缀
    // SKIPPED：Task15 WITHDRAWAL_ADDRESS_COOLING_SKIPPED（MANUAL_COOLING_SKIP 改名）新增裸 SKIPPED 后缀
    const ok = /_(REQUESTED|APPLIED|COMPLETED|CANCELLED|EXPIRED|DENIED|GRANTED|SUBMITTED|DECLINED|DISPATCHED|ACCEPTED|INITIATED|BOUND|CONFIRMED|ISSUED|GENERATED|DOWNLOADED|QUERIED|RELEASED|MISSING|CREATED|UPDATED|RECORDED|EFFECTIVE|REVOKED|ADVANCED|SIMULATED|APPLY_FAILED|FAILED|PROVISIONED|ACTIVATED|SUSPENDED|REACTIVATED|ASSIGNED|REJECTED|REGISTERED|DEACTIVATED|SKIPPED)$/;
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
      // Task14(2026-09-02)：限额两族裸名换前缀唯一新码，各 4 码；客户标签两码共享前缀。
      // TRANSACTION_LIMIT_REJECTED 不进任何前缀桶（单码落单，同 WALLET_STATUS_UPDATED）。
      'TRANSACTION_LIMIT_CREATION_': 4, 'TRANSACTION_LIMIT_CHANGE_': 4,
      'CUSTOMER_TAG_': 2,
      // Task15(2026-09-02)：CUSTODIAN_WALLET_CREATE_ 只收 REQUESTED/FAILED/CANCELLED
      // 三码——CUSTODIAN_WALLET_CREATED 是保留原值的不规则过去式，同 ASSET_ACTIVATED
      // 一样不进前缀桶（CREATE_ 后面接的是 D 不是下划线，字符串前缀本就不匹配）。
      // WITHDRAWAL_ADDRESS_ 六码全共享前缀（REGISTERED/ACTIVATED/CANCELLED/SUSPENDED/
      // DEACTIVATED/COOLING_SKIPPED），无不规则过去式例外。
      'CUSTODIAN_WALLET_CREATE_': 3, 'WITHDRAWAL_ADDRESS_': 6,
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

  it('恰好 26 个 START（13 + Task12 四个 REQUESTED 各起一段新旅程 + Task13 五个：'
    + 'ASSET_CREATED_AND_PROVISIONED/ASSET_CREATION_FAILED 各起创建旅程 + 三族 REQUESTED'
    + ' + Task14 两个：TRANSACTION_LIMIT_CREATION_REQUESTED/TRANSACTION_LIMIT_CHANGE_REQUESTED'
    + '——CUSTOMER_TAG_ASSIGNED/REVOKED 与 TRANSACTION_LIMIT_REJECTED 都是单步动作，无旅程可开，定 NONE'
    + ' + Task15 两个：CUSTODIAN_WALLET_CREATE_REQUESTED/WITHDRAWAL_ADDRESS_REGISTERED 各起一段新旅程'
    + '——其余 8 码都是 INHERIT 读回同一旅程的 correlationId，得 26）', () => {
    expect(codes.filter((c) => V1_AUDIT_ACTIONS[c].correlationMode === AuditCorrelationMode.START))
      .toHaveLength(26);
  });

  it('退役码 99 个（V1 域 11 + 充值域 18+1 + 提现域 18 + 兑换域 3 + 对账域 4 + Task5扩面 19：'
    + '监管闸门7+五本档案簿10+LP配置1+手工建户1 + Task13(2026-09-01) 资产四族裸名 6：'
    + 'SUSPENSION_REQUESTED/SUSPENSION_EXECUTION_FAILED/REACTIVATION_REQUESTED/'
    + 'REACTIVATION_EXECUTION_FAILED/ACTIVATION_REQUESTED/ACTIVATION_FAILED'
    + ' + Task14(2026-09-02) 限额/标签共用裸名 9：CREATION_REQUESTED/CREATION_APPLIED/'
    + 'CREATION_APPLY_FAILED/CREATION_CANCELLED/CHANGE_REQUESTED/CHANGE_APPLIED/CHANGE_CANCELLED/'
    + 'TAG_ASSIGNED/TAG_REVOKED（CHANGE_APPLY_FAILED 已在站7批次登记过，不重复计数），得 89'
    + ' + Task15(2026-09-02) 托管钱包+提现地址裸名 10：CREATE_REQUESTED/WALLET_CREATED/'
    + 'WALLET_CREATE_FAILED/CREATE_CANCELLED/ADDRESS_REGISTERED/ADDRESS_ACTIVATED/'
    + 'ADDRESS_CANCELLED/ADDRESS_SUSPENDED/ADDRESS_DEACTIVATED/MANUAL_COOLING_SKIP，得 99），'
    + '且与五本在用名册零交集', () => {
    expect(DEPRECATED_AUDIT_ACTIONS).toHaveLength(99);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => codes.includes(d))).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V4_DEPOSIT_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V5_WITHDRAW_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V6_SWAP_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V8_RECON_AUDIT_ACTIONS)).toEqual([]);
  });
});
