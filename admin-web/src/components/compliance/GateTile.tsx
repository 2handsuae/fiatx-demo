import type { LayerStyle } from '../../utils/depositActionMap';

/**
 * 闸门格子（充值 / 提现 / 兑换三域详情页共用）。
 *
 * 三个详情页的 `Compliance` 卡里，`L1 · Eligibility` 与 `L2 · Transaction Screen`
 * 是同一种承载物：左侧一条 3px 彩色竖边 + 三行（标题 / 主值 / 副行）。此前三页各自
 * 内联手写，L2 演化出三套排版、字号还比自己的 L1 轻一档 —— 同一职责只应有一个组件，
 * 内容差异靠入参表达，排版不许分叉（第五批 §3，业主规则①）。
 *
 * 颜色（borderColor / textColor）一律由 `getComplianceLayerStyle()` 决定；
 * 本组件不做任何取值域判断 —— 要加新状态请改那个函数，别在这里开分支。
 */
export const GateTile = ({
  title,
  value,
  caption,
  style,
}: {
  /** 格子标题，如 `L1 · Eligibility` / `L2 · Transaction Screen`。 */
  title: string;
  /** 主值（大字），如 `ACTIVE` / `Finance: approved` / `PENDING`。 */
  value: string;
  /** 副行（小字），如 `Pre-creation check` / `Score 42`。 */
  caption: string;
  /** 边色 + 字色，来自 `getComplianceLayerStyle(...)`。 */
  style: LayerStyle;
}) => (
  <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${style.borderColor}`}>
    <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">{title}</div>
    <div className={`mt-1 text-sm font-bold ${style.textColor}`}>{value}</div>
    <div className="mt-0.5 font-mono text-[10px] text-adm-t3">{caption}</div>
  </div>
);
