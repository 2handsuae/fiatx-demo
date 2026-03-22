import axios, { AxiosError } from 'axios';

type HttpMethod = 'get' | 'post' | 'patch' | 'put';

type LoginResponse = {
  access_token: string;
  user: {
    id: string;
    userNo?: string;
    email: string;
    role?: string;
    roles?: string[];
  };
};

type ListResponse<T> = {
  total: number;
  skip: number;
  take: number;
  items: T[];
};

type ApprovalDetail = {
  id: string;
  approvalNo: string;
  status: string;
  traceId?: string | null;
  evidencePackage?: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
  caseEvidencePackage?: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
};

type AuditLogItem = {
  id: string;
  action: string;
};

type EvidencePackageDetail = {
  id: string;
  packageNo: string;
  status: string;
  approvalCaseId?: string | null;
};

type CaseDetail = {
  id: string;
  caseNo: string;
  status?: string;
  assigneeUserId?: string | null;
};

type CustomerRegistration = {
  id: string;
  customerNo: string;
  email: string;
};

type DeleteRequestDetail = {
  id: string;
  requestNo: string;
  status: string;
  latestApprovalId?: string | null;
  traceId?: string | null;
};

type AdminUserResponse = {
  id: string;
  userNo: string;
  email: string;
  inviteLink: string;
};

type PeriodicReviewTriggerResponse = {
  blocked: boolean;
  created: boolean;
  cycle: {
    id: string;
    cycleNo: string;
    primaryIncidentId?: string | null;
  };
};

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const adminPassword = process.env.ADMIN_PASSWORD || '123456';
const customerPassword = process.env.CUSTOMER_PASSWORD || '123456';
const activationPassword = process.env.WAVE1_SMOKE_ACTIVATION_PASSWORD || '654321';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@fiatx.com`;
}

function formatAxiosError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 'NO_STATUS';
    const body = error.response?.data ? ` ${JSON.stringify(error.response.data)}` : '';
    return `${status}${body}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function statusOf(error: unknown): number | null {
  return axios.isAxiosError(error) ? error.response?.status ?? null : null;
}

