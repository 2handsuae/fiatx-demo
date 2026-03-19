import {
  RBAC_PERMISSION_DEFINITIONS,
  buildRolePermissionCodeMap,
} from './rbac.catalog';
import { buildPermissionCode } from './permission-code.util';

describe('rbac.catalog', () => {
  it('should register alert triage permissions in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/alerts'))).toBe(true);
    expect(permissionCodes.has(buildPermissionCode('PATCH', '/admin/compliance/alerts/:id/action'))).toBe(true);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/incidents'))).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/incidents/from-alert/:alertId'),
      ),
    ).toBe(true);
  });

  it('should register case kernel permissions in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/cases'))).toBe(true);
    expect(permissionCodes.has(buildPermissionCode('PATCH', '/admin/compliance/cases/:id/action'))).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/cases/from-alert/:alertId'),
      ),
    ).toBe(true);
  });

  it('should register canonical onboarding response permissions', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/cdd-responses'))).toBe(true);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/edd-responses'))).toBe(true);
  });

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

  it('should grant alert read/write groups to the expected roles', () => {
    const permissionMap = buildRolePermissionCodeMap();
    const alertReadCode = buildPermissionCode('GET', '/admin/compliance/alerts');
    const alertWriteCode = buildPermissionCode('PATCH', '/admin/compliance/alerts/:id/action');

    expect(permissionMap.COMPLIANCE_LEAD).toContain(alertReadCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(alertWriteCode);
    expect(permissionMap.MLRO).toContain(alertReadCode);
    expect(permissionMap.MLRO).toContain(alertWriteCode);
    expect(permissionMap.RI).toContain(alertReadCode);
    expect(permissionMap.RI).not.toContain(alertWriteCode);
    expect(permissionMap.SM).toContain(alertReadCode);
    expect(permissionMap.SM).not.toContain(alertWriteCode);
    expect(permissionMap.CISO).toContain(alertReadCode);
    expect(permissionMap.CISO).not.toContain(alertWriteCode);
  });

  it('should grant case read/write groups to the expected roles', () => {
    const permissionMap = buildRolePermissionCodeMap();
    const caseReadCode = buildPermissionCode('GET', '/admin/compliance/cases');
    const caseWriteCode = buildPermissionCode('PATCH', '/admin/compliance/cases/:id/action');

    expect(permissionMap.COMPLIANCE_LEAD).toContain(caseReadCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(caseWriteCode);
    expect(permissionMap.MLRO).toContain(caseReadCode);
    expect(permissionMap.MLRO).toContain(caseWriteCode);
    expect(permissionMap.RI).toContain(caseReadCode);
    expect(permissionMap.RI).not.toContain(caseWriteCode);
    expect(permissionMap.SM).toContain(caseReadCode);
    expect(permissionMap.SM).not.toContain(caseWriteCode);
    expect(permissionMap.CISO).toContain(caseReadCode);
    expect(permissionMap.CISO).not.toContain(caseWriteCode);
  });

  it('should register case evidence export permissions and grant them to the expected roles', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );
    const permissionMap = buildRolePermissionCodeMap();
    const caseExportReadCode = buildPermissionCode(
      'GET',
      '/admin/compliance/cases/evidence-packages',
    );
    const caseExportWriteCode = buildPermissionCode(
      'POST',
      '/admin/compliance/cases/export/evidence-package',
    );

    expect(permissionCodes.has(caseExportReadCode)).toBe(true);
    expect(permissionCodes.has(caseExportWriteCode)).toBe(true);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(caseExportReadCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(caseExportWriteCode);
    expect(permissionMap.MLRO).toContain(caseExportReadCode);
    expect(permissionMap.MLRO).toContain(caseExportWriteCode);
    expect(permissionMap.RI).toContain(caseExportReadCode);
    expect(permissionMap.RI).not.toContain(caseExportWriteCode);
    expect(permissionMap.SM).toContain(caseExportReadCode);
    expect(permissionMap.SM).not.toContain(caseExportWriteCode);
    expect(permissionMap.CISO).toContain(caseExportReadCode);
    expect(permissionMap.CISO).not.toContain(caseExportWriteCode);
  });
});
