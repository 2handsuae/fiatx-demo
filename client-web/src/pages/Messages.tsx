// 战役丙波一 T8 · Messages —— 客户消息中心。拉 T4 三端点列表（分页 take=20），
// 行点击先标已读再按 relatedOrderType 深链到对应订单/投诉详情页。样式贴
// Complaints.tsx 现场（border-fx-rule bg-fx-ink divide-y 列表 + loading/empty/error）。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Mail, MessageSquare, RefreshCw } from 'lucide-react';
import { CustomerSessionError, customerFetch, getCustomerApiErrorMessage } from '../utils/customerFetch';

interface NotificationItem {
  id: string;
  templateCode: string;
  title: string;
  body: string;
  channels: string[];
  relatedOrderType: string;
  relatedOrderNo: string;
  readAt: string | null;
  createdAt: string;
}

const API = import.meta.env.VITE_API_URL;
const TAKE = 20;

// T8 brief 深链路由表——逐字照抄，relatedOrderType 未命中时不跳转（仅标已读）。
const ORDER_ROUTES: Record<string, (no: string) => string> = {
  DEPOSIT: (no) => `/deposit/${no}`,
  WITHDRAW: (no) => `/withdraw/${no}`,
  SWAP: (no) => `/swap/${no}`,
  COMPLAINT: (no) => `/complaints/${no}`,
  // 战役丙波三 T8：协议通知（relatedOrderNo 是版本键，无详情页）→ 统一落协议阅读页。
  AGREEMENT: () => '/agreement',
  // 战役丙波四 T2：月结单通知 → 交易记录页带月结单号；资料请求通知 → 资料请求页。
  STATEMENT: (no) => `/transactions?statement=${encodeURIComponent(no)}`,
  DSR: () => '/data-requests',
};

const Messages = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchPage = async (skip: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const res = await customerFetch(`${API}/client/me/notifications?skip=${skip}&take=${TAKE}`);
      if (!res.ok) { setError(await getCustomerApiErrorMessage(res, 'Failed to load your messages')); return; }
      const data = await res.json();
      const newItems: NotificationItem[] = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => (append ? [...prev, ...newItems] : newItems));
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openMessage = async (item: NotificationItem) => {
    if (!item.readAt) {
      // 乐观标已读，失败不阻断深链跳转——这是一次读位标记，不是关键业务动作
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, readAt: new Date().toISOString() } : it)));
      try {
        await customerFetch(`${API}/client/me/notifications/${item.id}/read`, { method: 'POST' });
      } catch (err) {
        if (err instanceof CustomerSessionError) return;
      }
    }
    const toRoute = ORDER_ROUTES[item.relatedOrderType];
    if (toRoute) navigate(toRoute(item.relatedOrderNo));
  };

  const hasMore = items.length < total;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[26px] font-normal text-fx-sand">Messages</h1>
          <p className="mt-1.5 text-[12px] text-fx-dust">Updates on your orders and complaints</p>
        </div>
        <button
          onClick={() => void fetchPage(0, false)}
          className="text-fx-dust hover:text-fx-brass transition-colors"
          title="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertCircle size={22} className="text-fx-rust" />
          <p className="font-mono text-[12px] text-fx-rust">{error}</p>
          <button
            onClick={() => void fetchPage(0, false)}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
          >
            Retry
          </button>
        </div>
      )}

      {!error && loading && (
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="animate-spin text-fx-dust" size={20} />
        </div>
      )}

      {!error && !loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <MessageSquare size={22} className="text-fx-dust" />
          <p className="font-mono text-[12px] text-fx-dust">You have no messages yet.</p>
        </div>
      )}

      {!error && !loading && items.length > 0 && (
        <div className="border border-fx-rule bg-fx-ink divide-y divide-fx-rule">
          {items.map((item) => {
            const unread = !item.readAt;
            const hasEmail = item.channels.includes('EMAIL_SIMULATED');
            const created = new Date(item.createdAt);
            return (
              <button
                key={item.id}
                onClick={() => void openMessage(item)}
                className={`w-full flex items-start justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-fx-charcoal/40 ${
                  unread ? '' : 'opacity-60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {unread && <span className="w-[6px] h-[6px] rounded-full bg-fx-brass shrink-0" />}
                    <span className={`text-[13px] truncate ${unread ? 'font-semibold text-fx-sand' : 'font-normal text-fx-dune'}`}>
                      {item.title}
                    </span>
                  </div>
                  <div className={`mt-1 text-[12px] truncate ${unread ? 'text-fx-dune' : 'text-fx-dust'}`}>
                    {item.body}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-fx-dust">
                    <span>{created.toLocaleString()}</span>
                    {item.relatedOrderNo && (
                      <>
                        <span>·</span>
                        <span>{item.relatedOrderNo}</span>
                      </>
                    )}
                    {hasEmail && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-fx-sage/20 px-2 py-[1px] text-fx-sage normal-case tracking-normal">
                        <Mail size={9} /> Email
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!error && !loading && hasMore && (
        <div className="flex justify-center">
          <button
            onClick={() => void fetchPage(items.length, true)}
            disabled={loadingMore}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-4 py-2 disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
};

export default Messages;
