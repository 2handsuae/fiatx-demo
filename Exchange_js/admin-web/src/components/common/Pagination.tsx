import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /**
   * true = **只出翻页器**，不出页脚外壳（`border-t bg-adm-panel px-6 py-3`）也不出自带的
   * `Showing X to Y of Z entries`。
   *
   * 给已经有自己页脚的调用方用 —— 本组件默认形态是**一整条页脚**，套进别人的页脚里会渲染出
   * 两条 border-t + 两个 Showing（2026-08-23 第五批终审在三个交易列表页逮到的重影）。
   * 默认 false，其余 25 个调用方行为逐字不变。
   */
  bare?: boolean;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  bare = false,
}) => {
  const totalPages = Math.ceil(totalItems / pageSize);

  if (totalPages <= 1) return null;

  const pager = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        className="rounded border border-adm-border bg-adm-bg text-adm-t2 hover:border-adm-amber hover:text-adm-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="font-mono text-[10px] text-adm-t2 bg-adm-bg border border-adm-border px-3 py-1">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="rounded border border-adm-border bg-adm-bg text-adm-t2 hover:border-adm-amber hover:text-adm-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );

  if (bare) return pager;

  return (
    <div className="border-t border-adm-border bg-adm-panel px-6 py-3 flex items-center justify-between">
      <span className="font-mono text-[10px] text-adm-t3">
        Showing {Math.min(totalItems, (currentPage - 1) * pageSize + 1)} to{' '}
        {Math.min(totalItems, currentPage * pageSize)} of {totalItems} entries
      </span>
      {pager}
    </div>
  );
};

export default Pagination;
