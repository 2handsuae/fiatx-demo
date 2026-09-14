/**
 * SLA 剩余时间展示（2026-08-21 第三批）。
 *
 * 这是本批唯一放进公共 utils 的东西 —— 它是纯展示格式化，不含任何域业务逻辑。
 * 三域的 SLA **配置**（哪个状态计时、多久、超时去哪）仍各自留在各自的 service 里
 * （deliberate fork），不要把配置也搬过来"统一"。
 */
export type SlaTone = 'none' | 'normal' | 'breached';

export function formatSlaRemaining(
  slaDeadline: string | null | undefined,
  slaBreached: boolean | undefined,
): { text: string; tone: SlaTone } {
  if (slaBreached) return { text: 'Overdue', tone: 'breached' };
  if (!slaDeadline) return { text: '—', tone: 'none' };

  const ms = new Date(slaDeadline).getTime() - Date.now();
  if (ms <= 0) return { text: 'Overdue', tone: 'breached' };

  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return { text: `${days}d ${hours}h`, tone: 'normal' };
  if (hours > 0) return { text: `${hours}h ${minutes}m`, tone: 'normal' };
  return { text: totalMinutes <= 0 ? '<1m' : `${minutes}m`, tone: 'normal' };
}
