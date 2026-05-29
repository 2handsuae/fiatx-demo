// admin-web/src/pages/SumsubEventsPage.tsx
import { useEffect, useState } from 'react';
import { RefreshCw, Search, X, Play } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

// ── Types ──────────────────────────────────────────────────────────────────

type EventStatus = 'PENDING' | 'PROCESSED' | 'FAILED' | 'DEAD';

interface SumsubEventItem {
  id: string;
  eventNo: string;
  eventType: string;
  applicantId: string;
  externalUserId: string;
  context: string;
  status: EventStatus;
  retryCount: number;
  isSimulated: boolean;
  receivedAt: string;
  processedAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

interface ListResponse {
  total: number;
  skip: number;
  take: number;
  items: SumsubEventItem[];
}

interface FilterState {
  status: string;
  eventType: string;
  externalUserId: string;
}

/* ── Simulation tabs & scenarios ────────────────────────────────── */

type SimTab = 'onboarding' | 'material' | 'craSimulation' | 'ongoingMonitoring' | 'level2Simulation' | 'kyt' | 'travelRule';

type OnboardingScenario =
  | 'LOW_RISK_PASS'
  | 'MANUAL_REVIEW'
  | 'RESUBMIT_REQUIRED'
  | 'EDD_ESCALATE'
  | 'EDD_PASS'
  | 'WORKFLOW_FAIL';

type MaterialScenario = 'GREEN' | 'RED';

const ONBOARDING_SCENARIOS: { value: OnboardingScenario; label: string; hint: string }[] = [
  {
    value: 'LOW_RISK_PASS',
    label: 'Low risk — auto approve',
    hint: 'applicantWorkflowCompleted (no level2) → APPROVED',
  },
  {
    value: 'MANUAL_REVIEW',
    label: 'Manual review required',
    hint: 'applicantOnHold → substatus UNDER_REVIEW',
  },
  {
    value: 'RESUBMIT_REQUIRED',
    label: 'Resubmission required',
    hint: 'applicantReviewed RED+RETRY → substatus RESUBMIT_REQUIRED',
  },
  {
    value: 'EDD_ESCALATE',
    label: 'Escalate to EDD',
    hint: 'applicantLevelChanged level2 → sets sumsubExperiencedLevel2=true',
  },
  {
    value: 'EDD_PASS',
    label: 'EDD passed — needs Final Approval',
    hint: 'applicantWorkflowCompleted (with level2) → FINAL_APPROVAL (run EDD_ESCALATE first)',
  },
  {
    value: 'WORKFLOW_FAIL',
    label: 'Workflow failed — rejected',
    hint: 'applicantWorkflowFailed → REJECTED',
  },
];

const MATERIAL_SCENARIOS: { value: MaterialScenario; label: string; hint: string }[] = [
  {
    value: 'GREEN',
    label: 'Customer submitted — accepted',
    hint: 'applicantActionReviewed GREEN → cycle CLEARED, holding renewed',
  },
  {
    value: 'RED',
    label: 'Customer submitted — rejected',
    hint: 'applicantActionReviewed RED → cycle stays PENDING for retry',
  },
];


const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  eventType: '',
  externalUserId: '',
};

