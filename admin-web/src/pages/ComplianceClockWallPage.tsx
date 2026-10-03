// admin-web/src/pages/ComplianceClockWallPage.tsx
// 战役甲波四 · 合规办公室骨架（Task 9）：闹钟墙——聚合报送单与周期义务的到期钟。
// 战役甲波五 Task 9：加投诉行（COMPLAINT，两钟互斥：未确认走确认钟、已确认走裁决钟）。
// 战役丙波四 Task 10：加资料请求行（DSR，单钟 30 自然日，行点击跳 DSR 详情、⚡ 走 DSR 自家端点）。
// 铁律⑥：列表投影零 UUID（后端 ComplianceClockWallService.getWall 已保证，行只有
// refNo/linkKey 两个业务号字段）。模板：RegulatoryFilingListPage.tsx 的表格结构。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Zap } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useSimulationMode } from '../utils/simulationMode';
import { AUTHORITY_LABEL } from '../utils/regulatoryFilingMap';

interface ClockWallRow {
  kind: 'FILING' | 'OBLIGATION' | 'COMPLAINT' | 'DSR';
  refNo: string;
  title: string;
  authority: string;
  deadlineAt: string;
  overdue: boolean;
  status: string;
  linkKey: string;
  // 战役甲波五 T5：COMPLAINT 行专属——哪口钟当前生效（ACK/RESOLVE 两钟互斥）。
  // 战役丙波四 T10：DSR 行也填，恒为 'RESPOND (30d)'（单钟）。
  // FILING/OBLIGATION 行不填（后端 toEqual 视 undefined 键为不存在，不破坏既有行断言）。
  clockLabel?: string;
}

/** spec §2 颜色三档：红 = overdue；黄 = 剩余 ≤ 总时长 25%（锚与截止均知时）或 ≤ 24h
 * （总长不可知时）；OBLIGATION 行进入生成窗（距 nextDueAt ≤ leadBusinessDays）即黄。
 * 本聚合端点（ComplianceClockWallService.getWall）的行形状只有 8 格，不携带锚
 * （createdAt/receivedAt）或 leadBusinessDays——两条"锚已知"的分支在这个端点上永远
 * 取不到数据，故两种 kind 统一退化到 spec 原文写明的"总长不可知"分支：剩余 ≤ 24h 即黄。
 * 阈值数字是展示参数，不入验收判据（spec §2 原文）——这两个常量就是唯一调整点。 */
const YELLOW_THRESHOLD_HOURS = 24;

type Tone = 'red' | 'yellow' | 'green';

const TONE_CLASS: Record<Tone, string> = {
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-amber-100 text-amber-800',
  green: 'bg-green-100 text-green-800',
};

const TONE_LABEL: Record<Tone, string> = {
  red: 'Overdue',
  yellow: 'Due soon',
  green: 'On track',
};

function toneOf(row: ClockWallRow): Tone {
  if (row.overdue) return 'red';
  const ms = new Date(row.deadlineAt).getTime() - Date.now();
  if (ms <= YELLOW_THRESHOLD_HOURS * 3_600_000) return 'yellow';
  return 'green';
}

