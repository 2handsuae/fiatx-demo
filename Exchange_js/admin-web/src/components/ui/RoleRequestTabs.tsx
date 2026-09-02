// src/components/ui/RoleRequestTabs.tsx
//
// Task 26：角色定义修改申请单此前后端零前端消费——两 tab 方案把它接进既有的
// Role Change Requests 页面，少一个侧栏项（既有侧栏项覆盖两个 tab）。每个 tab
// 是一条真实路由（各自可深链/刷新），不是纯 client state 切换；两个页面各自
// 顶部渲染这同一个条形组件，只是 active 值不同。
import { useNavigate } from 'react-router-dom';

const TABS = [
  { key: 'binding', label: 'Binding Changes', path: '/admin/iam/role-change-requests' },
  { key: 'definition', label: 'Definition Changes', path: '/admin/iam/role-definition-modify-requests' },
] as const;

export type RoleRequestTabKey = (typeof TABS)[number]['key'];

export const RoleRequestTabs = ({ active }: { active: RoleRequestTabKey }) => {
  const navigate = useNavigate();
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-adm-border bg-adm-panel px-5 pt-2">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => tab.key !== active && navigate(tab.path)}
          className={[
            'rounded-t border border-b-0 px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors',
            tab.key === active
              ? 'border-adm-border bg-adm-bg text-adm-amber'
              : 'border-transparent text-adm-t3 hover:text-adm-t2',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};
