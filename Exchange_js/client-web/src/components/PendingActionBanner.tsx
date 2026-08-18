import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Clock } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { useAuth } from '../context/AuthContext';

/* ────────────────────────────────────────────────────────────────
 *  PendingActionBanner — entry point for a customer's outstanding
 *  material requests, mounted at the top of Swap / Withdraw / Profile.
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
 *  2026-08-18 材料请求账：数据源从客户级单指针端点
 *  （/client/me/pending-action，已被 Task 12 物理删除）改成材料账的
 *  /client/me/material-requests——单指针只能装一条，现在一条 action 一行。
 *
 *  G6 过滤（与后台横幅规则相反，后台按 customerNo 全量看，客户端只看
 *  "跟我有关且我能做点什么的"）：
 *    客户级横幅 = 活行里「挂了限制的」∪「没绑单的」
 *  绑了单又没挂限制的不在这里出现——那种行只在它绑定的那个订单详情页露
 *  （见 DepositDetail.tsx / WithdrawDetail.tsx）。
 *
 *  分档：挂了摁人的限制 → 红（blocking）；其余（提醒性质）→ 黄。
 *  status === 'SUBMITTED' 的不给 CTA，文案换成"审核中"。
 *
 *  Fetch-on-mount + refetch-on-visibilitychange mirrors
 *  ProfileBannerStack.tsx's existing pattern.
 * ──────────────────────────────────────────────────────────────── */

interface ClientMaterialRequestRow {
  requestNo: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  blocking: boolean;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  reason: string;
}

export function PendingActionBanner() {
  const [rows, setRows] = useState<ClientMaterialRequestRow[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  // 记住上一次是否有"挂了限制"的行：从「有」翻到「无」= 限制大概率已解除
  // （officer GREEN 清了材料请求 + 限制账），此刻刷新 AuthContext 的共享
  // user，让 Swap/Withdraw 页的禁用按钮当场解禁——否则要整页刷新
  // （AuthContext 只在挂载时拉一次 profile，见 useCustomerProfile.ts）。
  // 只跟踪 blocking 行的存亡：非阻断的提醒行来去不影响任何按钮的禁用态，
  // 不需要触发这次刷新。
  const hadBlockingRef = useRef(false);

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/material-requests`,
      );
      if (!res.ok) throw new Error(`material-requests fetch failed with status ${res.status}`);
      const data = (await res.json()) as ClientMaterialRequestRow[];
      const visible = Array.isArray(data)
        ? data.filter((r) => r.blocking || r.orderDomain === null)
        : [];
      const blockingNow = visible.some((r) => r.blocking);
      if (hadBlockingRef.current && !blockingNow) {
        void refreshProfile?.();
      }
      hadBlockingRef.current = blockingNow;
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
        const submitted = r.status === 'SUBMITTED';
        const borderCls = r.blocking ? 'border-l-fx-rust' : 'border-l-fx-brass';
        const bgCls = r.blocking ? 'bg-fx-rust/[0.03]' : 'bg-fx-brass/[0.03]';
        const iconCls = r.blocking ? 'text-fx-rust' : 'text-fx-brass';

        return (
          <div
            key={r.requestNo}
            className={`border-l-4 ${borderCls} ${bgCls} px-4 py-3 flex items-start justify-between gap-4`}
          >
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {submitted ? (
                <Clock size={14} className={`shrink-0 mt-[1px] ${iconCls}`} />
              ) : r.blocking ? (
                <AlertTriangle size={14} className={`shrink-0 mt-[1px] ${iconCls}`} />
              ) : (
                <AlertCircle size={14} className={`shrink-0 mt-[1px] ${iconCls}`} />
              )}
              <p className="font-sans text-[12px] text-fx-dune leading-snug">
                {submitted
                  ? `${r.materialLabel} — submitted, under review.`
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
                Verify now
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
