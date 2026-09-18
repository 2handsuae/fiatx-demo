export function formatCountdown(activatesAt: string, now: number): string {
  const ms = Math.max(0, new Date(activatesAt).getTime() - now);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}
