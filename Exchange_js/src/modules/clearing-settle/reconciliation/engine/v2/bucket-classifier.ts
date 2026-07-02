// Round3 spec §2.2：钱包级五桶互斥分类（MATCHED 不开 case，其余三桶开）。
// 残差 = delta − Σ在途签名额（IN 为正 / OUT 为负）；命中即止：
//   ① 残差 ≠ 0                       → BREAK   （在途解释不干净，剩余就是真差异）
//   ② 残差 = 0 且 在途行 > 0          → IN_TRANSIT（差额被在途完全解释，会自愈）
//   ③ 残差 = 0 且 无在途 且 流水异常>0 → SOFT_FLAG （余额平是巧合，流水配不上=假匹配）
//   ④ 其余                           → MATCHED

export type ReconBucket = 'MATCHED' | 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

export function computeBucket(input: {
  delta: bigint;            // external − internal(POSTED)
  inTransitSigned: bigint;  // Σ(在途 IN 为正 / OUT 为负)——inTransitSigned 与 inTransitCount 必须来自同一 inTransit 行集
  inTransitCount: number;
  anomalyCount: number;     // OI + OE + MM（不含在途行）
}): ReconBucket {
  const residual = input.delta - input.inTransitSigned;
  if (residual !== 0n) return 'BREAK';
  if (input.inTransitCount > 0) return 'IN_TRANSIT';
  if (input.anomalyCount > 0) return 'SOFT_FLAG';
  return 'MATCHED';
}
