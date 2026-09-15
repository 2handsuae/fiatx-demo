import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CustomerSessionError, customerFetch } from '../../utils/customerFetch';

/**
 * 2026-08-18 材料请求账：本页曾经开的 `actions`（充值单专属子表逐条 action）
 * 口子已被 Task 12 随子表一起物理删除——那个字段现在客户端拿到的是
 * `undefined`，`tx.actions.length` 会直接抛错。改成独立打
 * `/client/me/material-requests`，按 `orderDomain==='DEPOSIT' &&
 * orderRef===depositNo` 过滤（G6：绑了单的行只在它绑定的订单页露）。
 *
 * `本单非终态` 这道闸门是必须的，不是多余的防御：订单进终态后自动解绑
 * 材料请求的监听器（`material-request-order-cancel.listener.ts`）三域（含
 * DEPOSIT/WITHDRAW）事件契约已修复（listener 接错事件契约那次修复，2026-08-17）
 * 并经真库探针验证——但它是异步 `{ async: true }` handler，订单落库到监听器
 * 把材料请求解绑/作废之间有一段处理窗口，一条未挂限制的材料请求仍可能在单子已经
 * SUCCESS/FAILED/RETURNED/CLAWED_BACK 之后短暂"活"在账上，客户端必须自己
 * 兜底不显示。
 */
interface MaterialRequestEntry {
  requestNo: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
}

export function MaterialRequestSection({
  domain,
  orderRef,
  orderIsTerminal,
}: {
  domain: 'DEPOSIT' | 'WITHDRAW';
  orderRef: string;
  orderIsTerminal: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [materials, setMaterials] = useState<MaterialRequestEntry[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/material-requests`);
        if (!r.ok) return;
        const rows = (await r.json()) as MaterialRequestEntry[];
        if (alive && Array.isArray(rows)) {
          setMaterials(rows.filter((m) => m.orderDomain === domain && m.orderRef === orderRef));
        }
      } catch (error) {
        if (error instanceof CustomerSessionError) return;
        // 拉不到就当没有——这块区域本来就是"有就显示"，静默降级比崩页面安全。
      }
    })();
    return () => { alive = false; };
  }, [domain, orderRef]);

  // 2026-08-18 材料请求账：区块显示条件从"ACTION_PENDING 且有 action 行"
  // 改成"这单有绑定的活材料请求 且本单非终态"——数据源换了（见文件头
  // 注释），但"状态就是状态、按钮归按钮"这条业主原则不变：区块是否
  // 出现只看有没有材料请求，交没交齐由每张卡自己的 status 决定按钮
  // 是否可点，不再整条从 DOM 里消失。
  if (materials.length === 0 || orderIsTerminal) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-fx-sand mb-3">Outstanding verification</h2>
      <div className="space-y-2">
        {materials.map((m) => (
          <div key={m.requestNo} className="flex items-center gap-3 rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fx-sand">{m.materialLabel}</div>
              <div className="text-xs text-fx-dust">
                {m.status === 'SUBMITTED' ? 'Received · under review' : 'Awaiting your documents'}
              </div>
            </div>
            <button
              onClick={() => navigate(`/verification/${m.requestNo}?from=${encodeURIComponent(location.pathname)}`)}
              disabled={m.status === 'SUBMITTED'}
              className="rounded-xl border border-fx-brass/40 bg-fx-brass/10 px-4 py-2 text-sm font-semibold text-fx-brass hover:bg-fx-brass/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-fx-brass/10"
            >
              Provide documents
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
