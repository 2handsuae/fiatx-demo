// 平账三期 · 事故登记：状态 / 类型 / 定损口径 / 升级去向 / 善后类型 / 通报依据的展示人话。
// 唯一真相在后端 incident.constants.ts，这里只是展示词（惯例同 internalTransferStatusMap.ts）。
export const INCIDENT_STATUS_LABEL: Record<string, string> = {
  REGISTERED: '已登记',
  INVESTIGATING: '调查中',
  ASSESSED: '已定损',
  RESOLVING: '处置中',
  CLOSED: '已结案',
  WITHDRAWN: '已撤回',
};

export const INCIDENT_STATUSES = [
  'REGISTERED',
  'INVESTIGATING',
  'ASSESSED',
  'RESOLVING',
  'CLOSED',
  'WITHDRAWN',
] as const;

export const INCIDENT_TYPE_LABEL: Record<string, string> = {
  UNAUTHORIZED_OUTFLOW: '未授权转出',
  LARGE_UNEXPLAINED: '大额查不出',
  CLIENT_SHORTFALL: '退汇欠款',
  MANUAL: '人工登记',
};

export const INCIDENT_TYPES = [
  'UNAUTHORIZED_OUTFLOW',
  'LARGE_UNEXPLAINED',
  'CLIENT_SHORTFALL',
  'MANUAL',
] as const;

export const ASSESSMENT_BASIS_LABEL: Record<string, string> = {
  RECOVERED: '追回',
  FIRM_LOSS: '认损',
  CLIENT_COLLECTION: '追索',
  NO_LOSS: '无损失',
};

export const ASSESSMENT_BASIS_VALUES = ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'] as const;

export const ESCALATION_TARGET_LABEL: Record<string, string> = {
  MLRO: 'MLRO',
  CFO: 'CFO',
  SENIOR_MANAGEMENT: '高级管理层',
};

export const ESCALATION_TARGETS = ['MLRO', 'CFO', 'SENIOR_MANAGEMENT'] as const;

export const REMEDIATION_KIND_LABEL: Record<string, string> = {
  SUPPLEMENT: '补录',
  CLAIM: '认领',
  ADJUSTMENT: '调账',
  TRANSFER: '划转',
};

export const REMEDIATION_KINDS = ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'] as const;

/**
 * 依据条款目录（spec §4）——镜像后端 incident.constants.ts 的 INCIDENT_REPORT_BASES。
 * hours=null 的依据没有法定钟，界面显式「未设时限」，数字不杜撰。
 */
export const INCIDENT_REPORT_BASES: Record<string, { label: string; hours: number | null }> = {
  TIR_K_H: { label: 'TIR Rulebook Section K + H — 网安 / BCDR 事件报 VARA（72h）', hours: 72 },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Client Money 重大未平差异（无法定钟）', hours: null },
  CRM_V_D_2: { label: 'CRM V.D.2 — Client VAs 重大未平差异（无法定钟）', hours: null },
};

export function reportStatusLabel(reportRequired: boolean, reportedAt: string | null): string {
  if (!reportRequired) return '无需通报';
  return reportedAt ? '已通报' : '待通报';
}

export type ReportDeadlineTone = 'none' | 'normal' | 'breached' | 'done';

/**
 * 通报时限展示。刻意不复用共享 `slaDisplay.formatSlaRemaining` 的「—」空态——那是给
 * "尚未配置"看的，事故这里的空态是"依据本身没有法定钟"，业务含义不同，必须显式「未设时限」
 * （spec §4，不许显示成看起来像还没算出来的样子）。
 */
export function reportDeadlineDisplay(
  deadlineAt: string | null,
  reportedAt: string | null,
): { text: string; tone: ReportDeadlineTone } {
  if (reportedAt) return { text: '已通报', tone: 'done' };
  if (!deadlineAt) return { text: '未设时限', tone: 'none' };
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (ms <= 0) return { text: '已超时', tone: 'breached' };
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return { text: `剩 ${days}d ${hours}h`, tone: 'normal' };
  if (hours > 0) return { text: `剩 ${hours}h ${minutes}m`, tone: 'normal' };
  return { text: `剩 ${minutes}m`, tone: 'normal' };
}

export const REPORT_DEADLINE_TONE_CLASS: Record<ReportDeadlineTone, string> = {
  none: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-800',
  breached: 'bg-red-100 text-red-800',
  done: 'bg-green-100 text-green-800',
};
