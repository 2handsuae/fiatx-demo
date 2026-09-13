/**
 * 进入 nextStatus 时该带的 SLA 字段。有配置就起新计时，没配置就清空。
 * slaBreached 一律归 false —— 换了状态就是换了等待对象，旧的破线记录不该跟过来。
 *
 * 唯一真相点：三域（deposit/withdraw/swap）resolveSlaFields 均薄壳委托本函数，
 * 语义注释只在这里维护一份——不要在域内方法上重复展开。
 */
export function resolveSlaFields<S extends string>(
  minutesByStatus: Partial<Record<S, number>>,
  nextStatus: S,
): { slaDeadline: Date | null; slaBreached: false } {
  const minutes = minutesByStatus[nextStatus];
  return minutes === undefined
    ? { slaDeadline: null, slaBreached: false }
    : { slaDeadline: new Date(Date.now() + minutes * 60_000), slaBreached: false };
}
