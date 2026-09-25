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