function remainingText(deadlineAt: string, overdue: boolean): string {
  if (overdue) return 'Overdue';
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (ms <= 0) return 'Overdue';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const KIND_BADGE_CLASS: Record<ClockWallRow['kind'], string> = {
  FILING: 'bg-blue-100 text-blue-800',
  OBLIGATION: 'bg-purple-100 text-purple-800',
  COMPLAINT: 'bg-rose-100 text-rose-800',
  DSR: 'bg-teal-100 text-teal-800',
};

const KIND_LABEL: Record<ClockWallRow['kind'], string> = {
  FILING: 'Filing',
  OBLIGATION: 'Obligation',
  COMPLAINT: 'Complaint',
  DSR: 'Data request',
};

const ComplianceClockWallPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  // ⚡ 挂 DEMO_CLOCK_WRITE（金库），非报送台/合规官经办组——同
  // regulatory-filings.controller.ts simulate-deadline-timeout 路由注释。
  const canSimulate = hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);

  const [rows, setRows] = useState<ClockWallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [simulatingRef, setSimulatingRef] = useState<string | null>(null);
  const [simError, setSimError] = useState('');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-office/clock-wall`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load the compliance clock wall'));
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRowClick = (row: ClockWallRow) => {
    if (row.kind === 'FILING') {
      navigate(`/admin/governance/regulatory-filings/${encodeURIComponent(row.linkKey)}`);
    } else if (row.kind === 'COMPLAINT') {
      navigate(`/admin/governance/complaints/${encodeURIComponent(row.linkKey)}`);
    } else if (row.kind === 'DSR') {
      // 显式 DSR 分支——else 兜底会错跳义务页。路由全前缀见 App.tsx（DSR 归合规办公室组）。
      // 不对无 DSR_READ 的职务做门控：与 FILING/COMPLAINT 行同款，落到目的页的 ForbiddenPage。
      navigate(`/admin/governance/compliance-office/dsr-requests/${encodeURIComponent(row.linkKey)}`);
    } else {
      navigate(`/admin/governance/compliance-office/obligations?highlight=${encodeURIComponent(row.linkKey)}`);
    }
  };

  // 战役甲波五 T9：COMPLAINT 行的 ⚡ 走独立端点 + body（target 由 clockLabel 判——
  // 两钟互斥，行上永远只显示当前生效的那一口，见 compliance-clock-wall.service.ts 注释）。
  const handleFastForward = async (row: ClockWallRow) => {
    setSimulatingRef(row.refNo);
    setSimError('');
    try {
      // 战役丙波四 T10：DSR 单钟，⚡ 无 body（照 dsr-requests.admin.controller.ts simulateTimeout）。
      const res = row.kind === 'COMPLAINT'
        ? await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/complaints/${encodeURIComponent(row.refNo)}/simulate-timeout`,
            { method: 'POST', body: JSON.stringify({ target: row.clockLabel?.startsWith('ACK') ? 'ACK' : 'RESOLVE' }) },
          )
        : row.kind === 'DSR'
          ? await adminFetch(
              `${import.meta.env.VITE_API_URL}/admin/dsr-requests/${encodeURIComponent(row.refNo)}/simulate-timeout`,
              { method: 'POST' },
            )
          : await adminFetch(
              `${import.meta.env.VITE_API_URL}/admin/regulatory-filings/${encodeURIComponent(row.refNo)}/simulate-deadline-timeout`,
              { method: 'POST' },
            );
      if (!res.ok) {
        setSimError(await getApiErrorMessage(res, 'Failed to fast-forward the deadline'));
        return;
      }
      await fetchRows();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setSimError(e instanceof Error ? e.message : 'Failed to fast-forward the deadline');
    } finally {
      setSimulatingRef(null);
    }
  };

  const visible = onlyOverdue ? rows.filter((r) => r.overdue) : rows;

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Compliance Clock Wall"
        subtitle="Every regulatory filing deadline, periodic obligation due date, open complaint clock, and open data request clock, on one clock"
        meta={`${visible.length} of ${rows.length} row(s)`}
      >
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-adm-t2">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          Only overdue
        </label>
        <button type="button" onClick={() => void fetchRows()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {simError && (
        <div className="shrink-0 border-b border-adm-border bg-adm-red/10 px-5 py-2 text-xs text-adm-red">{simError}</div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Type', 'Ref No.', 'Title', 'Authority', 'Deadline', 'Remaining', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const tone = toneOf(row);
              const canFastForward = (row.kind === 'FILING' || row.kind === 'COMPLAINT' || row.kind === 'DSR') && !row.overdue && simEnabled && canSimulate;
              return (
                <tr
                  key={`${row.kind}-${row.refNo}`}
                  onClick={() => handleRowClick(row)}
                  className={`cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40 ${tone === 'red' ? 'bg-adm-red/10' : ''}`}
                >
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${KIND_BADGE_CLASS[row.kind]}`}>
                      {KIND_LABEL[row.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-adm-blue">{row.refNo}</td>
                  <td className="px-4 py-2">{row.title}</td>
                  <td className="px-4 py-2">{AUTHORITY_LABEL[row.authority] ?? row.authority}</td>
                  <td className="px-4 py-2 font-mono">{new Date(row.deadlineAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono">{remainingText(row.deadlineAt, row.overdue)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${TONE_CLASS[tone]}`}>
                      {TONE_LABEL[tone]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canFastForward && (
                      <button
                        type="button"
                        disabled={simulatingRef === row.refNo}
                        onClick={(e) => { e.stopPropagation(); void handleFastForward(row); }}
                        className="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 font-mono text-[10px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Fast-forward this deadline into the past (demo only)"
                      >
                        <Zap size={11} />
                        {simulatingRef === row.refNo ? 'Working…' : 'Fast-forward deadline'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-adm-t3">
                  {rows.length === 0
                    ? 'Nothing on the clock — no open filing deadlines or active obligations'
                    : 'No overdue rows right now'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ComplianceClockWallPage;
