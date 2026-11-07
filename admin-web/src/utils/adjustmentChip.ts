// admin-web/src/utils/adjustmentChip.ts
// 戊波二 T11 修复（R41）：案件页差异行上「挂着一张调账单」时的 Status 标签，按那张单当下的状态打——
// 与认损补缺单的 shortfallTopupChip（按划转单 status）同一个路数。此前一律打「Pending CFO · ADJ…」：
// 第 0 轮锚配对之后，开着的案子页按破口那一轮的截止点读、落账分录在窗外，行没有被「已解释」标出来，
// 于是调账单已 POSTED 标签仍停在待批，直到重对账。唯一真相在后端（disposition.adjustmentStatus = 挂着的单的 status）。
export interface AdjustmentRef {
  adjustmentNo: string;
  status: string | null | undefined;
}

export interface AdjustmentChip {
  tone: 'blue' | 'green' | 'gray';
  label: string;
  check?: boolean;
}

export const adjustmentChip = (a: AdjustmentRef): AdjustmentChip => {
  switch (a.status) {
    case 'POSTED':
      return { tone: 'green', label: `Explained · ${a.adjustmentNo}`, check: true };
    case 'REJECTED':
      // 驳回 / 撤回 / 超时后后端已把行解锁、不再挂单；兜底只为不让未知态裸奔。
      return { tone: 'gray', label: `Rejected · ${a.adjustmentNo}` };
    default:
      // DRAFT / PENDING_APPROVAL（或读面没带状态）：单还在路上，等 CFO。
      return { tone: 'blue', label: `Pending CFO · ${a.adjustmentNo}` };
  }
};
