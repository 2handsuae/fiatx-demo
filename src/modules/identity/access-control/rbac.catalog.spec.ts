import {
  RBAC_PERMISSION_DEFINITIONS,
  buildRolePermissionCodeMap,
} from './rbac.catalog';
import { buildPermissionCode } from './permission-code.util';

describe('rbac.catalog', () => {

  it('should retire deprecated direct-control and compatibility review aliases', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(permissionCodes.has(buildPermissionCode('POST', '/customers/:id/status'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('POST', '/customers/:id/freeze'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('POST', '/customers/:id/unfreeze'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('POST', '/admin/compliance/cdd-cases/:id/review'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('POST', '/admin/compliance/edd-cases/:id/mlro-review'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('POST', '/admin/compliance/customers/:id/final-review'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/incidents'))).toBe(false);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/incidents/from-alert/:alertId'),
      ),
    ).toBe(false);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/incidents/:id/onboarding-decision'),
      ),
    ).toBe(false);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/alerts/:id/onboarding-decision'),
      ),
    ).toBe(false);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/alerts/:id/periodic-review-decision'),
      ),
    ).toBe(false);
  });

  it('should retire case-named response read aliases after Stage 3B', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/cdd-cases'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/cdd-cases/:id'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/edd-cases'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/edd-cases/:id'))).toBe(false);
  });

  it('should remove Wave 4 demo shortcut routes from RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(permissionCodes.has(buildPermissionCode('POST', '/treasury/payins/simulate'))).toBe(false);
    expect(permissionCodes.has(buildPermissionCode('POST', '/deposit-transactions'))).toBe(false);
  });

  it('should retire payin/payout routes and expose the unified funds-orders read surface (Round 2 / C6)', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    // Legacy payin/payout admin routes were dropped when their backends were
    // deleted (C3) and folded into the unified funds-orders surface.
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/treasury/payins/:id/mock-event'),
      ),
    ).toBe(false);
    expect(
      permissionCodes.has(buildPermissionCode('GET', '/treasury/payins')),
    ).toBe(false);
    expect(
      permissionCodes.has(buildPermissionCode('GET', '/payouts')),
    ).toBe(false);
    // Legacy funds-layer/funds read route replaced by /admin/funds-orders.
    expect(
      permissionCodes.has(buildPermissionCode('GET', '/admin/funds-layer/funds')),
    ).toBe(false);

    // The unified funds-orders read surface is registered.
    expect(
      permissionCodes.has(buildPermissionCode('GET', '/admin/funds-orders')),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/funds-orders/:fundsOrderNo'),
      ),
    ).toBe(true);
  });

  it('should retire tx mock-backfill route from RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/tx-cases/mock-backfill'),
      ),
    ).toBe(false);
  });

  it('should include Phase 1 inbound signal routes in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/deposit-transactions/my/inbound-signals'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/deposit-transactions/my/inbound-signals'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/deposit-transactions/my/inbound-signals/scan'),
      ),
    ).toBe(true);
  });

  // 对手方波一 T5：地址筛查 ⚡喂挂 DEMO_VERDICT_WRITE（站在 Sumsub 一侧，与喂裁决同位），零新权限组。
  // 未登记 = AdminPermissionGuard 全员 403，故断言「登记了 + 谁点得动」。
  it('simulate-screening route is registered under DEMO_VERDICT_WRITE: compliance officer can click it (and read the page), treasury cannot', () => {
    const code = buildPermissionCode('POST', '/admin/withdrawal-addresses/:addressNo/simulate-screening');
    expect(code).toBe('api.post.admin_withdrawal_addresses_addressno_simulate_screening');

    const def = RBAC_PERMISSION_DEFINITIONS.find((item) => item.code === code);
    expect(def).toBeDefined();
    expect(def!.groups).toEqual(['DEMO_VERDICT_WRITE']);

    const map = buildRolePermissionCodeMap();
    expect(map.COMPLIANCE_OFFICER).toContain(code);
    expect(map.COMPLIANCE_OFFICER).toContain(buildPermissionCode('GET', '/admin/withdrawal-addresses/:addressNo'));
    expect(map.TREASURY_OFFICER).not.toContain(code);
  });

  // 对手方波二 T4：充值来源归因 ⚡喂同款——站在 Sumsub 一侧，挂 DEMO_VERDICT_WRITE，零新权限组。
  it('feed-attribution route is registered under DEMO_VERDICT_WRITE: compliance officer can click it, treasury cannot', () => {
    const code = buildPermissionCode('POST', '/admin/deposit-sumsub/demo/feed-attribution');
    expect(code).toBe('api.post.admin_deposit_sumsub_demo_feed_attribution');

    const def = RBAC_PERMISSION_DEFINITIONS.find((item) => item.code === code);
    expect(def).toBeDefined();
    expect(def!.groups).toEqual(['DEMO_VERDICT_WRITE']);

    const map = buildRolePermissionCodeMap();
    expect(map.COMPLIANCE_OFFICER).toContain(code);
    expect(map.TREASURY_OFFICER).not.toContain(code);
  });

  // LP 两步准入 Task 4：LP 打款地址簿端点逐条登记（未登记 = AdminPermissionGuard 全员 403）。读挂 LP_READ、写挂
  // LP_WRITE、⚡筛查覆写挂 DEMO_VERDICT_WRITE（零新权限组）；金库（maker）能写不能点 ⚡，CFO（checker）只读。
  it('LP payout address routes are all registered with the right groups (read LP_READ / write LP_WRITE / ⚡ DEMO_VERDICT_WRITE)', () => {
    const expected: Array<[string, string, string]> = [
      ['POST', '/admin/lp-profiles/:lpNo/payout-addresses', 'LP_WRITE'],
      ['GET', '/admin/lp-profiles/:lpNo/payout-addresses', 'LP_READ'],
      ['GET', '/admin/lp-payout-addresses/:addressNo', 'LP_READ'],
      ['POST', '/admin/lp-payout-addresses/:addressNo/cancel', 'LP_WRITE'],
      ['POST', '/admin/lp-payout-addresses/:addressNo/suspend', 'LP_WRITE'],
      ['POST', '/admin/lp-payout-addresses/:addressNo/reactivate', 'LP_WRITE'],
      ['POST', '/admin/lp-payout-addresses/:addressNo/deactivate', 'LP_WRITE'],
      ['PATCH', '/admin/lp-payout-addresses/:addressNo/label', 'LP_WRITE'],
      ['POST', '/admin/lp-payout-addresses/:addressNo/simulate-screening', 'DEMO_VERDICT_WRITE'],
    ];
    const map = buildRolePermissionCodeMap();
    for (const [method, path, group] of expected) {
      const code = buildPermissionCode(method, path);
      const def = RBAC_PERMISSION_DEFINITIONS.find((item) => item.code === code);
      expect({ code, groups: def?.groups }).toEqual({ code, groups: [group] });
      if (group === 'LP_WRITE') {
        expect(map.TREASURY_OFFICER).toContain(code);
        expect(map.CFO).not.toContain(code); // maker ≠ checker
      }
      if (group === 'LP_READ') {
        expect(map.TREASURY_OFFICER).toContain(code);
        expect(map.CFO).toContain(code); // 裁决人要看得见要批的对象
      }
      if (group === 'DEMO_VERDICT_WRITE') {
        expect(map.COMPLIANCE_OFFICER).toContain(code);
        expect(map.TREASURY_OFFICER).not.toContain(code);
      }
    }
  });

  // 甲波一 T5 修2（复审新 Important：族区分性质零红测，点 3 纯函数测试）：C1 修复的
  // 前提是这五个标记码各自只挂一个组、且互不相同——如果哪个码不小心挂了两个组，或两个码
  // 挂了同一个组，"族独占"的假设就塌了，assertOperator 的精确判定也就名不副实。
  describe('cap.incident.* family-exclusive capability markers (甲波一 T5 修1 C1 / 修2)', () => {
    const CAP_CODES = ['cap.incident.funds', 'cap.incident.tech', 'cap.incident.data', 'cap.incident.ops', 'cap.incident.fin'];

    it('each cap.incident.* definition has exactly one group', () => {
      for (const code of CAP_CODES) {
        const def = RBAC_PERMISSION_DEFINITIONS.find((item) => item.code === code);
        expect(def).toBeDefined();
        expect(def!.groups).toHaveLength(1);
      }
    });

    it('the five cap.incident.* definitions map to five distinct groups (no overlap)', () => {
      const groups = CAP_CODES.map((code) => RBAC_PERMISSION_DEFINITIONS.find((item) => item.code === code)!.groups[0]);
      expect(new Set(groups).size).toBe(groups.length);
    });

    it('buildRolePermissionCodeMap: TREASURY_OFFICER holds cap.incident.funds but not cap.incident.tech (family exclusivity, not "any incident write")', () => {
      const map = buildRolePermissionCodeMap();
      expect(map.TREASURY_OFFICER).toContain('cap.incident.funds');
      expect(map.TREASURY_OFFICER).not.toContain('cap.incident.tech');
    });
  });

});
