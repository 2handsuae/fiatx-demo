// admin-web/src/pages/companyFundsThresholds.ts
// 战役乙波二 T8：公司资金看板 · 运营户（F_OPS）见底阈值——业主裁定写死常量
// （乙波二 spec §0 裁定 1），不建配置面（禁做清单：动态配置只写边界不写当前值这类
// 灵活性，本页没有"配置面"这个需求）。
//
// 取值判据（spec §5）：候选线必须①在种子基线上方（开局绿）、②一笔演示级动作
// （LP 卖出腿 5 万 AED / 大额客户兑换）能可见地拉近水位与线的距离——「见底→找 LP」
// 的动机信号演得出来。
//
// 实测校准（T8 Step 4，2026-09-29）：`bash scripts/stack.sh reset self` → `up self` →
// `bash scripts/on-stack.sh self demo:all`（29/29 花名册 + 两恒等式全绿）后，直查
// `GET /admin/tb/accounts?ownerType=SYSTEM`（经 treasury@fiatx.com 登录）——
// F_OPS(AED) = 948,589.35 AED（余额分 94858935 / decimals 2）
// F_OPS(USDT) = 113,999.428189 USDT（余额分 113999428189 / decimals 6，assetCode 原始
//   下发是资产 code 'USDT-TRON' 而非 currency 'USDT'——见 companyFundsFormat.ts 头注释
//   的实测坐实：本页已在 currencyOf() 规范化，展示层看到的是 'USDT'）
// 两币种均在候选线上方（AED 余 48,589、USDT 余 13,999），候选值即终值，不下调。
// 演示级动作验证：LP 卖出腿 50,000 AED 会把 F_OPS(AED) 从 948,589 打到 898,589——
// 直接跌破 900,000 阈值，「见底→找 LP」的动机信号演得出来（比"只是拉近"更强的信号）。
export const COMPANY_FUNDS_THRESHOLDS: Record<string, number> = {
  AED: 900_000,
  USDT: 100_000,
};