const STATUS_BADGE_MAP: Record<EventStatus, string> = {
  PROCESSED: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'REJECTED',
  DEAD: 'FAILED',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function SumsubEventsPage() {
  const [items, setItems] = useState<SumsubEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Simulation modal state
  const [showSimulate, setShowSimulate] = useState(false);
  const [simTab, setSimTab] = useState<SimTab>('onboarding');
  const [simCustomerNo, setSimCustomerNo] = useState('');
  const [simCycleNo, setSimCycleNo] = useState('');
  const [simOnboardingScenario, setSimOnboardingScenario] = useState<OnboardingScenario>('LOW_RISK_PASS');
  const [simMaterialScenario, setSimMaterialScenario] = useState<MaterialScenario>('GREEN');
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // CRA simulation tab
  const [craNo, setCraNo] = useState('');
  const [craReviewAnswer, setCraReviewAnswer] = useState('GREEN');

  // Ongoing monitoring tab
  const [omCustomerNo, setOmCustomerNo] = useState('');
  const [omHitType, setOmHitType] = useState('PEP_TIER_1');

  // Level 2 simulation tab
  const [l2CustomerNo, setL2CustomerNo] = useState('');

  // KYT / Travel Rule simulation — shared depositNo
  const [simDepositNo, setSimDepositNo] = useState('');

  // Withdraw KYT / Travel Rule simulation
  const [simTxnType, setSimTxnType] = useState<'deposit' | 'withdraw'>('deposit');
  const [simWithdrawNo, setSimWithdrawNo] = useState('');
  const [simKytStage, setSimKytStage] = useState<'PRE' | 'POST'>('PRE');

  // Shared result display
  const [simResult, setSimResult] = useState('');

  const fetchEvents = async (page: number, f: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.status) params.set('status', f.status);
      if (f.eventType) params.set('eventType', f.eventType);
      if (f.externalUserId) params.set('externalUserId', f.externalUserId);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub-events?${params}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load events.'));
      }
      const res: ListResponse = await response.json();
      setItems(res.items);
      setTotal(res.total);
      setCurrentPage(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvents(1, filters);
  }, []);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchEvents(1, DEFAULT_FILTERS);
  };

  const handleReplay = async (id: string) => {
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub-events/${id}/replay`,
        { method: 'POST' },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Replay failed.'));
      }
      setMessage('Event replayed successfully.');
      void fetchEvents(currentPage, filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed.');
    }
  };

  const handleSimulate = async () => {
    setSimLoading(true);
    setSimError(null);
    try {
      if (simTab === 'onboarding') {
        if (!simCustomerNo.trim()) { setSimError('Customer No is required'); setSimLoading(false); return; }
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/sumsub-events/simulate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerNo: simCustomerNo, scenario: simOnboardingScenario }),
          },
        );
        if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Simulation failed.'));
        const res = await response.json();
        setShowSimulate(false);
        setSimCustomerNo('');
        setMessage(`Simulated: ${res.event?.eventNo ?? 'OK'} (${res.event?.status ?? simOnboardingScenario})`);
      } else if (simTab === 'material') {
        if (!simCycleNo.trim()) { setSimError('Cycle No is required'); setSimLoading(false); return; }
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/applicant-action-result`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cycleNo: simCycleNo, reviewAnswer: simMaterialScenario }),
          },
        );
        if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Simulation failed.'));
        setShowSimulate(false);
        setSimCycleNo('');
        setMessage(`Material simulation: ${simMaterialScenario} for cycle ${simCycleNo}`);
      } else if (simTab === 'kyt') {
        if (simTxnType === 'deposit') {
          if (!simDepositNo.trim()) { setSimError('Deposit No is required'); setSimLoading(false); return; }
          const response = await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/kyt-check`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depositNo: simDepositNo, result: 'PASS' }),
            },
          );
          if (!response.ok) throw new Error(await getApiErrorMessage(response, 'KYT simulation failed.'));
          const res = await response.json();
          setShowSimulate(false);
          setMessage(`KYT check simulated: PASSED for ${res.depositNo ?? simDepositNo}`);
        } else {
          if (!simWithdrawNo.trim()) { setSimError('Withdraw No is required'); setSimLoading(false); return; }
          const response = await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/withdraw-kyt`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ withdrawNo: simWithdrawNo, stage: simKytStage, result: 'PASS' }),
            },
          );
          if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Withdraw KYT simulation failed.'));
          const res = await response.json();
          setShowSimulate(false);
          setMessage(`Withdraw ${simKytStage} KYT simulated: PASSED for ${res.withdrawNo ?? simWithdrawNo}`);
        }
      } else if (simTab === 'travelRule') {
        if (simTxnType === 'deposit') {
          if (!simDepositNo.trim()) { setSimError('Deposit No is required'); setSimLoading(false); return; }
          const response = await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/tr-check`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depositNo: simDepositNo, result: 'PASS' }),
            },
          );
          if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Travel Rule simulation failed.'));
          const res = await response.json();
          setShowSimulate(false);
          setMessage(`Travel Rule check simulated: PASSED for ${res.depositNo ?? simDepositNo}`);
        } else {
          if (!simWithdrawNo.trim()) { setSimError('Withdraw No is required'); setSimLoading(false); return; }
          const response = await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/withdraw-tr`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ withdrawNo: simWithdrawNo, result: 'PASS' }),
            },
          );
          if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Withdraw TR simulation failed.'));
          const res = await response.json();
          setShowSimulate(false);
          setMessage(`Withdraw Travel Rule simulated: PASSED for ${res.withdrawNo ?? simWithdrawNo}`);
        }
      }
      void fetchEvents(1, filters);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Simulation failed.');
    } finally {
      setSimLoading(false);
    }
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Title bar */}
      <PageTitleBar
        title="Sumsub Events"
        meta={`${total} events · Unified webhook log`}
      >
        <button
          onClick={() => setShowSimulate(true)}
          className={adminButtonClass('listPrimary')}
        >
          <Play size={13} />
          Simulate Event
        </button>
        <button
          onClick={() => void fetchEvents(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED</option>
          <option value="DEAD">DEAD</option>
        </select>
        <select
          value={filters.eventType}
          onChange={(e) => setFilters((p) => ({ ...p, eventType: e.target.value }))}
          className={`${fi} w-52`}
        >
          <option value="">All Event Types</option>
          <option value="applicantPending">applicantPending</option>
          <option value="applicantOnHold">applicantOnHold</option>
          <option value="applicantReviewed">applicantReviewed</option>
          <option value="applicantLevelChanged">applicantLevelChanged</option>
          <option value="applicantWorkflowCompleted">applicantWorkflowCompleted</option>
          <option value="applicantWorkflowFailed">applicantWorkflowFailed</option>
        </select>
        <input
          value={filters.externalUserId}
          onChange={(e) => setFilters((p) => ({ ...p, externalUserId: e.target.value }))}
          placeholder="Customer No / ID"
          className={`${fi} w-40`}
        />
        <button
          onClick={() => void fetchEvents(1, filters)}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button onClick={handleReset} className={adminButtonClass('listSecondary')}>
          Reset
        </button>
      </div>

      {/* Banners */}
      {message && (
        <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green flex items-center justify-between">
          {message}
          <button onClick={() => setMessage(null)} className="ml-3 text-adm-t3 hover:text-adm-t1">
            <X size={12} />
          </button>
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(['Event No', 'Received', 'Type', 'Customer', 'Context', 'Status', 'Retries', ''] as string[]).map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-adm-border bg-adm-panel px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No events found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-adm-border transition-colors hover:bg-adm-hover"
                >
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.eventNo}
                    </span>
                    {item.isSimulated && (
                      <span className="ml-2 rounded border border-adm-blue/25 bg-adm-blue/8 px-1 font-mono text-[9px] text-adm-blue">
                        SIM
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                    {new Date(item.receivedAt).toLocaleDateString()}
                    <br />
                    {new Date(item.receivedAt).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                    {item.eventType}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                    {item.externalUserId}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t3">
                    {item.context}
                  </td>
                  <td className="px-3 py-2.5">
                    <AdminBadge value={STATUS_BADGE_MAP[item.status] ?? item.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t3">
                    {item.retryCount}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.status === 'DEAD' && (
                      <button
                        onClick={() => void handleReplay(item.id)}
                        className={adminButtonClass('repair')}
                      >
                        Replay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchEvents(page, filters)}
        />
      </div>

      {/* Simulation Modal */}
      {showSimulate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-3">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
                Simulate Sumsub Event
              </span>
              <button
                onClick={() => { setShowSimulate(false); setSimError(null); }}
                className="text-adm-t3 hover:text-adm-t1"
              >
                <X size={14} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-adm-border bg-adm-card">
              {([
                { key: 'onboarding' as SimTab, label: 'Onboarding' },
                { key: 'material' as SimTab, label: 'Material Refresh' },
                { key: 'craSimulation' as SimTab, label: 'CRA Result' },
                { key: 'ongoingMonitoring' as SimTab, label: 'Ongoing Monitoring' },
                { key: 'level2Simulation' as SimTab, label: 'Level 2 Complete' },
                { key: 'kyt' as SimTab, label: 'KYT Check' },
                { key: 'travelRule' as SimTab, label: 'Travel Rule' },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setSimTab(tab.key); setSimError(null); setSimResult(''); setSimTxnType('deposit'); setSimWithdrawNo(''); setSimKytStage('PRE'); }}
                  className={`flex-1 py-2.5 font-mono text-[11px] font-medium transition-colors ${
                    simTab === tab.key
                      ? 'border-b-2 border-adm-amber text-adm-amber'
                      : 'text-adm-t3 hover:text-adm-t2'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Modal body */}
            <div className="space-y-4 p-5">
              {/* Identifier input — changes per tab */}
              {simTab === 'onboarding' && (
                <div>
                  <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                    Customer No
                  </label>
                  <input
                    value={simCustomerNo}
                    onChange={(e) => setSimCustomerNo(e.target.value)}
                    placeholder="e.g. CU2604108406"
                    className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                  />
                </div>
              )}
              {simTab === 'material' && (
                <div>
                  <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                    Cycle No
                  </label>
                  <input
                    value={simCycleNo}
                    onChange={(e) => setSimCycleNo(e.target.value)}
                    placeholder="e.g. MRC-2026-00001"
                    className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                  />
                </div>
              )}

              {/* Scenario selector — onboarding / material */}
              {(simTab === 'onboarding' || simTab === 'material') && (
                <div>
                  <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                    Scenario
                  </label>
                  <div className="space-y-1.5">
                    {simTab === 'onboarding' &&
                      ONBOARDING_SCENARIOS.map((s) => (
                        <label
                          key={s.value}
                          className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2 transition-colors ${
                            simOnboardingScenario === s.value
                              ? 'border-adm-amber bg-adm-amber/6'
                              : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
                          }`}
                        >
                          <input
                            type="radio"
                            name="scenario"
                            value={s.value}
                            checked={simOnboardingScenario === s.value}
                            onChange={() => setSimOnboardingScenario(s.value)}
                            className="mt-0.5 shrink-0"
                          />
                          <div>
                            <div className="font-mono text-[11px] text-adm-t1">{s.label}</div>
                            <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{s.hint}</div>
                          </div>
                        </label>
                      ))}
                    {simTab === 'material' &&
                      MATERIAL_SCENARIOS.map((s) => (
                        <label
                          key={s.value}
                          className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2 transition-colors ${
                            simMaterialScenario === s.value
                              ? 'border-adm-amber bg-adm-amber/6'
                              : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
                          }`}
                        >
                          <input
                            type="radio"
                            name="scenario"
                            value={s.value}
                            checked={simMaterialScenario === s.value}
                            onChange={() => setSimMaterialScenario(s.value)}
                            className="mt-0.5 shrink-0"
                          />
                          <div>
                            <div className="font-mono text-[11px] text-adm-t1">{s.label}</div>
                            <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{s.hint}</div>
                          </div>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {/* CRA Simulation tab */}
              {simTab === 'craSimulation' && (
                <div className="space-y-4">
                  <p className="font-mono text-[10px] text-adm-t3">
                    Simulate Sumsub AML result for an existing <strong>PENDING_SUMSUB_RESULT</strong> assessment.
                    Use after admin triggers a CRA via the Risk Assessments page.
                  </p>
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer No</label>
                    <input
                      value={craNo}
                      onChange={e => setCraNo(e.target.value)}
                      placeholder="CU2604133584"
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Review Answer</label>
                    <select
                      value={craReviewAnswer}
                      onChange={e => setCraReviewAnswer(e.target.value)}
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber"
                    >
                      <option value="GREEN">GREEN — no new risk</option>
                      <option value="RED_PEP">RED + PEP_TIER_1</option>
                      <option value="RED_ADVERSE">RED + ADVERSE_MEDIA</option>
                      <option value="RED_SANCTIONS">RED + SANCTIONS_LIST</option>
                    </select>
                  </div>
                  <button
                    disabled={!craNo || simLoading}
                    onClick={async () => {
                      setSimLoading(true);
                      setSimError(null);
                      try {
                        const labelMap: Record<string, string[]> = {
                          GREEN: [],
                          RED_PEP: ['PEP_TIER_1'],
                          RED_ADVERSE: ['ADVERSE_MEDIA'],
                          RED_SANCTIONS: ['SANCTIONS_LIST'],
                        };
                        const answer = craReviewAnswer === 'GREEN' ? 'GREEN' : 'RED';
                        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/aml-check-result`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            customerNo: craNo,
                            reviewAnswer: answer,
                            rejectLabels: labelMap[craReviewAnswer] ?? [],
                          }),
                        });
                        setSimResult(JSON.stringify(await res.json(), null, 2));
                      } catch (e) {
                        setSimError(e instanceof Error ? e.message : 'Simulation failed.');
                      } finally {
                        setSimLoading(false);
                      }
                    }}
                    className={adminButtonClass('modalConfirm')}
                  >
                    {simLoading ? 'Sending…' : 'Simulate AML Result'}
                  </button>
                </div>
              )}

              {/* Ongoing Monitoring tab */}
              {simTab === 'ongoingMonitoring' && (
                <div className="space-y-4">
                  <p className="font-mono text-[10px] text-adm-t3">
                    Simulate a Sumsub Ongoing Monitoring hit. Creates a new CRA directly from the RED result
                    — no prior assessment needed.
                  </p>
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer No</label>
                    <input
                      value={omCustomerNo}
                      onChange={e => setOmCustomerNo(e.target.value)}
                      placeholder="CU2604133584"
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Hit Type</label>
                    <select
                      value={omHitType}
                      onChange={e => setOmHitType(e.target.value)}
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber"
                    >
                      <option value="PEP_TIER_1">PEP (Tier 1)</option>
                      <option value="ADVERSE_MEDIA">Adverse Media</option>
                      <option value="SANCTIONS_LIST">Sanctions</option>
                    </select>
                  </div>
                  <button
                    disabled={!omCustomerNo || simLoading}
                    onClick={async () => {
                      setSimLoading(true);
                      setSimError(null);
                      try {
                        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/risk-assessment-scenario`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            customerNo: omCustomerNo,
                            reviewAnswer: 'RED',
                            rejectLabels: [omHitType],
                          }),
                        });
                        setSimResult(JSON.stringify(await res.json(), null, 2));
                      } catch (e) {
                        setSimError(e instanceof Error ? e.message : 'Simulation failed.');
                      } finally {
                        setSimLoading(false);
                      }
                    }}
                    className={adminButtonClass('modalConfirm')}
                  >
                    {simLoading ? 'Sending…' : 'Simulate Monitoring Hit'}
                  </button>
                </div>
              )}

              {/* Level 2 Simulation tab */}
              {simTab === 'level2Simulation' && (
                <div className="space-y-4">
                  <p className="font-mono text-[10px] text-adm-t3">
                    Simulate customer completing the Sumsub Level 2 workflow.
                    Use when customer is <strong>RESTRICTED</strong> with a <strong>PENDING_LEVEL2</strong> TierUpgradeCase.
                  </p>
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer No</label>
                    <input
                      value={l2CustomerNo}
                      onChange={e => setL2CustomerNo(e.target.value)}
                      placeholder="CU2604133584"
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                    />
                  </div>
                  <button
                    disabled={!l2CustomerNo || simLoading}
                    onClick={async () => {
                      setSimLoading(true);
                      setSimError(null);
                      try {
                        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/level2-workflow-complete`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ customerNo: l2CustomerNo }),
                        });
                        setSimResult(JSON.stringify(await res.json(), null, 2));
                      } catch (e) {
                        setSimError(e instanceof Error ? e.message : 'Simulation failed.');
                      } finally {
                        setSimLoading(false);
                      }
                    }}
                    className={adminButtonClass('modalConfirm')}
                  >
                    {simLoading ? 'Sending…' : 'Simulate Level 2 Complete'}
                  </button>
                </div>
              )}

              {/* KYT Check tab */}
              {simTab === 'kyt' && (
                <div className="space-y-4">
                  <p className="font-mono text-[10px] text-adm-t3">
                    Simulate a KYT (Know Your Transaction) check PASS.
                    After both KYT and Travel Rule pass, the transaction auto-approves.
                  </p>
                  {/* Deposit / Withdraw toggle */}
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Transaction Type</label>
                    <div className="flex gap-2">
                      {(['deposit', 'withdraw'] as const).map((t) => (
                        <label
                          key={t}
                          className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center transition-colors ${
                            simTxnType === t
                              ? 'border-adm-amber bg-adm-amber/6'
                              : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
                          }`}
                        >
                          <input type="radio" name="kytTxnType" value={t} checked={simTxnType === t}
                            onChange={() => setSimTxnType(t)} className="sr-only" />
                          <span className="font-mono text-[11px] text-adm-t1">{t === 'deposit' ? 'Deposit' : 'Withdraw'}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Identifier input */}
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                      {simTxnType === 'deposit' ? 'Deposit No' : 'Withdraw No'}
                    </label>
                    <input
                      value={simTxnType === 'deposit' ? simDepositNo : simWithdrawNo}
                      onChange={e => simTxnType === 'deposit' ? setSimDepositNo(e.target.value) : setSimWithdrawNo(e.target.value)}
                      placeholder={simTxnType === 'deposit' ? 'DEP-…' : 'WDR_…'}
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                    />
                  </div>
                  {/* KYT Stage (withdraw only) */}
                  {simTxnType === 'withdraw' && (
                    <div>
                      <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">KYT Stage</label>
                      <div className="flex gap-2">
                        {(['PRE', 'POST'] as const).map((s) => (
                          <label
                            key={s}
                            className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center transition-colors ${
                              simKytStage === s
                                ? 'border-adm-amber bg-adm-amber/6'
                                : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
                            }`}
                          >
                            <input type="radio" name="kytStage" value={s} checked={simKytStage === s}
                              onChange={() => setSimKytStage(s)} className="sr-only" />
                            <span className="font-mono text-[11px] text-adm-t1">{s === 'PRE' ? 'Pre-broadcast' : 'Post-broadcast'}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Travel Rule tab */}
              {simTab === 'travelRule' && (
                <div className="space-y-4">
                  <p className="font-mono text-[10px] text-adm-t3">
                    Simulate a Travel Rule check PASS.
                    After both KYT and Travel Rule pass, the transaction auto-approves.
                  </p>
                  {/* Deposit / Withdraw toggle */}
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Transaction Type</label>
                    <div className="flex gap-2">
                      {(['deposit', 'withdraw'] as const).map((t) => (
                        <label
                          key={t}
                          className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center transition-colors ${
                            simTxnType === t
                              ? 'border-adm-amber bg-adm-amber/6'
                              : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
                          }`}
                        >
                          <input type="radio" name="trTxnType" value={t} checked={simTxnType === t}
                            onChange={() => setSimTxnType(t)} className="sr-only" />
                          <span className="font-mono text-[11px] text-adm-t1">{t === 'deposit' ? 'Deposit' : 'Withdraw'}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Identifier input */}
                  <div>
                    <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                      {simTxnType === 'deposit' ? 'Deposit No' : 'Withdraw No'}
                    </label>
                    <input
                      value={simTxnType === 'deposit' ? simDepositNo : simWithdrawNo}
                      onChange={e => simTxnType === 'deposit' ? setSimDepositNo(e.target.value) : setSimWithdrawNo(e.target.value)}
                      placeholder={simTxnType === 'deposit' ? 'DEP-…' : 'WDR_…'}
                      className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                    />
                  </div>
                </div>
              )}

              {simError && (
                <div className="rounded border border-adm-red/20 bg-adm-red/6 px-3 py-2 font-mono text-[11px] text-adm-red">
                  {simError}
                </div>
              )}

              {simResult && (
                <div className="mt-2">
                  <pre className="rounded border border-adm-border bg-adm-bg p-3 font-mono text-[10px] text-adm-t2 overflow-auto max-h-48">{simResult}</pre>
                </div>
              )}
            </div>

            {/* Modal footer */}
            {(simTab === 'onboarding' || simTab === 'material' || simTab === 'kyt' || simTab === 'travelRule') && (
              <div className="flex justify-end gap-2 border-t border-adm-border px-5 py-3">
                <button
                  onClick={() => { setShowSimulate(false); setSimError(null); setSimResult(''); }}
                  className={adminButtonClass('modalCancel')}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSimulate()}
                  disabled={simLoading}
                  className={adminButtonClass('modalConfirm')}
                >
                  {simLoading ? 'Sending…'
                    : simTab === 'kyt'
                      ? (simTxnType === 'withdraw' ? `Simulate ${simKytStage === 'PRE' ? 'Pre' : 'Post'}-KYT PASS` : 'Simulate KYT PASS')
                    : simTab === 'travelRule' ? 'Simulate TR PASS'
                    : 'Send Event'}
                </button>
              </div>
            )}
            {(simTab === 'craSimulation' || simTab === 'ongoingMonitoring' || simTab === 'level2Simulation') && (
              <div className="flex justify-end gap-2 border-t border-adm-border px-5 py-3">
                <button
                  onClick={() => { setShowSimulate(false); setSimError(null); setSimResult(''); }}
                  className={adminButtonClass('modalCancel')}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
