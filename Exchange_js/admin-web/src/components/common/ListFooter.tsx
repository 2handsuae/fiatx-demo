import Pagination from './Pagination';

/**
 * 列表页页脚（充值 / 提现 / 兑换三域共用）。
 *
 * 为什么需要它（2026-08-23 第五批终审发现，规则①「同一职责 → 同一个组件」）：
 * `Pagination` **自己就是一整条页脚** —— 根节点带 `border-t bg-adm-panel px-6 py-3`，
 * 左边还自带一句 `Showing X to Y of Z entries`。而充值/提现又在它外面手写了第二条页脚
 * （`shrink-0 border-t ... px-5 py-2.5`）+ 自己的 `Showing N / total`，把 `Pagination`
 * 塞进右半格 —— 于是行数超过一页时，屏幕上是**两条 border-t 叠在一起、两个 Showing 并排**，
 * 且勾了页内筛选（「只看需复核」等）时两个数字还会互相打架（一个是筛后的、一个是总数）。
 * 兑换那边则相反：裸用 `Pagination`，`totalPages <= 1` 时它 `return null` → **整条页脚消失**，
 * 表格贴着窗口底边，与另两域高度对不齐。
 *
 * 这里把「页脚外壳 + 计数」收成一个承载物，翻页器走 `<Pagination bare />`（只出按钮、
 * 不出外壳与自带计数），页脚因此**恒显示**、且只有一条边框一个计数。
 *
 * ⚠️ 全仓另有 12 个列表页是同一个「手写页脚套 Pagination」的形状（同款重影），
 * 本批只收口三个交易域，其余已登记 BACKLOG —— 迁移时把它们也换成本组件即可。
 */
export const ListFooter = ({
  filteredCount,
  total,
  noun,
  currentPage,
  pageSize,
  onPageChange,
}: {
  /** 当前页内过滤后实际渲染的行数（与 total 可能不同，这正是要分开显示的原因）。 */
  filteredCount: number;
  /** 后端返回的总行数。 */
  total: number;
  /** 复数名词，如 `deposit` / `withdrawal` / `swap`；为 0 时显示 `No {noun}s`。 */
  noun: string;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) => (
  <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] text-adm-t3">
        {total > 0
          ? `Showing ${filteredCount} / ${total} ${noun}${total === 1 ? '' : 's'}`
          : `No ${noun}s`}
      </span>
      <Pagination
        bare
        currentPage={currentPage}
        totalItems={total}
        pageSize={pageSize}
        onPageChange={onPageChange}
      />
    </div>
  </div>
);
