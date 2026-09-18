import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Clock } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';

/* ────────────────────────────────────────────────────────────────
 *  PendingActionBanner — entry point for a customer's outstanding
 *  material requests that are NOT tied to a restriction, mounted at
 *  the top of Deposit / Withdraw (domain-scoped via the required
 *  `domain` prop).
 *
 *  Whether to show anything is decided ONCE, on the backend write side
 *  (each domain's disposition/issuance path): a customer under sanctions
 *  investigation must be told nothing at all — telling them is
 *  "tipping off", a criminal offence in most AML regimes. GET
 *  /client/me/material-requests already encodes that decision (it never
 *  lists a row for a hard-line/sanctions disposition). This component
 *  renders purely off that response — an empty list means render
 *  nothing, no questions asked. Do NOT add any conditional logic here
 *  derived from order status, restrictions, reject reason, or anything
 *  else — that would put the tipping-off decision in two places, and the
 *  failure mode is a customer being told about a sanctions investigation.
 *
 *  波三G（业主矩阵，推翻 2026-08-18 G6 两点）：本组件只剩「没绑条子 + 绑本域
 *  订单」的材料行——绑条子的已并进 RestrictionBanner 的条子形态（借材料状态
 *  换 CTA 文案，见 RestrictionBanner.tsx）；单独材料（无单无条子）收拢到
 *  Overview/Profile（ProfileBannerStack），不再在这里露出。domain 过滤同时
 *  取代了旧的「没绑单的」分支——绑了本域订单又没挂限制的行，才是本组件仅剩
 *  的职责。
 *
 *  Fetch-on-mount + refetch-on-visibilitychange mirrors
 *  ProfileBannerStack.tsx's existing pattern.
 * ──────────────────────────────────────────────────────────────── */

interface ClientMaterialRequestRow {
  requestNo: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  blocking: boolean;
  /** 上一次被打回（RED+RETRY）→ 这一轮是重交，文案必须与首次要材料区分开 */
  resubmission: boolean;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  reason: string;
}

export function PendingActionBanner({ domain }: { domain: 'DEPOSIT' | 'WITHDRAW' }) {
  const [rows, setRows] = useState<ClientMaterialRequestRow[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/material-requests`,
      );
      if (!res.ok) throw new Error(`material-requests fetch failed with status ${res.status}`);
      const data = (await res.json()) as ClientMaterialRequestRow[];
      // 波三G（业主矩阵，推翻 2026-08-18 G6 两点）：本组件只剩「没绑条子 + 绑本域
      // 订单」的材料行——绑条子的已并进 RestrictionBanner 的条子形态；单独材料
      // （无单无条子）收拢到 Overview/Profile（ProfileBannerStack）。
      const visible = Array.isArray(data)
        ? data.filter((r) => !r.blocking && r.orderDomain === domain)
        : [];
      setRows(visible);
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      // 一条非 2xx / 解析失败 / 网络失败都落到这里。刷新失败时【不】清空
      // 已有的 rows——那会在真实服务器错误后把横幅误撤下，等同于告诉
      // 一个仍在受限的客户"你没事了"，是 tipping-off 的另一种失败模式。
      // 首次加载失败则本来就是空数组，无所谓。
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

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {rows.map((r) => {
        // 走到这里的行已被 load() 的过滤挡掉 blocking===true——本组件只剩
        // 提醒性质的材料行，样式固定用 brass（不再按 blocking 切红/黄）。
        const submitted = r.status === 'SUBMITTED';

        return (
          <div
            key={r.requestNo}
            className="border-l-4 border-l-fx-brass bg-fx-brass/[0.03] px-4 py-3 flex items-start justify-between gap-4"
          >
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {submitted ? (
                <Clock size={14} className="shrink-0 mt-[1px] text-fx-brass" />
              ) : (
                <AlertCircle size={14} className="shrink-0 mt-[1px] text-fx-brass" />
              )}
              <p className="font-sans text-[12px] text-fx-dune leading-snug">
                {submitted
                  ? `${r.materialLabel} — submitted, under review.`
                  : r.resubmission
                    ? // 打回重交：不说清这一点，客户会以为上次根本没提交成功，
                      // 于是干等。只说「要重交」，不下发审核内部的拒绝细节。
                      `${r.materialLabel} — the documents you sent could not be accepted. Please upload them again.`
                    : `${r.materialLabel}: ${r.reason}`}
              </p>
            </div>
            {!submitted && (
              <button
                onClick={() =>
                  navigate(`/verification/${r.requestNo}?from=${encodeURIComponent(location.pathname)}`)
                }
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
              >
                {r.resubmission ? 'Re-upload' : 'Verify now'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
