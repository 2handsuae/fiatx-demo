import { useLocation, useNavigate } from 'react-router-dom';

/**
 * 返回「从哪来回哪去」。
 *
 * 不能写死 navigate('/deposit')——这个页面可以从充值列表、也可以从认证页
 * （提交后）到达，将来还可能从别处深链进来，写死会把人送到一个他没来过的地方。
 *
 * react-router 在本次会话的**第一个**历史条目上会把 location.key 置为
 * 'default'（直接输 URL、刷新、外部链接进来都是这种）——此时栈里没有站内
 * 上一页，navigate(-1) 会把人送出本站，所以退回列表兜底。
 */
export const useGoBack = (fallback: string) => {
  const navigate = useNavigate();
  const location = useLocation();
  return () => (location.key === 'default' ? navigate(fallback) : navigate(-1));
};