async function authed<T>(
  token: string,
  method: HttpMethod,
  path: string,
  data?: unknown,
  params?: Record<string, unknown>,
) {
  const response = await axios.request<T>({
    method,
    url: `${baseUrl}${path}`,
    data,
    params,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data;
}

async function loginAdmin(email: string, password = adminPassword) {
  const response = await axios.post<LoginResponse>(`${baseUrl}/auth/login`, {
    email,
    password,
  });
  return response.data;
}

async function loginCustomer(email: string, password = customerPassword) {
  const response = await axios.post<LoginResponse>(`${baseUrl}/auth/customer/login`, {
    email,
    password,
  });
  return response.data;
}

async function registerCustomer(email: string, password = customerPassword) {
  const response = await axios.post<CustomerRegistration>(`${baseUrl}/auth/customer/register`, {
    email,
    password,
    customerType: 'INDIVIDUAL',
    firstName: 'Wave',
    lastName: 'Smoke',
  });
  return response.data;
}

function extractInviteToken(inviteLink: string) {
  const token = new URL(inviteLink).searchParams.get('token');
  assert(token, `Invitation link missing token: ${inviteLink}`);
  return token;
}

async function waitFor<T>(
  label: string,
  fetcher: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 45_000,
  intervalMs = 750,
) {
  const startedAt = Date.now();
  let lastValue: T | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await fetcher();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`${label} timed out after ${timeoutMs}ms with last value ${JSON.stringify(lastValue)}`);
}

async function expectFailure(
  label: string,
  runner: () => Promise<unknown>,
  allowedStatuses: number[],
) {
  try {
    await runner();
  } catch (error) {
    const status = statusOf(error);
    assert(
      status !== null && allowedStatuses.includes(status),
      `${label} expected ${allowedStatuses.join('/')} but received ${formatAxiosError(error)}`,
    );
    return status;
  }

  throw new Error(`${label} should have failed`);
}

function assertCaseOnlyResponse(name: string, payload: Record<string, any>, caseId: string) {
  assert(payload.case?.id === caseId, `${name} should expose canonical case payload`);
  assert(!('incident' in payload), `${name} must not expose incident compatibility field`);
}

async function assignCase(token: string, caseId: string, assigneeUserId: string, reason: string) {
  const current = await authed<CaseDetail>(
    token,
    'get',
    `/admin/compliance/cases/${caseId}`,
  );
  if (current.assigneeUserId === assigneeUserId) {
    return current;
  }
  if (current.assigneeUserId) {
    throw new Error(
      `Case ${caseId} is already assigned to ${current.assigneeUserId}, expected ${assigneeUserId}`,
    );
  }

  const result = await authed<CaseDetail>(
    token,
    'patch',
    `/admin/compliance/cases/${caseId}/action`,
    {
      action: 'ASSIGN',
      assigneeUserId,
      reason,
    },
  );
  assert(result.id === caseId, `Failed to assign case ${caseId}`);
  return result;
}

async function approveApproval(token: string, approvalId: string, reason: string) {
  return authed<ApprovalDetail>(
    token,
    'post',
    `/admin/control-gates/approvals/${approvalId}/approve`,
    { reason },
  );
}

async function waitForDeleteRequestReady(token: string, id: string) {
  return waitFor(
    `delete request ${id} ready`,
    () => authed<DeleteRequestDetail>(token, 'get', `/admin/control-gates/delete-requests/${id}`),
    (value) => value.status === 'READY_TO_EXECUTE',
  );
}

async function createAndExecuteDeleteRequest(
  makerToken: string,
  checkerToken: string,
  executorToken: string,
  targetType: string,
  targetNo: string,
  deleteReason: string,
) {
  const created = await authed<DeleteRequestDetail>(
    makerToken,
    'post',
    '/admin/control-gates/delete-requests',
    {
      targetType,
      targetNo,
      deleteReason,
      docRef: `W1-${Date.now()}`,
    },
  );

  const submitted = await authed<DeleteRequestDetail>(
    makerToken,
    'post',
    `/admin/control-gates/delete-requests/${created.id}/submit`,
    {
      reason: `${deleteReason} submit`,
      traceId: created.traceId,
    },
  );

  assert(submitted.latestApprovalId, `Delete request ${submitted.requestNo} missing approval`);
  await approveApproval(
    checkerToken,
    submitted.latestApprovalId,
    `${deleteReason} approval`,
  );
  await waitForDeleteRequestReady(makerToken, created.id);

  const executed = await authed<DeleteRequestDetail>(
    executorToken,
    'post',
    `/admin/control-gates/delete-requests/${created.id}/execute`,
    {
      reason: `${deleteReason} execute`,
    },
  );

  assert(executed.status === 'EXECUTED', `Delete request ${executed.requestNo} not executed`);
  return executed;
}

async function runOnboardingCaseScenario(adminToken: string, adminUserId: string) {
  const email = uniqueEmail('wave1.onboarding');
  const customer = await registerCustomer(email);
  const customerLogin = await loginCustomer(email);

  const bootstrap = await authed<any>(
    customerLogin.access_token,
    'post',
    '/onboarding/cdd-responses/bootstrap',
    {},
  );
  const sessionId = bootstrap.session?.sessionId || bootstrap.sessionId;
  assert(sessionId, 'Onboarding bootstrap did not return sessionId');

  await authed<any>(
    customerLogin.access_token,
    'post',
    `/onboarding/response-sessions/${sessionId}/mock-complete`,
    {
      mockDataType: 'HIGH_RISK_OR_PEP',
    },
  );

  const alerts = await authed<ListResponse<{ id: string; alertNo: string }>>(
    adminToken,
    'get',
    '/admin/compliance/alerts',
    undefined,
    {
      customerNo: customer.customerNo,
      take: 10,
    },
  );
  const alert = alerts.items[0];
  assert(alert?.id, `No onboarding alert found for customer ${customer.customerNo}`);

  const createdCase = await authed<CaseDetail>(
    adminToken,
    'post',
    `/admin/compliance/cases/from-alert/${alert.id}`,
    {
      reason: 'Wave1 foundation smoke onboarding escalation',
    },
  );

  await assignCase(
    adminToken,
    createdCase.id,
    adminUserId,
    'Wave1 foundation smoke onboarding case assignment',
  );

  const decisionResult = await authed<Record<string, any>>(
    adminToken,
    'post',
    `/admin/compliance/cases/${createdCase.id}/onboarding-decision`,
    {
      decision: 'CLEAR',
      reason: 'Wave1 foundation smoke onboarding case-only response',
    },
  );
  assertCaseOnlyResponse('onboarding case decision', decisionResult, createdCase.id);

  return {
    customer,
    alert,
    case: decisionResult.case as CaseDetail,
  };
}

async function runPeriodicReviewCaseScenario(adminToken: string, adminUserId: string) {
  const baseCustomerLogin = await loginCustomer('shawn@fiatx.com');

  const trigger = await authed<PeriodicReviewTriggerResponse>(
    adminToken,
    'post',
    `/admin/compliance/customers/${baseCustomerLogin.user.id}/periodic-review/trigger`,
    {
      reason: 'Wave1 foundation smoke periodic review trigger',
    },
  );

  assert(
    trigger.created || trigger.blocked || Boolean(trigger.cycle?.id),
    'Periodic review trigger should either create, block, or return an existing cycle',
  );
  const caseId = trigger.cycle?.primaryIncidentId;
  assert(caseId, 'Periodic review trigger missing primaryIncidentId');

  await assignCase(
    adminToken,
    caseId,
    adminUserId,
    'Wave1 foundation smoke periodic review case assignment',
  );

  const decisionResult = await authed<Record<string, any>>(
    adminToken,
    'post',
    `/admin/compliance/cases/${caseId}/periodic-review-decision`,
    {
      decision: 'CLEAR',
      reason: 'Wave1 foundation smoke periodic review case-only response',
    },
  );
  assertCaseOnlyResponse('periodic review case decision', decisionResult, caseId);

  return {
    cycleNo: trigger.cycle.cycleNo,
    case: decisionResult.case as CaseDetail,
  };
}

async function runAuditEvidenceExportScenario(
  adminToken: string,
  dpoToken: string,
) {
  const auditLogs = await authed<ListResponse<AuditLogItem>>(
    adminToken,
    'get',
    '/admin/audit-logs',
    undefined,
    { take: 10 },
  );
  const selectedEventIds = auditLogs.items.slice(0, 3).map((item) => item.id);
  assert(selectedEventIds.length >= 3, 'Not enough audit events for export smoke');

  const exportRequest = await authed<EvidencePackageDetail>(
    adminToken,
    'post',
    '/admin/audit-logs/export/evidence-package',
    {
      selectedEventIds,
      maxItems: selectedEventIds.length,
      includeRecords: true,
    },
  );
  assert(exportRequest.approvalCaseId, 'Audit evidence export missing approvalCaseId');

  await approveApproval(
    dpoToken,
    exportRequest.approvalCaseId,
    'Wave1 foundation smoke audit export approval',
  );

  const readyPackage = await waitFor(
    `audit evidence package ${exportRequest.id} ready`,
    () =>
      authed<EvidencePackageDetail>(
        adminToken,
        'get',
        `/admin/audit-logs/evidence-packages/${exportRequest.id}`,
      ),
    (value) => value.status === 'READY',
  );

  await authed(
    adminToken,
    'get',
    `/admin/audit-logs/evidence-packages/${readyPackage.id}/download`,
  );

  const approvalDetail = await authed<ApprovalDetail>(
    adminToken,
    'get',
    `/admin/control-gates/approvals/${exportRequest.approvalCaseId}`,
  );
  assert(
    approvalDetail.evidencePackage?.id === readyPackage.id,
    'Approval detail missing audit evidence package summary',
  );

  return readyPackage;
}

async function runCaseEvidenceExportScenario(
  adminToken: string,
  dpoToken: string,
  onboardingCaseId: string,
) {
  const exportRequest = await authed<EvidencePackageDetail>(
    adminToken,
    'post',
    '/admin/compliance/cases/export/evidence-package',
    {
      selectedCaseIds: [onboardingCaseId],
      includeRecords: true,
    },
  );
  assert(exportRequest.approvalCaseId, 'Case evidence export missing approvalCaseId');

  await approveApproval(
    dpoToken,
    exportRequest.approvalCaseId,
    'Wave1 foundation smoke case export approval',
  );

  const readyPackage = await waitFor(
    `case evidence package ${exportRequest.id} ready`,
    () =>
      authed<EvidencePackageDetail>(
        adminToken,
        'get',
        `/admin/compliance/cases/evidence-packages/${exportRequest.id}`,
      ),
    (value) => value.status === 'READY',
  );

  await authed(
    adminToken,
    'get',
    `/admin/compliance/cases/evidence-packages/${readyPackage.id}/download`,
  );

  const approvalDetail = await authed<ApprovalDetail>(
    adminToken,
    'get',
    `/admin/control-gates/approvals/${exportRequest.approvalCaseId}`,
  );
  assert(
    approvalDetail.caseEvidencePackage?.id === readyPackage.id,
    'Approval detail missing case evidence package summary',
  );

  return readyPackage;
}

async function createAdminUser(token: string, email: string) {
  return authed<AdminUserResponse>(token, 'post', '/users', {
    email,
    roleCodes: ['FINANCE'],
  });
}

async function getUserList(token: string) {
  return authed<Array<{ userNo: string; email: string }>>(token, 'get', '/users');
}

async function verifyDeletedInviteUser(
  superAdminToken: string,
  complianceLeadToken: string,
  dpoToken: string,
  techAdminToken: string,
) {
  const inviteUser = await createAdminUser(superAdminToken, uniqueEmail('wave1.invite-delete'));
  const inviteToken = extractInviteToken(inviteUser.inviteLink);

  await axios.get(`${baseUrl}/auth/admin-invitations/${inviteToken}`);

  await createAndExecuteDeleteRequest(
    complianceLeadToken,
    dpoToken,
    techAdminToken,
    'ADMIN_USER',
    inviteUser.userNo,
    'Wave1 foundation smoke delete inactive admin user',
  );

  await expectFailure(
    'deleted inactive admin invitation preview',
    () => axios.get(`${baseUrl}/auth/admin-invitations/${inviteToken}`),
    [400, 404],
  );
  await expectFailure(
    'deleted inactive admin invitation accept',
    () =>
      axios.post(`${baseUrl}/auth/admin-invitations/accept`, {
        token: inviteToken,
        password: activationPassword,
      }),
    [400, 404],
  );
  await expectFailure(
    'deleted inactive admin invitation resend',
    () =>
      authed(
        superAdminToken,
        'post',
        `/users/${inviteUser.id}/invitations/resend`,
      ),
    [400, 404],
  );

  const usersAfterDelete = await getUserList(superAdminToken);
  assert(
    !usersAfterDelete.some((user) => user.userNo === inviteUser.userNo),
    'Deleted inactive admin user should be hidden from member list',
  );

  return inviteUser.userNo;
}

async function verifyDeletedActiveUser(
  superAdminToken: string,
  complianceLeadToken: string,
  dpoToken: string,
  techAdminToken: string,
) {
  const activeUser = await createAdminUser(superAdminToken, uniqueEmail('wave1.active-delete'));
  const activationToken = extractInviteToken(activeUser.inviteLink);

  await axios.post(`${baseUrl}/auth/admin-invitations/accept`, {
    token: activationToken,
    password: activationPassword,
  });
  await loginAdmin(activeUser.email, activationPassword);

  await createAndExecuteDeleteRequest(
    complianceLeadToken,
    dpoToken,
    techAdminToken,
    'ADMIN_USER',
    activeUser.userNo,
    'Wave1 foundation smoke delete active admin user',
  );

  await expectFailure(
    'deleted active admin login',
    () =>
      axios.post(`${baseUrl}/auth/login`, {
        email: activeUser.email,
        password: activationPassword,
      }),
    [401],
  );
  await expectFailure(
    'deleted active admin role replace',
    () =>
      authed(
        superAdminToken,
        'put',
        `/admin/iam/users/${activeUser.id}/roles`,
        { roleCodes: ['FINANCE'] },
      ),
    [404],
  );

  const usersAfterDelete = await getUserList(superAdminToken);
  assert(
    !usersAfterDelete.some((user) => user.userNo === activeUser.userNo),
    'Deleted active admin user should be hidden from member list',
  );

  return activeUser.userNo;
}

async function verifyDeletedCaseEvidencePackage(
  adminToken: string,
  complianceLeadToken: string,
  dpoToken: string,
  techAdminToken: string,
  packageDetail: EvidencePackageDetail,
) {
  await createAndExecuteDeleteRequest(
    complianceLeadToken,
    dpoToken,
    techAdminToken,
    'COMPLIANCE_CASE_EVIDENCE_PACKAGE',
    packageDetail.packageNo,
    'Wave1 foundation smoke delete case evidence package',
  );

  const list = await authed<ListResponse<{ id: string; packageNo: string }>>(
    adminToken,
    'get',
    '/admin/compliance/cases/evidence-packages',
    undefined,
    { take: 50 },
  );
  assert(
    !list.items.some((item) => item.id === packageDetail.id),
    'Deleted case evidence package should be hidden from list',
  );

  await expectFailure(
    'deleted case evidence detail',
    () =>
      authed(
        adminToken,
        'get',
        `/admin/compliance/cases/evidence-packages/${packageDetail.id}`,
      ),
    [404],
  );
  await expectFailure(
    'deleted case evidence download',
    () =>
      authed(
        adminToken,
        'get',
        `/admin/compliance/cases/evidence-packages/${packageDetail.id}/download`,
      ),
    [404],
  );
}

async function main() {
  const superAdmin = await loginAdmin('admin@fiatx.com');
  const dpo = await loginAdmin('dpo@fiatx.com');
  const complianceLead = await loginAdmin('compliance_lead@fiatx.com');
  const techAdmin = await loginAdmin('tech_admin@fiatx.com');

  console.log('[wave1-smoke] onboarding case scenario');
  const onboarding = await runOnboardingCaseScenario(
    superAdmin.access_token,
    superAdmin.user.id,
  );
  console.log('[wave1-smoke] periodic review case scenario');
  const periodicReview = await runPeriodicReviewCaseScenario(
    superAdmin.access_token,
    superAdmin.user.id,
  );
  console.log('[wave1-smoke] audit evidence export scenario');
  const auditPackage = await runAuditEvidenceExportScenario(
    superAdmin.access_token,
    dpo.access_token,
  );
  console.log('[wave1-smoke] case evidence export scenario');
  const casePackage = await runCaseEvidenceExportScenario(
    superAdmin.access_token,
    dpo.access_token,
    onboarding.case.id,
  );

  console.log('[wave1-smoke] delete case evidence package scenario');
  await verifyDeletedCaseEvidencePackage(
    superAdmin.access_token,
    complianceLead.access_token,
    dpo.access_token,
    techAdmin.access_token,
    casePackage,
  );
  console.log('[wave1-smoke] delete inactive admin user scenario');
  const deletedInviteUserNo = await verifyDeletedInviteUser(
    superAdmin.access_token,
    complianceLead.access_token,
    dpo.access_token,
    techAdmin.access_token,
  );
  console.log('[wave1-smoke] delete active admin user scenario');
  const deletedActiveUserNo = await verifyDeletedActiveUser(
    superAdmin.access_token,
    complianceLead.access_token,
    dpo.access_token,
    techAdmin.access_token,
  );

  console.log('Wave1 foundation smoke completed successfully.');
  console.log(
    JSON.stringify(
      {
        onboarding: {
          customerNo: onboarding.customer.customerNo,
          alertNo: onboarding.alert.alertNo,
          caseNo: onboarding.case.caseNo,
        },
        periodicReview: {
          cycleNo: periodicReview.cycleNo,
          caseNo: periodicReview.case.caseNo,
        },
        auditEvidencePackage: {
          packageNo: auditPackage.packageNo,
          status: auditPackage.status,
        },
        deletedCaseEvidencePackage: casePackage.packageNo,
        deletedAdminUsers: [deletedInviteUserNo, deletedActiveUserNo],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message =
    error instanceof AxiosError || axios.isAxiosError(error)
      ? formatAxiosError(error)
      : error instanceof Error
        ? error.message
        : String(error);
  console.error('Wave1 foundation smoke failed:', message);
  process.exit(1);
});
