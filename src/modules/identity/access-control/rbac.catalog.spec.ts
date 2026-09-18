import {
  RBAC_PERMISSION_DEFINITIONS,
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

});
