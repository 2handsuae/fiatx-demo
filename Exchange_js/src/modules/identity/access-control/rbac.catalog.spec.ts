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

  it('should register payin simulation rail route in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/treasury/payins/:id/mock-event'),
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

  it('should register regulatory gate routes in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/governance/regulatory-gates'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/governance/regulatory-gates'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/governance/regulatory-gates/:id/mark-effective',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/governance/regulatory-gates/:id/revoke',
        ),
      ),
    ).toBe(true);
  });

  it('should register governance registry routes in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(
      permissionCodes.has(
        buildPermissionCode(
          'GET',
          '/admin/governance/registries/shareholding-versions',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/governance/registries/shareholding-versions',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'GET',
          '/admin/governance/registries/appointments',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/governance/registries/trainings',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'PATCH',
          '/admin/governance/registries/conflicts/:id',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'GET',
          '/admin/governance/registries/wind-down-materials/:id',
        ),
      ),
    ).toBe(true);
  });

  it('should grant governance registry read/write groups to the expected roles', () => {
    const permissionMap = buildRolePermissionCodeMap();
    const readCode = buildPermissionCode(
      'GET',
      '/admin/governance/registries/shareholding-versions',
    );
    const writeCode = buildPermissionCode(
      'POST',
      '/admin/governance/registries/shareholding-versions',
    );

    expect(permissionMap.SENIOR_MANAGEMENT_OFFICER).toContain(readCode);
    expect(permissionMap.SENIOR_MANAGEMENT_OFFICER).not.toContain(writeCode);
    expect(permissionMap.SENIOR_MANAGEMENT_OFFICER).toContain(readCode);
    expect(permissionMap.SENIOR_MANAGEMENT_OFFICER).not.toContain(writeCode);
    expect(permissionMap.OPS_OFFICER).toContain(readCode);
    expect(permissionMap.OPS_OFFICER).not.toContain(writeCode);
    expect(permissionMap.COMPLIANCE_OFFICER).toContain(readCode);
    expect(permissionMap.COMPLIANCE_OFFICER).toContain(writeCode);
    expect(permissionMap.TECH_OFFICER).toContain(readCode);
    expect(permissionMap.TECH_OFFICER).toContain(writeCode);
    expect(permissionMap.CISO).toContain(readCode);
    expect(permissionMap.CISO).toContain(writeCode);
  });
});
