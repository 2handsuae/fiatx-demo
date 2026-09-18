// 业务归属日（UTC）：与 recon run 的 businessDate 换算同口径。
export function toBusinessDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
