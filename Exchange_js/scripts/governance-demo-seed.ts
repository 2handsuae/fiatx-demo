import axios from 'axios';

type SessionResponse = {
  access_token: string;
};

type ApprovalResponse = {
  id: string;
  approvalNo: string;
  status: string;
  traceId: string;
};

type ChangeTicketResponse = {
  id: string;
  ticketNo: string;
  status: string;
  latestApprovalId: string | null;
  latestApprovalNo: string | null;
  traceId: string;
};


const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const defaultPassword = process.env.ADMIN_PASSWORD || '123456';

function uniqueSuffix() {
  return `${Date.now()}`;
}

async function login(email: string) {
  const response = await axios.post<SessionResponse>(`${baseUrl}/auth/login`, {
    email,
    password: defaultPassword,
  });
  return response.data.access_token;
}

async function authed<T>(
  token: string,
  method: 'get' | 'post',
  path: string,
  data?: unknown,
) {
  const response = await axios.request<T>({
    method,
    url: `${baseUrl}${path}`,
    data,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data;
}

async function seedApprovalChain() {
  const adminToken = await login(process.env.GOV_DEMO_ADMIN_EMAIL || 'admin@fiatx.com');
  const checkerToken = await login(process.env.GOV_DEMO_APPROVAL_CHECKER_EMAIL || 'ciso@fiatx.com');
  const suffix = uniqueSuffix();

  const created = await authed<ApprovalResponse>(
    adminToken,
    'post',
    '/admin/control-gates/approvals',
    {
      actionType: 'CHANGE_TICKET_APPROVAL',
      entityRef: `DEMO-APPROVAL-${suffix}`,
      metadata: {
        demo: true,
        seed: 'wave1-stabilization',
      },
    },
  );

  await authed<ApprovalResponse>(adminToken, 'post', `/admin/control-gates/approvals/${created.id}/submit`, {
    reason: 'Governance demo approval submitted',
    traceId: created.traceId,
  });

  return authed<ApprovalResponse>(checkerToken, 'post', `/admin/control-gates/approvals/${created.id}/approve`, {
    reason: 'Governance demo approval approved',
  });
}

async function seedChangeTicketChain() {
  const makerToken = await login(process.env.GOV_DEMO_TECH_ADMIN_EMAIL || 'tech_admin@fiatx.com');
  const checkerToken = await login(process.env.GOV_DEMO_CHANGE_CHECKER_EMAIL || 'ciso@fiatx.com');
  const suffix = uniqueSuffix();

  const created = await authed<ChangeTicketResponse>(
    makerToken,
    'post',
    '/admin/control-gates/change-tickets',
    {
      changeType: 'GOVERNANCE_POLICY_CHANGE',
      scopeSummary: `Wave1 demo change ${suffix}`,
      testEvidenceRef: `TEST-EVIDENCE-${suffix}`,
      rollbackPlanRef: `ROLLBACK-${suffix}`,
      emergency: false,
    },
  );

  const submitted = await authed<ChangeTicketResponse>(
    makerToken,
    'post',
    `/admin/control-gates/change-tickets/${created.id}/submit`,
    {
      reason: 'Wave1 demo change submit',
      traceId: created.traceId,
    },
  );

  if (!submitted.latestApprovalId) {
    throw new Error(`Change ticket ${submitted.ticketNo} missing linked approval`);
  }

  await authed<ApprovalResponse>(
    checkerToken,
    'post',
    `/admin/control-gates/approvals/${submitted.latestApprovalId}/approve`,
    {
      reason: 'Wave1 demo change approved',
    },
  );

  await authed(
    makerToken,
    'post',
    `/admin/control-gates/change-tickets/${created.id}/gate-checks`,
    {
      targetEnv: 'UAT',
      releaseVersion: `demo-${suffix}`,
      reason: 'Wave1 demo gate check',
    },
  );

  await authed<ChangeTicketResponse>(
    makerToken,
    'post',
    `/admin/control-gates/change-tickets/${created.id}/deploy-status`,
    {
      targetEnv: 'UAT',
      releaseVersion: `demo-${suffix}`,
      deployStatus: 'DEPLOYED',
      reason: 'Wave1 demo deploy marked',
    },
  );

  return authed<ChangeTicketResponse>(
    makerToken,
    'post',
    `/admin/control-gates/change-tickets/${created.id}/close`,
    {
      reason: 'Wave1 demo ticket closed',
    },
  );
}


async function main() {
  const approval = await seedApprovalChain();
  const changeTicket = await seedChangeTicketChain();

  console.log(
    JSON.stringify(
      {
        approval: {
          approvalNo: approval.approvalNo,
          status: approval.status,
          traceId: approval.traceId,
        },
        changeTicket: {
          ticketNo: changeTicket.ticketNo,
          status: changeTicket.status,
          latestApprovalNo: changeTicket.latestApprovalNo,
          traceId: changeTicket.traceId,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message =
    axios.isAxiosError(error) && error.response
      ? `${error.response.status} ${JSON.stringify(error.response.data)}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error('governance demo seed failed:', message);
  process.exit(1);
});
