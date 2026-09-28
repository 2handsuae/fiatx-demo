// admin-web/src/utils/complaintMap.ts
// 战役甲波五 Task 9：投诉工作流——状态 / 类别 / 处置结论 / 往来记录类型的展示人话。
// 唯一真相在后端 complaint.constants.ts，这里只是展示词（惯例同 incidentStatusMap.ts /
// regulatoryFilingMap.ts：admin-web 不能直接 import 后端 src，只能手抄同构）。

export const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  RECEIVED: 'Received',
  ACKNOWLEDGED: 'Acknowledged',
  INVESTIGATING: 'Investigating',
  INVESTIGATING_EXTENDED: 'Investigating (extended)',
  RESOLUTION_PENDING: 'Resolution pending',
  RESOLVED: 'Resolved',
};

export const COMPLAINT_STATUSES = [
  'RECEIVED',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'INVESTIGATING_EXTENDED',
  'RESOLUTION_PENDING',
  'RESOLVED',
] as const;

export const COMPLAINT_CATEGORY_LABEL: Record<string, string> = {
  SERVICE: 'Service',
  FEES: 'Fees',
  ORDER_EXECUTION: 'Order execution',
  FROZEN_FUNDS_APPEAL: 'Frozen funds appeal',
  OTHER: 'Other',
};

export const COMPLAINT_RESOLUTION_OUTCOME_LABEL: Record<string, string> = {
  UPHELD: 'Upheld',
  PARTIALLY_UPHELD: 'Partially upheld',
  REJECTED: 'Rejected',
};

export const COMPLAINT_RESOLUTION_OUTCOMES = ['UPHELD', 'PARTIALLY_UPHELD', 'REJECTED'] as const;

export const COMPLAINT_ENTRY_KIND_LABEL: Record<string, string> = {
  INTERNAL_NOTE: 'Internal note',
  CLIENT_MESSAGE: 'Client message',
};

export const COMPLAINT_MESSAGE_TYPE_LABEL: Record<string, string> = {
  ACK: 'Acknowledgement',
  EXTENSION_NOTICE: 'Extension notice',
  FINAL_RESPONSE: 'Final response',
};

/** 六态终盘（addNote/simulateTimeout 共用的非终态守卫，镜像 complaint.constants.ts
 * COMPLAINT_TERMINAL_STATUSES——只有 RESOLVED 零出边）。 */
export const COMPLAINT_TERMINAL_STATUS = 'RESOLVED';

/** 两调查态（proposeResolution/escalate 共用出发态，镜像
 * COMPLAINT_INVESTIGATING_STATUSES）。 */
export const COMPLAINT_INVESTIGATING_STATUSES: readonly string[] = ['INVESTIGATING', 'INVESTIGATING_EXTENDED'];

export interface ComplaintClockLike {
  currentStatus: string;
  ackDeadlineAt: string;
  acknowledgedAt: string | null;
  resolveDeadlineAt: string;
}

export interface ActiveClock {
  target: 'ACK' | 'RESOLVE';
  label: string;
  deadlineAt: string;
  overdue: boolean;
}

/** 当前生效的那口钟——镜像后端 compliance-clock-wall.service.ts 的分支：未确认走
 * 确认钟，已确认走裁决钟；RESOLVED 无钟（终态零出边，双钟都已停）。 */
export function activeComplaintClock(row: ComplaintClockLike): ActiveClock | null {
  if (row.currentStatus === COMPLAINT_TERMINAL_STATUS) return null;
  const target = row.acknowledgedAt == null ? 'ACK' : 'RESOLVE';
  const deadlineAt = target === 'ACK' ? row.ackDeadlineAt : row.resolveDeadlineAt;
  const label = target === 'ACK' ? 'Acknowledge (1w)' : 'Resolve (4w/8w)';
  return { target, label, deadlineAt, overdue: new Date(deadlineAt).getTime() < Date.now() };
}

export function remainingClockText(deadlineAt: string): string {
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
