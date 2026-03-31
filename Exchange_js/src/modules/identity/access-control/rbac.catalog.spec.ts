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
    expect(permissionCodes.has(buildPermissionCode('POST', '/admin/compliance/alerts/:id/resolve'))).toBe(true);
    expect(permissionCodes.has(buildPermissionCode('GET', '/admin/compliance/cases'))).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/cases/from-alert/:alertId'),
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
        buildPermissionCode('POST', '/admin/compliance/cases/:id/report/submit-to-mlro'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('POST', '/admin/compliance/cases/:id/mlro-review'),
      ),
    ).toBe(true);
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

  it('should grant alert read/write groups to the expected roles', () => {
    const permissionMap = buildRolePermissionCodeMap();
    const alertReadCode = buildPermissionCode('GET', '/admin/compliance/alerts');
    const alertWriteCode = buildPermissionCode('PATCH', '/admin/compliance/alerts/:id/action');
    const alertResolveCode = buildPermissionCode('POST', '/admin/compliance/alerts/:id/resolve');

    expect(permissionMap.COMPLIANCE_LEAD).toContain(alertReadCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(alertWriteCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(alertResolveCode);
    expect(permissionMap.MLRO).toContain(alertReadCode);
    expect(permissionMap.MLRO).toContain(alertWriteCode);
    expect(permissionMap.MLRO).toContain(alertResolveCode);
    expect(permissionMap.RI).toContain(alertReadCode);
    expect(permissionMap.RI).not.toContain(alertWriteCode);
    expect(permissionMap.RI).not.toContain(alertResolveCode);
    expect(permissionMap.SM).toContain(alertReadCode);
    expect(permissionMap.SM).not.toContain(alertWriteCode);
    expect(permissionMap.SM).not.toContain(alertResolveCode);
    expect(permissionMap.CISO).toContain(alertReadCode);
    expect(permissionMap.CISO).not.toContain(alertWriteCode);
    expect(permissionMap.CISO).not.toContain(alertResolveCode);
  });

  it('should grant case read/write groups to the expected roles', () => {
    const permissionMap = buildRolePermissionCodeMap();
    const caseReadCode = buildPermissionCode('GET', '/admin/compliance/cases');
    const caseWriteCode = buildPermissionCode('PATCH', '/admin/compliance/cases/:id/action');
    const caseMlroReviewCode = buildPermissionCode(
      'POST',
      '/admin/compliance/cases/:id/mlro-review',
    );

    expect(permissionMap.COMPLIANCE_LEAD).toContain(caseReadCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(caseWriteCode);
    expect(permissionMap.COMPLIANCE_LEAD).not.toContain(caseMlroReviewCode);
    expect(permissionMap.MLRO).toContain(caseReadCode);
    expect(permissionMap.MLRO).toContain(caseWriteCode);
    expect(permissionMap.MLRO).toContain(caseMlroReviewCode);
    expect(permissionMap.RI).toContain(caseReadCode);
    expect(permissionMap.RI).not.toContain(caseWriteCode);
    expect(permissionMap.RI).not.toContain(caseMlroReviewCode);
    expect(permissionMap.SM).toContain(caseReadCode);
    expect(permissionMap.SM).not.toContain(caseWriteCode);
    expect(permissionMap.SM).not.toContain(caseMlroReviewCode);
    expect(permissionMap.CISO).toContain(caseReadCode);
    expect(permissionMap.CISO).not.toContain(caseWriteCode);
    expect(permissionMap.CISO).not.toContain(caseMlroReviewCode);
  });

  it('should register risk decision simulation permission and grant it to operator roles', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );
    const permissionMap = buildRolePermissionCodeMap();
    const simulateCode = buildPermissionCode(
      'POST',
      '/admin/risk/decision-records/:id/simulate',
    );

    expect(permissionCodes.has(simulateCode)).toBe(true);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(simulateCode);
    expect(permissionMap.MLRO).toContain(simulateCode);
    expect(permissionMap.TECH_ADMIN).toContain(simulateCode);
    expect(permissionMap.RI).not.toContain(simulateCode);
    expect(permissionMap.SM).not.toContain(simulateCode);
    expect(permissionMap.CISO).not.toContain(simulateCode);
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

  it('should register safeguarding break routes in RBAC catalog', () => {
    const permissionCodes = new Set(
      RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
    );

    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/reconciliation/safeguarding-breaks/generate-daily-diff',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/reconciliation/safeguarding-breaks'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/reconciliation/safeguarding-breaks/:id'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'PATCH',
          '/admin/reconciliation/safeguarding-breaks/:id/status',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/reconciliation/safeguarding-warnings'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'GET',
          '/admin/reconciliation/safeguarding-warnings/:id',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'PATCH',
          '/admin/reconciliation/safeguarding-warnings/:id/status',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/reconciliation/safeguarding-runs'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode('GET', '/admin/reconciliation/safeguarding-runs/:id'),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/reconciliation/safeguarding-fiat-statements/imports',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'GET',
          '/admin/reconciliation/safeguarding-fiat-statements/imports',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'GET',
          '/admin/reconciliation/safeguarding-fiat-statements/imports/:id',
        ),
      ),
    ).toBe(true);
    expect(
      permissionCodes.has(
        buildPermissionCode(
          'POST',
          '/admin/reconciliation/safeguarding-runs/:id/export-evidence-package',
        ),
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

  it('should grant safeguarding break read/write groups to the expected roles', () => {
    const permissionMap = buildRolePermissionCodeMap();
    const readCode = buildPermissionCode(
      'GET',
      '/admin/reconciliation/safeguarding-breaks',
    );
    const detailCode = buildPermissionCode(
      'GET',
      '/admin/reconciliation/safeguarding-breaks/:id',
    );
    const generateCode = buildPermissionCode(
      'POST',
      '/admin/reconciliation/safeguarding-breaks/generate-daily-diff',
    );
    const writeCode = buildPermissionCode(
      'PATCH',
      '/admin/reconciliation/safeguarding-breaks/:id/status',
    );
    const warningReadCode = buildPermissionCode(
      'GET',
      '/admin/reconciliation/safeguarding-warnings',
    );
    const warningWriteCode = buildPermissionCode(
      'PATCH',
      '/admin/reconciliation/safeguarding-warnings/:id/status',
    );
    const runReadCode = buildPermissionCode(
      'GET',
      '/admin/reconciliation/safeguarding-runs',
    );
    const statementImportWriteCode = buildPermissionCode(
      'POST',
      '/admin/reconciliation/safeguarding-fiat-statements/imports',
    );
    const runExportWriteCode = buildPermissionCode(
      'POST',
      '/admin/reconciliation/safeguarding-runs/:id/export-evidence-package',
    );

    expect(permissionMap.OPS_TREASURY).toContain(readCode);
    expect(permissionMap.OPS_TREASURY).toContain(detailCode);
    expect(permissionMap.OPS_TREASURY).toContain(generateCode);
    expect(permissionMap.OPS_TREASURY).toContain(writeCode);
    expect(permissionMap.OPS_TREASURY).toContain(warningReadCode);
    expect(permissionMap.OPS_TREASURY).toContain(warningWriteCode);
    expect(permissionMap.OPS_TREASURY).toContain(runReadCode);
    expect(permissionMap.OPS_TREASURY).toContain(statementImportWriteCode);
    expect(permissionMap.OPS_TREASURY).toContain(runExportWriteCode);
    expect(permissionMap.FINANCE).toContain(readCode);
    expect(permissionMap.FINANCE).toContain(writeCode);
    expect(permissionMap.FINANCE).toContain(warningReadCode);
    expect(permissionMap.FINANCE).toContain(runReadCode);
    expect(permissionMap.FINANCE).toContain(statementImportWriteCode);
    expect(permissionMap.FINANCE).toContain(runExportWriteCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(readCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(writeCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(warningReadCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(warningWriteCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(runReadCode);
    expect(permissionMap.MLRO).toContain(readCode);
    expect(permissionMap.MLRO).toContain(writeCode);
    expect(permissionMap.MLRO).toContain(warningReadCode);
    expect(permissionMap.MLRO).toContain(warningWriteCode);
    expect(permissionMap.MLRO).toContain(runReadCode);
    expect(permissionMap.RI).toContain(readCode);
    expect(permissionMap.RI).toContain(detailCode);
    expect(permissionMap.RI).toContain(warningReadCode);
    expect(permissionMap.RI).toContain(runReadCode);
    expect(permissionMap.RI).not.toContain(generateCode);
    expect(permissionMap.RI).not.toContain(writeCode);
    expect(permissionMap.SM).toContain(readCode);
    expect(permissionMap.SM).toContain(warningReadCode);
    expect(permissionMap.SM).toContain(runReadCode);
    expect(permissionMap.SM).not.toContain(writeCode);
    expect(permissionMap.CISO).toContain(readCode);
    expect(permissionMap.CISO).toContain(warningReadCode);
    expect(permissionMap.CISO).toContain(runReadCode);
    expect(permissionMap.CISO).not.toContain(writeCode);
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

    expect(permissionMap.RI).toContain(readCode);
    expect(permissionMap.RI).not.toContain(writeCode);
    expect(permissionMap.SM).toContain(readCode);
    expect(permissionMap.SM).not.toContain(writeCode);
    expect(permissionMap.FINANCE).toContain(readCode);
    expect(permissionMap.FINANCE).not.toContain(writeCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(readCode);
    expect(permissionMap.COMPLIANCE_LEAD).toContain(writeCode);
    expect(permissionMap.TECH_ADMIN).toContain(readCode);
    expect(permissionMap.TECH_ADMIN).toContain(writeCode);
    expect(permissionMap.CISO).toContain(readCode);
    expect(permissionMap.CISO).toContain(writeCode);
  });
});
