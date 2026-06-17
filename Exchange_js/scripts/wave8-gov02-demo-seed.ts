import axios, { AxiosError } from 'axios';
import { PrismaClient } from '@prisma/client';
import { buildFiatPoolWalletNo } from '../src/modules/asset-treasury/wallets/system-wallet.util';
import {
  WAVE8_GOV02_DEMO_API_PATHS,
  buildWave8Gov02DemoMetadata,
  buildWave8Gov02DemoTraceId,
  cleanupWave8Gov02DemoData,
} from '../src/modules/governance/regulatory-gates/demo/wave8-gov02-demo.util';

type SessionResponse = {
  access_token: string;
};

type ShareholdingVersionResponse = {
  id: string;
  registryNo: string;
  status: string;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
    filingStatus: string;
    receiptStatus: string;
    effectivenessStatus: string;
  } | null;
};

type AppointmentResponse = {
  id: string;
  appointmentNo: string;
  status: string;
  effectiveAt: string | null;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
    filingStatus: string;
    receiptStatus: string;
    effectivenessStatus: string;
  } | null;
};

type RegulatoryGateResponse = {
  id: string;
  gateNo: string;
  gateType: string;
  gateResult: string;
  filingStatus: string;
  receiptStatus: string;
  effectivenessStatus: string;
};

type WalletResponse = {
  id: string;
  walletNo: string | null;
  walletRole: string;
  regulatoryEnablementStatus?: string | null;
  regulatoryEnabledAt?: string | null;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
    filingStatus: string;
    receiptStatus: string;
    effectivenessStatus: string;
  } | null;
};

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const defaultPassword = process.env.ADMIN_PASSWORD || '123456';
const defaultAdminEmail = process.env.GOV02_DEMO_ADMIN_EMAIL || 'admin@fiatx.com';

const CONTROL_TRACE_ID = buildWave8Gov02DemoTraceId('CONTROL_CHANGE');
const APPOINTMENT_TRACE_ID = buildWave8Gov02DemoTraceId('REGULATED_APPOINTMENT_CHANGE');
const CLIENT_BANK_TRACE_ID = buildWave8Gov02DemoTraceId('CLIENT_BANK_ACCOUNT_ENABLEMENT');
const EFFECTIVE_AT = '2026-04-05T09:00:00.000Z';
const AED_CUST_BANK_WALLET_NO = buildFiatPoolWalletNo('CUST_BANK', 'AED');

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

async function seedControlChangeBlocked(token: string) {
  const shareholding = await authed<ShareholdingVersionResponse>(
    token,
    'post',
    '/admin/governance/registries/shareholding-versions',
    {
      versionLabel: 'Wave8 GOV02 Demo - Control Change',
      traceId: CONTROL_TRACE_ID,
      metadataJson: buildWave8Gov02DemoMetadata('control-change-blocked'),
      participants: [
        {
          participantType: 'SHAREHOLDER',
          participantName: 'Founders SPV',
          ownershipPercent: '100',
        },
      ],
    },
  );

  const gate = await authed<RegulatoryGateResponse>(
    token,
    'post',
    '/admin/governance/regulatory-gates',
    {
      gateType: 'CONTROL_CHANGE',
      shareholdingRegistryVersionId: shareholding.id,
      scopeSummary: 'Wave 8 GOV-02 demo control change gate',
      traceId: CONTROL_TRACE_ID,
      metadataJson: buildWave8Gov02DemoMetadata('control-change-blocked'),
    },
  );

  const detail = await authed<ShareholdingVersionResponse>(
    token,
    'get',
    `/admin/governance/registries/shareholding-versions/${shareholding.id}`,
  );

  if (detail.status !== 'DRAFT') {
    throw new Error(`Expected shareholding registry to remain DRAFT, got ${detail.status}`);
  }
  if (detail.regulatoryGateSummary?.gateId !== gate.id) {
    throw new Error('Expected shareholding registry detail to expose linked regulatory gate');
  }
  if (gate.gateResult !== 'BLOCKED') {
    throw new Error(`Expected control gate to be BLOCKED, got ${gate.gateResult}`);
  }

  return {
    shareholding,
    gate,
  };
}

