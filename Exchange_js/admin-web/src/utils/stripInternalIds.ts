/** 铁律⑥展示层过滤（岔口①乙案，2026-09-15 业主拍板）：递归剔除内部 id 形键，
 * 放行旅程/链路标识（页面本就展示的检索键）。只作用于屏上渲染与 Copy——
 * 下载文件保持全量，取证完整性不受影响。
 * causationId 2026-09-16 摘出放行名单：值常是审批内部 UUID（approvalId 作 causation），
 * 读不懂也跳不了（BACKLOG §H UUID 残口①）。 */
const PASSTHROUGH_ID_KEYS = new Set(['traceId', 'correlationId', 'requestId', 'sessionId']);
const INTERNAL_ID_KEY = /^id$|Id$|Ids$/;
const EXTRA_STRIP_KEYS = new Set(['selectedEventIdsSnapshot']);

export function stripInternalIds<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalIds(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (EXTRA_STRIP_KEYS.has(key)) continue;
      if (INTERNAL_ID_KEY.test(key) && !PASSTHROUGH_ID_KEYS.has(key)) continue;
      out[key] = stripInternalIds(val);
    }
    return out as unknown as T;
  }
  return value;
}
