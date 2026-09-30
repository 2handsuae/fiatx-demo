// 战役乙波三 T1 · 审慎地基：NLA 红线常量单源——后续任务（门/巡检/前端）全靠这些名字。
import { Prisma } from '@prisma/client';
import { AED_USD_PEG_RATE } from '../../trading/pricing-center/providers/binance-rate.provider';

// 评审裁定 R2：本模块内的消费方（含 computeStatus 填充 PrudentialStatus.pegRate、
// 未来 T4 前端展示「@ 3.6725」折算注）统一从这个文件取汇率——同源转引，不复制字面量。
export { AED_USD_PEG_RATE };

/** 月开支基数（AED 分）——演示写死常量，叙事含工资/房租等系统外开支（总纲不建⑫⑬）。
 *  候选 1,000,000.00 AED；T6 危机校准若调整须同步 spec §5 表与场景 31/32 数字。 */
export const MONTHLY_OPEX_BASE_AED_MINOR = 100_000_000n;
/** NLA 红线 = 1.2 × 月开支（Company VI.C.1，系数条款定死不可配）。 */
export const NLA_FLOOR_AED_MINOR = (MONTHLY_OPEX_BASE_AED_MINOR * 12n) / 10n; // 120,000,000 分 = 1,200,000.00 AED

/** USDT(6dp 分) → AED(2dp 分)：×3.6725 再降 4 个小数位，向下取整（保守）。
 *  例：113_600_000_000 µUSDT → 41_719_600 fils（=417,196.00 AED）。 */
export function usdtMinorToAedMinor(usdtMinor: bigint): bigint {
  return BigInt(new Prisma.Decimal(usdtMinor.toString()).mul(AED_USD_PEG_RATE).div(10_000).floor().toFixed(0));
}
