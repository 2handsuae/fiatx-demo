/**
 * 三域客户视图共用的资产投影（deposit/withdraw 单资产字段各调一次、swap
 * from/to 两资产各调一次）。甲案信封收编：形状与三域原地内联的 asset 块
 * 逐字节相同，只搬家、不改行为。
 */
export function toCustomerAssetView(
  asset: { currency: string; code: string; network: string | null; decimals: number } | null | undefined,
): { currency: string; code: string; network: string | null; decimals: number } | null {
  return asset
    ? {
        currency: asset.currency,
        code: asset.code,
        network: asset.network,
        decimals: asset.decimals,
      }
    : null;
}
