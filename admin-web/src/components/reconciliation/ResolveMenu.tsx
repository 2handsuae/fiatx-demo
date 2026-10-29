// admin-web/src/components/reconciliation/ResolveMenu.tsx
//
// 方案乙（Differences 表 Status 列标签下方）：每行最多一个控件——还能改处置的行，所有可点的
// 处置/跟进动作收进这一个「Resolve ▾」下拉。管理台此前没有下拉控件，这是第一个。
//
// 弹层用 createPortal 挂到 document.body + position: fixed，位置由触发钮的
// getBoundingClientRect() 算：Differences 表外层是 overflow-x-auto 容器，绝对定位的
// 下拉会被它裁掉。因为是 fixed，页面/容器一滚动或窗口一缩放位置就失准，所以这两种
// 情况直接关闭（点选项、点外面、Esc 同样关闭）。
//
// 本组件只管「开合 + 摆位 + 渲染」，不懂任何业务：分组、标签、权限、点了之后做什么
// 全由调用方（CaseFlowTable）传入；不替系统推荐哪一项（⚡ 标签是调用方在模拟模式下
// 传来的演示提示）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface ResolveMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  // 右侧小标签：muted = 灰（如 current），amber = 琥珀（⚡ 演示推荐）。
  tag?: { text: string; tone: 'muted' | 'amber' };
  // 有值 = 置灰不可点，并把这句说明写在标签下面（如「Paused · pending bank confirmation」）。
  disabledNote?: string;
}

export interface ResolveMenuGroup {
  title: string;
  items: ResolveMenuItem[];
}

interface ResolveMenuProps {
  groups: ResolveMenuGroup[];
}

const GAP = 4;       // 触发钮与弹层的间距
const MARGIN = 8;    // 弹层离视口边缘的最小留白

export const ResolveMenu = ({ groups }: ResolveMenuProps) => {
  const [open, setOpen] = useState(false);
  // undefined = 刚打开、尚未量过弹层尺寸（先隐形渲染一帧再摆位，避免闪跳）。
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const visibleGroups = groups.filter((g) => g.items.length > 0);
  const hasRecommended = visibleGroups.some((g) => g.items.some((it) => it.tag?.text.startsWith('⚡')));

  const close = useCallback(() => {
    setOpen(false);
    setStyle(undefined);
  }, []);

  // 打开后量一次弹层：右对齐触发钮，下方放不下且上方更宽裕就翻到上方。
  useLayoutEffect(() => {
    if (!open || style) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const placeAbove = height + GAP > spaceBelow && spaceAbove > spaceBelow;
    const top = placeAbove ? Math.max(MARGIN, rect.top - GAP - height) : rect.bottom + GAP;
    const left = Math.max(MARGIN, Math.min(rect.right - width, window.innerWidth - width - MARGIN));
    setStyle({ position: 'fixed', top, left });
  }, [open, style]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  // 没有任何可点项（全被权限/状态过滤掉）= 不渲染入口。
  if (visibleGroups.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={hasRecommended ? 'Contains a ⚡ demo recommendation' : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        // ⚡ 推荐用琥珀描边标在按钮上（同旧按钮组的推荐高亮），不加文字前缀——按钮越宽，
        // 1280 宽下的 Differences 表越容易被撑出横滚。
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-border bg-adm-panel px-2 py-0.5 font-mono text-[10px] font-medium text-adm-t1 hover:bg-adm-hover ${
          hasRecommended ? 'ring-1 ring-adm-amber ring-offset-1 ring-offset-adm-panel' : ''
        }`}
      >
        Resolve ▾
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={style ?? { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="z-50 min-w-[200px] rounded border border-adm-border bg-adm-panel py-1 shadow-lg"
        >
          {visibleGroups.map((g, gi) => (
            <div key={g.title} role="group" aria-label={g.title} className={gi > 0 ? 'mt-1 border-t border-adm-border pt-1' : ''}>
              <div className="px-3 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">{g.title}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  disabled={!!it.disabledNote}
                  onClick={() => {
                    close();
                    it.onSelect();
                  }}
                  className={`flex w-full items-start justify-between gap-3 px-3 py-1.5 text-left text-[11px] ${
                    it.disabledNote ? 'cursor-not-allowed text-adm-t3' : 'text-adm-t1 hover:bg-adm-hover'
                  }`}
                >
                  <span>
                    {it.label}
                    {it.disabledNote && <span className="mt-0.5 block font-mono text-[10px] text-adm-t3">{it.disabledNote}</span>}
                  </span>
                  {it.tag && (
                    <span className={`shrink-0 font-mono text-[10px] ${it.tag.tone === 'amber' ? 'text-adm-amber' : 'text-adm-t3'}`}>
                      {it.tag.text}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};
