// client-web/src/utils/complaintStatusView.ts

/* ── Complaint Status View (client) ───────────────────────────────
   Customer-facing counterpart to admin-web's complaintMap.ts. Complaints
   have no tipping-off concern (unlike deposit/withdraw status), so this
   file is a plain human-language translation — same six backend statuses,
   customer-meaningful copy (rules/frontend-client.md: "Statuses MUST be
   translated into customer-meaningful language while preserving backend
   truth").

   Shape matches StatusBadge.tsx's {label, tone} contract (shared component,
   used by deposit/withdraw/swap already).
   ────────────────────────────────────────────────────────────── */

import type { StatusBadgeView } from '../components/StatusBadge';

const VIEW_MAP: Record<string, StatusBadgeView> = {
  RECEIVED: { label: 'RECEIVED', tone: 'neutral' },
  ACKNOWLEDGED: { label: 'UNDER REVIEW', tone: 'neutral' },
  INVESTIGATING: { label: 'UNDER REVIEW', tone: 'neutral' },
  INVESTIGATING_EXTENDED: { label: 'UNDER REVIEW', tone: 'warning' },
  RESOLUTION_PENDING: { label: 'AWAITING SIGN-OFF', tone: 'warning' },
  RESOLVED: { label: 'RESOLVED', tone: 'positive' },
};

const DEFAULT_VIEW: StatusBadgeView = { label: 'PROCESSING', tone: 'neutral' };

export function getComplaintStatusView(status: string): StatusBadgeView {
  return VIEW_MAP[status] ?? DEFAULT_VIEW;
}

/** Journey step copy for the read-only timeline (spec §3: "状态时间线，人话标签"). */
export const COMPLAINT_JOURNEY_STEP_LABEL: Record<string, string> = {
  SUBMITTED: 'Complaint submitted',
  ACKNOWLEDGED: 'Acknowledged by our team',
  EXTENDED: 'Review extended — more time needed',
  RESOLVED: 'Resolved',
};

export const COMPLAINT_CATEGORY_LABEL: Record<string, string> = {
  SERVICE: 'Service',
  FEES: 'Fees',
  ORDER_EXECUTION: 'Order execution',
  FROZEN_FUNDS_APPEAL: 'Frozen funds appeal',
  OTHER: 'Other',
};

export const COMPLAINT_CATEGORIES = ['SERVICE', 'FEES', 'ORDER_EXECUTION', 'FROZEN_FUNDS_APPEAL', 'OTHER'] as const;

export const COMPLAINT_RESOLUTION_OUTCOME_LABEL: Record<string, string> = {
  UPHELD: 'Upheld — we agreed with your complaint',
  PARTIALLY_UPHELD: 'Partially upheld',
  REJECTED: 'Not upheld',
};

export const COMPLAINT_MESSAGE_TYPE_LABEL: Record<string, string> = {
  ACK: 'Acknowledgement',
  EXTENSION_NOTICE: 'Extension notice',
  FINAL_RESPONSE: 'Final response',
};
