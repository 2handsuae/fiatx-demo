// 战役丙波一 T8 · 铃铛——挂载时拉 unread-count，socket customer.updated 触发重拉
// （T3 握手 + customerSocket.ts 单例）。点击跳 /messages。样式贴 CustomerDashboardLayout
// 现有 header 右簇图标族（theme toggle 同款 text-fx-dust hover:text-fx-brass），不造新体系。
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { onCustomerUpdated } from '../utils/customerSocket';

const API = import.meta.env.VITE_API_URL;

const NotificationBell = () => {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const fetchUnreadCount = async () => {
    try {
      const res = await customerFetch(`${API}/client/me/notifications/unread-count`);
      if (!res.ok) return;
      const data = await res.json();
      setCount(typeof data.count === 'number' ? data.count : 0);
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      // 静默——铃铛未读数不是关键路径，拉取失败不打断其余 header 渲染
    }
  };

  useEffect(() => {
    void fetchUnreadCount();
    const unbind = onCustomerUpdated(() => void fetchUnreadCount());
    return unbind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      onClick={() => navigate('/messages')}
      className="relative text-fx-dust hover:text-fx-brass transition-colors"
      aria-label="Messages"
      title="Messages"
    >
      <Bell size={14} />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-fx-brass text-fx-obsidian font-mono text-[9px] leading-[14px] text-center font-semibold">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
};

export default NotificationBell;