async function seedRegulatedAppointmentEffective(token: string) {
  const appointment = await authed<AppointmentResponse>(
    token,
    'post',
    '/admin/governance/registries/appointments',
    {
      roleType: 'MLRO',
      personName: 'Wave8 Demo Gate Officer',
      regulatedFlag: true,
      status: 'PLANNED',
      proposedEffectiveAt: EFFECTIVE_AT,
      traceId: APPOINTMENT_TRACE_ID,
      metadataJson: buildWave8Gov02DemoMetadata('regulated-appointment-effective'),
    },
  );

  const createdGate = await authed<RegulatoryGateResponse>(
    token,
    'post',
    '/admin/governance/regulatory-gates',
    {
      gateType: 'REGULATED_APPOINTMENT_CHANGE',
      appointmentRecordId: appointment.id,
      scopeSummary: 'Wave 8 GOV-02 demo regulated appointment gate',
      proposedEffectiveAt: EFFECTIVE_AT,
      traceId: APPOINTMENT_TRACE_ID,
      metadataJson: buildWave8Gov02DemoMetadata('regulated-appointment-effective'),
    },
  );

  await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/submit`,
    {
      filingRefNo: 'W8-GOV02-DEMO-FILING-001',
      traceId: APPOINTMENT_TRACE_ID,
    },
  );

  await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/record-feedback`,
    {
      filingStatus: 'ACCEPTED',
      latestFeedback: 'Wave 8 GOV-02 demo accepted',
      traceId: APPOINTMENT_TRACE_ID,
    },
  );

  await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/bind-receipt`,
    {
      receiptType: 'VARA_APPROVAL',
      receiptRefNo: 'W8-GOV02-DEMO-RECEIPT-001',
      traceId: APPOINTMENT_TRACE_ID,
    },
  );

  const effectiveGate = await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/mark-effective`,
    {
      effectiveAt: EFFECTIVE_AT,
      traceId: APPOINTMENT_TRACE_ID,
    },
  );

  const detail = await authed<AppointmentResponse>(
    token,
    'get',
    `/admin/governance/registries/appointments/${appointment.id}`,
  );

  if (effectiveGate.gateResult !== 'EFFECTIVE') {
    throw new Error(`Expected appointment gate to be EFFECTIVE, got ${effectiveGate.gateResult}`);
  }
  if (detail.status !== 'ACTIVE') {
    throw new Error(`Expected appointment record to be ACTIVE, got ${detail.status}`);
  }
  if (detail.regulatoryGateSummary?.gateId !== effectiveGate.id) {
    throw new Error('Expected appointment detail to expose linked regulatory gate');
  }

  return {
    appointment: detail,
    gate: effectiveGate,
  };
}

