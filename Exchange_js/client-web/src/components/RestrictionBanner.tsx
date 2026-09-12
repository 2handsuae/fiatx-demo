import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { useAuth } from '../context/AuthContext';
import type { DisclosedRestrictionView } from '../hooks/useCustomerProfile';

/* ────────────────────────────────────────────────────────────────
 *  RestrictionBanner — 客户账户上「可以告知」的限制便签，一条一个条。
 *
 *  显不显示、显示哪几条、标题写什么，全部在后端一次决定：
 *  CustomerAccessService.resolve() 只把 visibility=DISCLOSED 的 OPEN 便签放进
 *  disclosed（标题取 RESTRICTION_CAUSE_POLICY[cause].customerLabel），
 *  GET /client/me/restrictions 原样返回这个数组。SILENT 便签（SANCTION /
 *  KYT_REJECTED_HARD）根本不在响应里 —— 告诉被制裁的客户他被查了，是
 *  "tipping off"，在多数反洗钱法域是刑事犯罪。
 *
 *  因此本组件【只做一件事】：把后端已经给的行换成文案。禁止在这里补任何由
 *  lifecycle / 交易状态 / 余额 / 拒绝原因 / disclosedBlocked 推导出的条件逻辑
 *  —— 那等于把 tipping-off 判定放到两个地方，失败模式是客户被告知一场制裁
 *  调查。与 PendingActionBanner.tsx 同款约束、同款 fetch-on-mount +
 *  refetch-on-visibilitychange。
 * ──────────────────────────────────────────────────────────────── */

/*
 *  按域过滤（业主 2026-09-12 横幅矩阵）：本组件必填 capability prop，只渲染
 *  scopes 命中本能力（或 'ALL'）的条子——一条便签可能同时限住多个域，页面
 *  只应看见跟自己相关的那部分。
 *
 *  合并形态（同一次矩阵定案）：绑了材料请求的条子行【在这儿渲染】，按钮借用
 *  材料请求的状态——PENDING_SUBMISSION 给「Submit material」跳转
 *  /verification/:requestNo；SUBMITTED 改说「审核中」，不给可点动作。没绑材料
 *  的条子按定义没有自助动作，维持 Contact support。（PendingActionBanner 那边
 *  对称地不再渲染绑了限制的材料行，两个组件合起来才是完整的一屏，互不重复。）
 */

export function RestrictionBanner({
  capability,
  supplement,
}: {
  /** 本页对应的交易能力——只渲染 scopes 命中本能力（或 ALL）的条子（业主 2026-09-12 矩阵）。 */
  capability: 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
  /** 页面级补充行（如充值页「入金仍会到账」口径），逐条横幅尾部渲染。 */
  supplement?: string;
}) {
  const [rows, setRows] = useState<DisclosedRestrictionView[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  // 记住上一次本域是否有条子：从「有」翻到「无」= 限制大概率已解除，此刻刷新
  // AuthContext 的共享 user，让本页的禁用按钮当场解禁——否则要整页刷新
  // （AuthContext 只在挂载时拉一次 profile，见 useCustomerProfile.ts）。
  // 该钩子自 PendingActionBanner 移植：blocking 材料行翻面后不再在那边渲染，
  // 钩子必须跟着限制行走，否则解冻后按钮要整页刷新才解禁。
  const hadScopedRef = useRef(false);

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/restrictions`,
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? (data as DisclosedRestrictionView[]) : []);
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      // 任何失败路径都清空：便签解除后的一次拉取失败若留着旧条，客户会看到一条
      // 后端已经撕掉的限制。宁可少显示，不可多显示（与 PendingActionBanner 同规）。
      setRows([]);
    }
  };

  useEffect(() => {
    void load();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scoped = rows.filter((r) => r.scopes.includes(capability) || r.scopes.includes('ALL'));

  useEffect(() => {
    const has = scoped.length > 0;
    if (hadScopedRef.current && !has) void refreshProfile?.();
    hadScopedRef.current = has;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped.length]);

  if (!scoped.length) return null;

  return (
    <div className="space-y-2 mb-4">
      {scoped.map((row) => (
        <div
          key={row.restrictionNo}
          className="border-l-4 border-l-fx-rust bg-fx-rust/[0.04] px-4 py-3 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <AlertCircle size={14} className="shrink-0 mt-[1px] text-fx-rust" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust mb-1">
                {row.label}
              </div>
              <p className="font-sans text-[12px] text-fx-dune leading-snug break-words">
                {row.reason}
              </p>
              <div className="mt-1 font-mono text-[10px] text-fx-dust tabular-nums">
                {row.scopes.join(' · ')}
              </div>
              {supplement && (
                <p className="mt-1 font-sans text-[11px] text-fx-dust leading-snug">{supplement}</p>
              )}
            </div>
          </div>
          {row.claimedByMaterialRequestNo ? (
            row.claimedMaterialStatus === 'SUBMITTED' ? (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-dust">
                Submitted · under review
              </span>
            ) : (
              <button
                onClick={() =>
                  navigate(
                    `/verification/${row.claimedByMaterialRequestNo}?from=${encodeURIComponent(location.pathname)}`,
                  )
                }
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
              >
                Submit material
              </button>
            )
          ) : (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-dust">
              Contact support
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
