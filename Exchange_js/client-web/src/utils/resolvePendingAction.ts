// client-web/src/utils/resolvePendingAction.ts

/* ────────────────────────────────────────────────────────────────
 *  resolvePendingAction — turns a GET /client/me/pending-action
 *  Response into the action to show, or null.
 *
 *  A non-2xx response is a failure, not "no change": it throws, so
 *  PendingActionBanner's single catch block funnels it into the same
 *  "clear the banner" path as a parse error or a network error. That
 *  matters because leaving a stale action on screen after a real
 *  server error is the tipping-off failure mode this component
 *  exists to prevent — see PendingActionBanner.tsx's header comment.
 * ──────────────────────────────────────────────────────────────── */

export interface PendingAction {
  externalActionId: string;
  reason: string;
  /** 客户提交材料的时刻；null = 尚未提交（banner 三态用，后端事实字段透传） */
  submittedAt: string | null;
}

export const resolvePendingAction = async (res: Response): Promise<PendingAction | null> => {
  if (!res.ok) {
    throw new Error(`pending-action fetch failed with status ${res.status}`);
  }
  // NestJS sends a body-less 200 (Content-Length: 0) for a bare `return
  // null`, not the text "null" — res.json() throws SyntaxError on that.
  // Read as text first and treat an empty body as null explicitly.
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return (data ?? null) as PendingAction | null;
};