async function seedClientBankAccountEnablementEffective(token: string) {
  const wallet = await prisma.wallet.findFirst({
    where: {
      walletNo: AED_CUST_BANK_WALLET_NO,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      walletNo: true,
      walletRole: true,
      regulatoryEnablementStatus: true,
      regulatoryEnabledAt: true,
    },
  });

  if (!wallet) {
    throw new Error(`Missing demo CUST_BANK wallet ${AED_CUST_BANK_WALLET_NO}`);
  }

  const createdGate = await authed<RegulatoryGateResponse>(
    token,
    'post',
    '/admin/governance/regulatory-gates',
    {
      gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
      walletId: wallet.id,
      scopeSummary: 'Wave 8 GOV-02 demo client bank enablement gate',
      proposedEffectiveAt: EFFECTIVE_AT,
      traceId: CLIENT_BANK_TRACE_ID,
      metadataJson: buildWave8Gov02DemoMetadata('client-bank-account-effective'),
    },
  );

  await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/submit`,
    {
      filingRefNo: 'W8-GOV02-DEMO-FILING-002',
      traceId: CLIENT_BANK_TRACE_ID,
    },
  );
  await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/record-feedback`,
    {
      filingStatus: 'ACCEPTED',
      latestFeedback: 'Wave 8 GOV-02 demo bank enablement accepted',
      traceId: CLIENT_BANK_TRACE_ID,
    },
  );
  await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/bind-receipt`,
    {
      receiptType: 'VARA_APPROVAL',
      receiptRefNo: 'W8-GOV02-DEMO-RECEIPT-002',
      traceId: CLIENT_BANK_TRACE_ID,
    },
  );
  const effectiveGate = await authed<RegulatoryGateResponse>(
    token,
    'post',
    `/admin/governance/regulatory-gates/${createdGate.id}/mark-effective`,
    {
      effectiveAt: EFFECTIVE_AT,
      traceId: CLIENT_BANK_TRACE_ID,
    },
  );

  const detail = await authed<WalletResponse>(token, 'get', `/wallets/${wallet.id}`);
  if (detail.regulatoryGateSummary?.gateId !== effectiveGate.id) {
    throw new Error('Expected wallet detail to expose linked regulatory gate');
  }
  if (detail.regulatoryEnablementStatus !== 'EFFECTIVE') {
    throw new Error(
      `Expected wallet regulatory enablement to be EFFECTIVE, got ${detail.regulatoryEnablementStatus}`,
    );
  }
  if (effectiveGate.gateResult !== 'EFFECTIVE') {
    throw new Error(`Expected client-bank gate to be EFFECTIVE, got ${effectiveGate.gateResult}`);
  }

  return {
    wallet: detail,
    gate: effectiveGate,
  };
}

function printSummary(input: {
  cleanup: Awaited<ReturnType<typeof cleanupWave8Gov02DemoData>>;
  control: {
    shareholding: ShareholdingVersionResponse;
    gate: RegulatoryGateResponse;
  };
  appointment: {
    appointment: AppointmentResponse;
    gate: RegulatoryGateResponse;
  };
  clientBank: {
    wallet: WalletResponse;
    gate: RegulatoryGateResponse;
  };
}) {
  console.log('✅ Wave 8 GOV-02 demo data ready.');
  console.log('');
  console.log('Cleanup counts:');
  for (const [key, value] of Object.entries(input.cleanup)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
  console.log('Created demo records:');
  console.log(`  Shareholding registry: ${input.control.shareholding.registryNo}`);
  console.log(`  Control gate:          ${input.control.gate.gateNo}`);
  console.log(`  Appointment:           ${input.appointment.appointment.appointmentNo}`);
  console.log(`  Appointment gate:      ${input.appointment.gate.gateNo}`);
  console.log(`  CUST_BANK wallet:      ${input.clientBank.wallet.walletNo}`);
  console.log(`  Bank gate:             ${input.clientBank.gate.gateNo}`);
  console.log('');
  console.log('Suggested API paths:');
  for (const item of WAVE8_GOV02_DEMO_API_PATHS) {
    console.log(`  ${item}`);
  }
  console.log('');
  console.log('Notes:');
  console.log('  当前有 Governance Center 页面；Business Config / Wallet 详情也可深链演示 gate。');
  console.log(
    `  Audit log 可按 traceId 前缀 ${buildWave8Gov02DemoTraceId('')} 检索。`,
  );
}

async function main() {
  try {
    console.log('--- Seeding Wave 8 GOV-02 demo data ---');
    const cleanup = await cleanupWave8Gov02DemoData(prisma as any);
    const token = await login(defaultAdminEmail);

    const control = await seedControlChangeBlocked(token);
    const appointment = await seedRegulatedAppointmentEffective(token);
    const clientBank = await seedClientBankAccountEnablementEffective(token);

    printSummary({
      cleanup,
      control,
      appointment,
      clientBank,
    });
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string | string[] }>;
    if (axiosError.isAxiosError) {
      const remoteMessage = axiosError.response?.data?.message;
      const message = Array.isArray(remoteMessage)
        ? remoteMessage.join('; ')
        : remoteMessage || axiosError.message;
      console.error('Wave 8 GOV-02 demo seed failed:', message);
      if (!axiosError.response) {
        console.error(`Hint: start the local stack first with "npm run dev:start" (${baseUrl}).`);
      }
    } else {
      console.error('Wave 8 GOV-02 demo seed failed:', error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
