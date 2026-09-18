// client-web/src/utils/timelineDisplay.ts

import type { TimelineItem } from '../components/detail/Timeline';

/** 展示层连续同词去重：服务端按收敛状态值去重后，不同状态仍可能映射到同一
 *  客户词(如 PAYIN_PENDING 与 COMPLIANCE_PENDING 都显示 PROCESSING)——同词
 *  连续条目只留第一条(保留该词开始的时刻)。只删行不加行。 */
export const dedupeTimelineItems = (items: TimelineItem[]): TimelineItem[] =>
  items.filter((it, i) => i === 0 || it.label !== items[i - 1].label);
