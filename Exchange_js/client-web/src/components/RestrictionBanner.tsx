import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
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

// 材料类限制客户自己能解 → CTA 跳认证流程。其余（管理员停用、升级审批中等）
// 客户没有自助动作，不给 CTA —— 给一个点了没用的按钮比不给更糟。
const SELF_SERVE_CAUSES = new Set(['MATERIAL_EXPIRED', 'PENDING_DOCUMENT']);

export function RestrictionBanner() {
  const [rows, setRows] = useState<DisclosedRestrictionView[]>([]);
  const navigate = useNavigate();

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

  if (!rows.length) return null;

  return (
    <div className="space-y-2 mb-4">
      {rows.map((row) => (
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
            </div>
          </div>
          {SELF_SERVE_CAUSES.has(row.cause) && (
            <button
              onClick={() => navigate('/verification')}
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
            >
              Resolve
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
