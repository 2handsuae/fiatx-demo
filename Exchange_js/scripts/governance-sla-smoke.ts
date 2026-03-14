import axios from 'axios';

type SessionResponse = {
  access_token: string;
};

type SlaTimerResponse = {
  id: string;
  timerNo: string;
  timerType: string;
  status: string;
  workflowNo: string;
  subjectNo: string;
  graceSeconds: number;
  traceId: string;
  notificationSummary?: {
    total: number;
    triggeredCount: number;
    skippedCount: number;
    latestStatus: string | null;
  };
};

type AuditListResponse = {
  items: Array<{
    action: string;
    entityNo: string | null;
    workflowNo: string | null;
  }>;
};

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3500';
const email = process.env.ADMIN_EMAIL || 'admin@fiatx.com';
const password = process.env.ADMIN_PASSWORD || '123456';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function login() {
  const response = await axios.post<SessionResponse>(`${baseUrl}/auth/login`, {
    email,
    password,
  });

  return response.data.access_token;
}

async function authed<T>(
  token: string,
  method: 'get' | 'post',
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

async function fetchAuditActions(token: string, workflowNo: string) {
  const data = await authed<AuditListResponse>(
    token,
    'get',
    '/admin/audit-logs',
    undefined,
    {
      workflowNo,
      take: 100,
    },
  );

  return data.items.map((item) => item.action);
}

async function runApprovalTimeoutScenario(token: string) {
  const created = await authed<SlaTimerResponse>(
    token,
    'post',
    '/admin/demo/control-gates/sla-timers/approval-timeout',
    {
      dueInSeconds: 15,
      graceSeconds: 0,
      reason: 'Smoke approval-timeout scenario',
    },
  );

  assert(created.timerType === 'APPROVAL_TIMEOUT', 'Expected approval timeout timer');
  assert(created.status === 'ACTIVE', 'Expected active approval timeout timer');

  const listed = await authed<{ items: SlaTimerResponse[] }>(
    token,
    'get',
    '/admin/control-gates/sla-timers',
    undefined,
    { timerNo: created.timerNo, take: 10 },
  );
  assert(listed.items.some((item) => item.timerNo === created.timerNo), 'Timer missing in list');

  const recalculated = await authed<SlaTimerResponse>(
    token,
    'post',
    `/admin/control-gates/sla-timers/${created.id}/recalc`,
    {
      dueInSeconds: 5,
      graceSeconds: 0,
      reason: 'Smoke approval-timeout recalc',
    },
  );
  assert(recalculated.status === 'ACTIVE', 'Recalc should keep timer active');

  const expired = await authed<SlaTimerResponse>(
    token,
    'post',
    `/admin/demo/control-gates/sla-timers/${created.id}/expire`,
  );
  assert(expired.status === 'EXPIRED', 'Mock expire should end in EXPIRED');
  assert(
    (expired.notificationSummary?.total || 0) >= 1,
    'Expired timer should have notification records',
  );

  const auditActions = await fetchAuditActions(token, expired.workflowNo);
  assert(
    auditActions.includes('SLA_TIMER_RECALCULATED'),
    'Expected SLA_TIMER_RECALCULATED audit action',
  );
  assert(
    auditActions.includes('SLA_TIMER_EXPIRED'),
    'Expected SLA_TIMER_EXPIRED audit action',
  );

  return expired;
}

async function runChangeFollowUpScenario(token: string) {
  const created = await authed<SlaTimerResponse>(
    token,
    'post',
    '/admin/demo/control-gates/sla-timers/change-follow-up',
    {
      dueInSeconds: 20,
      graceSeconds: 5,
      reason: 'Smoke change follow-up scenario',
    },
  );

  assert(
    created.timerType === 'CHANGE_POST_APPROVAL_FOLLOWUP',
    'Expected change follow-up timer',
  );
  assert(created.status === 'ACTIVE', 'Expected active change follow-up timer');

  const recalculated = await authed<SlaTimerResponse>(
    token,
    'post',
    `/admin/control-gates/sla-timers/${created.id}/recalc`,
    {
      dueInSeconds: 25,
      graceSeconds: 10,
      reason: 'Smoke follow-up recalc',
    },
  );
  assert(recalculated.status === 'ACTIVE', 'Follow-up recalc should keep timer active');

  const closed = await authed<SlaTimerResponse>(
    token,
    'post',
    `/admin/control-gates/sla-timers/${created.id}/close`,
    {
      reason: 'Smoke follow-up close',
    },
  );
  assert(closed.status === 'CLOSED', 'Follow-up close should end in CLOSED');
  assert(
    (closed.notificationSummary?.skippedCount || 0) >= 1,
    'Closed follow-up should skip pending notifications',
  );

  const auditActions = await fetchAuditActions(token, closed.workflowNo);
  assert(
    auditActions.includes('SLA_TIMER_RECALCULATED'),
    'Expected recalc audit for follow-up timer',
  );
  assert(
    auditActions.includes('SLA_TIMER_CLOSED'),
    'Expected close audit for follow-up timer',
  );

  return closed;
}

async function main() {
  const token = await login();

  const approvalTimeout = await runApprovalTimeoutScenario(token);
  const changeFollowUp = await runChangeFollowUpScenario(token);

  console.log('SLA smoke completed successfully.');
  console.log(
    JSON.stringify(
      {
        approvalTimeout: {
          timerNo: approvalTimeout.timerNo,
          workflowNo: approvalTimeout.workflowNo,
          status: approvalTimeout.status,
        },
        changeFollowUp: {
          timerNo: changeFollowUp.timerNo,
          workflowNo: changeFollowUp.workflowNo,
          status: changeFollowUp.status,
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
  console.error('SLA smoke failed:', message);
  process.exit(1);
});
