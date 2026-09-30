// 战役丙波一 T8 · 客户端 socket 单例——握手契约见 T3 notifications.gateway.ts：
// `io(VITE_API_URL, { auth: { token } })`，token 取 localStorage 'customer_token'
// （同 customerFetch.ts）。事件 `customer.updated` 零 payload，只作"该刷新了"的信号。
// onCustomerUpdated 返回解绑函数，供 T9（复用点）与本任务的 NotificationBell 共用。
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
// 建连时用的 token——Quick Login 换种子账号（CustomerLogin.doLogin 只写
// localStorage + navigate，不过 closeCustomerSocket）不会主动断旧连接；不记下这个就
// 判不出"该换号了"，铃铛会一直连在旧账号的 customer_<旧id> 房间收不到新账号的信号
// （评审 Important，T8 走查逮）。
let connectedToken: string | null = null;

export function getCustomerSocket(): Socket | null {
  const token = localStorage.getItem('customer_token');
  if (!token) return null;
  if (socket && connectedToken !== token) {
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL, { auth: { token } });
    connectedToken = token;
  }
  return socket;
}

export function onCustomerUpdated(cb: () => void): () => void {
  const s = getCustomerSocket();
  if (!s) return () => {};
  s.on('customer.updated', cb);
  return () => { s.off('customer.updated', cb); };
}

export function closeCustomerSocket() {
  socket?.disconnect();
  socket = null;
  connectedToken = null;
}
